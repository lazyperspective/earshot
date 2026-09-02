/**
 * The Earshot tool catalog. Every tool is a thin wrapper over store actions the UI also uses.
 * Times in ALL inputs/outputs are seconds (float) on the current WORKING timeline (what the user hears).
 * This file is consumed by both the WebMCP registration (registerTools.ts) and the in-app Tool Console.
 */
import { useStore, getCuts, markerWorkingRange } from '../store/useStore';
import { analyzeClipping, analyzeLoudness, analyzeSegments, analyzeSilences, monoOf } from '../audio/analyze';
import { computeNormalizeGain } from '../audio/analysis';
import { sourceToWorking, type Range } from '../audio/edl';
import { player } from '../audio/player';
import { ensureTranscript } from '../transcript/service';
import { DEFAULT_FILLERS, findFillers, findPhrase } from '../transcript/text';
import { formatTime, uid } from '../lib/format';
import type { ActivityEntry, Marker, ToolSpec, Transcript, TranscriptSegment, TranscriptWord } from '../types';

type Input = Record<string, unknown>;

export interface ToolDef extends ToolSpec {
  execute: (input: Input) => Promise<unknown> | unknown;
  summarize?: (result: unknown, input: Input) => string;
}

class ToolError extends Error {}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const ts = (t: number) => formatTime(t, { ms: true });

function requireAudio() {
  const s = useStore.getState();
  if (!s.workingBuffer || !s.sourceBuffer) {
    throw new ToolError('No audio is loaded. Ask the user to drop a file or click "Load demo podcast clip", then call get_status.');
  }
  return { s, buffer: s.workingBuffer, duration: s.workingBuffer.duration };
}

function requireRange(input: Input, duration: number, allowZeroLength = false): Range {
  const start = input.start, end = input.end;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new ToolError('"start" and "end" must be numbers (seconds).');
  }
  const a = Math.max(0, Math.min(start, duration));
  const b = Math.max(0, Math.min(end, duration));
  if (b < a || (!allowZeroLength && b - a < 0.005)) throw new ToolError(`Invalid range ${start}–${end}: end must be after start and within 0–${r3(duration)} s.`);
  return { start: r3(a), end: r3(b) };
}

function markerView(m: Marker, cuts: Range[]) {
  const w = markerWorkingRange(m, cuts);
  return {
    id: m.id,
    kind: m.kind,
    start: w ? r3(w.start) : null,
    end: w ? r3(w.end) : null,
    duration_s: w ? r3(w.end - w.start) : 0,
    reason: m.note,
    author: m.author,
    status: m.kind === 'comment' ? 'note' : m.status,
    ...(m.edit ? { edit: m.edit } : {}),
    ...(w ? {} : { hidden: 'lies entirely inside an applied cut' }),
  };
}

function workingWords(t: Transcript, cuts: Range[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const w of t.words) {
    const a = sourceToWorking(w.start, cuts), b = sourceToWorking(w.end, cuts);
    if (b - a < 0.001 && cuts.length) continue;
    out.push({ text: w.text, start: r3(a), end: r3(b) });
  }
  return out;
}

function workingSegments(t: Transcript, cuts: Range[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const s of t.segments) {
    const a = sourceToWorking(s.start, cuts), b = sourceToWorking(s.end, cuts);
    if (b - a < 0.05) continue;
    out.push({ id: s.id, text: s.text, start: r3(a), end: r3(b) });
  }
  return out;
}

/** Wait briefly for a transcript; return a "transcribing" payload if it is still running. */
async function transcriptOrStatus(): Promise<{ transcript: Transcript } | { status: 'transcribing'; progress: number; note?: string } | { error: string }> {
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 25_000));
  const res = await Promise.race([ensureTranscript(), timeout]);
  const st = res === 'timeout' ? useStore.getState().transcript : res;
  if (st.status === 'ready') return { transcript: st.transcript };
  if (st.status === 'transcribing') return { status: 'transcribing', progress: r3(st.progress), note: `${st.note ?? 'Transcribing'} — call this tool again in a few seconds.` };
  if (st.status === 'error') return { error: `Transcription unavailable: ${st.message}` };
  return { status: 'transcribing', progress: 0 };
}

function proposal(kind: Marker['kind'], input: Input, edit?: Marker['edit'], label?: string) {
  const { duration } = requireAudio();
  const range = requireRange(input, duration);
  const reason = str(input.reason).trim() || `${label ?? kind} proposed by agent`;
  const m = useStore.getState().addMarker({ kind, start: range.start, end: range.end, note: reason, author: 'agent', edit });
  return {
    id: m.id,
    kind,
    start: range.start,
    end: range.end,
    duration_s: r3(range.end - range.start),
    status: 'pending',
    ...(edit ? { edit } : {}),
    reason,
    next: 'Awaiting human approval on the timeline. Call list_markers to see status, then apply_proposals once approved.',
  };
}

const SCHEMA_RANGE = {
  start: { type: 'number', description: 'Start time in seconds on the current working timeline.' },
  end: { type: 'number', description: 'End time in seconds (must be greater than start).' },
};

export function getIdleToolDefs(): ToolDef[] {
  return [
    {
      name: 'get_status',
      description: 'Get the state of the Earshot audio editor. No audio is loaded yet: the app is waiting for the user to drop an audio file or click "Load demo podcast clip". Call this to check whether audio has appeared; once it has, the full tool set (silence detection, loudness, transcript, proposals) becomes available.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: true,
      destructive: false,
      example: {},
      execute: () => ({
        loaded: false,
        message: 'Waiting for the user to load an audio file. Ask them to drop a file onto Earshot or click "Load demo podcast clip".',
        tools_available_after_load: 23,
      }),
      summarize: () => 'Waiting for audio',
    },
  ];
}

export function getToolDefs(): ToolDef[] {
  const tools: ToolDef[] = [
    // ------------------------------------------------------------------ READ
    {
      name: 'get_status',
      description: 'Get the current state of the Earshot editor: file name, working duration (after cuts) and source duration in seconds, sample rate, channels, number of applied edit operations, proposal counts by status, transcript availability, current selection and playhead. Call this first. Read-only.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: true,
      destructive: false,
      example: {},
      execute: () => {
        const s = useStore.getState();
        if (!s.workingBuffer || !s.sourceBuffer) return { loaded: false, message: 'No audio loaded yet.' };
        const by = (st: Marker['status']) => s.markers.filter((m) => m.kind !== 'comment' && m.status === st).length;
        return {
          loaded: true,
          file_name: s.fileName,
          duration_s: r3(s.workingBuffer.duration),
          source_duration_s: r3(s.sourceBuffer.duration),
          sample_rate: s.workingBuffer.sampleRate,
          channels: s.workingBuffer.numberOfChannels,
          edl_ops: s.edl.length,
          proposals: { pending: by('pending'), approved: by('approved'), rejected: by('rejected'), applied: by('applied') },
          notes: s.markers.filter((m) => m.kind === 'comment').length,
          transcript: s.transcript.status === 'ready' ? 'ready' : s.transcript.status === 'transcribing' ? 'transcribing' : 'not_started',
          selection: s.selection ? { start: r3(s.selection.start), end: r3(s.selection.end) } : null,
          playhead_s: r3(s.playhead),
          is_playing: s.isPlaying,
          can_undo: s.history.length > 0,
          can_redo: s.future.length > 0,
          timeline_note: 'All times are seconds on the working timeline (after applied cuts).',
        };
      },
      summarize: (r) => { const x = r as { loaded: boolean; duration_s?: number; edl_ops?: number }; return x.loaded ? `${ts(x.duration_s ?? 0)} · ${x.edl_ops} edits` : 'No audio loaded'; },
    },
    {
      name: 'get_selection',
      description: 'Get the user\'s current timeline selection as { start, end } in seconds (null if nothing is selected) and the playhead position. Use this to find out what the human is pointing at before analysing or proposing. Read-only.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: true,
      destructive: false,
      example: {},
      execute: () => {
        const s = useStore.getState();
        return {
          start: s.selection ? r3(s.selection.start) : null,
          end: s.selection ? r3(s.selection.end) : null,
          duration_s: s.selection ? r3(s.selection.end - s.selection.start) : null,
          playhead_s: r3(s.playhead),
          is_playing: s.isPlaying,
        };
      },
      summarize: (r) => { const x = r as { start: number | null; end: number | null }; return x.start != null ? `${ts(x.start)} → ${ts(x.end!)}` : 'No selection'; },
    },
    {
      name: 'get_transcript',
      description: 'Get the word-level transcript of the working audio, optionally limited to a time range. Returns words as { text, start, end } in seconds, the plain text, and sentence segments. Triggers transcription (OpenAI Whisper via the server) the first time; if it is still running you get { status: "transcribing", progress } — call again in a few seconds. Times already account for applied cuts. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'Optional range start in seconds. Defaults to 0.' },
          end: { type: 'number', description: 'Optional range end in seconds. Defaults to the end of the audio.' },
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: true,
      destructive: false,
      example: {},
      execute: async (input) => {
        const { s, duration } = requireAudio();
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const cuts = getCuts(s);
        const a = Math.max(0, num(input.start, 0)), b = Math.min(duration, num(input.end, duration));
        const words = workingWords(res.transcript, cuts).filter((w) => w.end > a && w.start < b);
        const segments = workingSegments(res.transcript, cuts).filter((sg) => sg.end > a && sg.start < b);
        return {
          status: 'ready',
          language: res.transcript.language ?? 'en',
          range: { start: r3(a), end: r3(b) },
          word_count: words.length,
          text: words.map((w) => w.text).join(' '),
          words,
          segments,
        };
      },
      summarize: (r) => { const x = r as { status: string; word_count?: number; progress?: number }; return x.status === 'ready' ? `${x.word_count} words` : `transcribing ${Math.round((x.progress ?? 0) * 100)}%`; },
    },
    {
      name: 'find_in_transcript',
      description: 'Search the transcript for a word or phrase (case-insensitive, punctuation-insensitive, whole-word phrase match). Returns every match with its { start, end } time range in seconds so you can seek, select, or propose edits around it. Triggers transcription if needed. Read-only.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The word or phrase to find, e.g. "lost my place".' } },
        required: ['query'],
        additionalProperties: false,
      },
      readOnly: true,
      destructive: false,
      example: { query: 'lost my place' },
      execute: async (input) => {
        const { s } = requireAudio();
        const query = str(input.query).trim();
        if (!query) throw new ToolError('"query" must be a non-empty string.');
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const words = workingWords(res.transcript, getCuts(s));
        const matches = findPhrase(words, query).map((m) => ({ text: m.text, start: r3(m.start), end: r3(m.end), context: words.slice(Math.max(0, m.wordIndex - 4), m.wordIndex + m.wordCount + 4).map((w) => w.text).join(' ') }));
        return { query, count: matches.length, matches };
      },
      summarize: (r, i) => { const x = r as { count?: number; status?: string }; return x.count != null ? `${x.count} match${x.count === 1 ? '' : 'es'} for “${str(i.query)}”` : (x.status ?? 'pending'); },
    },
    {
      name: 'detect_silences',
      description: 'Find silent gaps in the working audio. RMS is measured over 20 ms windows; consecutive windows under threshold_db (dBFS) are merged and runs shorter than min_duration_s are dropped. Returns [{ start, end, duration }] in seconds, sorted. Typical use: propose_cut on gaps longer than ~1 s, leaving ~0.3 s of breathing room. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          threshold_db: { type: 'number', description: 'Silence threshold in dBFS RMS. Default -40. Use -50 for very quiet rooms.' },
          min_duration_s: { type: 'number', description: 'Minimum gap length in seconds to report. Default 0.7.' },
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: true,
      destructive: false,
      example: { threshold_db: -40, min_duration_s: 0.7 },
      execute: async (input) => {
        const { buffer } = requireAudio();
        const threshold_db = num(input.threshold_db, -40);
        const min_duration_s = Math.max(0.05, num(input.min_duration_s, 0.7));
        const silences = await analyzeSilences(buffer, { thresholdDb: threshold_db, minDurationS: min_duration_s });
        return { count: silences.length, threshold_db, min_duration_s, total_silence_s: r3(silences.reduce((a, x) => a + x.duration, 0)), duration_s: r3(buffer.duration), silences };
      },
      summarize: (r) => { const x = r as { count: number; min_duration_s: number; total_silence_s: number }; return `${x.count} gaps ≥ ${x.min_duration_s}s · ${x.total_silence_s}s total`; },
    },
    {
      name: 'get_loudness_profile',
      description: 'Measure loudness over time. Returns points [{ t, rms_db, peak_db }] per window plus integrated_db (RMS of the whole track), peak_db and dynamic_range_db, all in dBFS (RMS, not LUFS). Use it to spot quiet or loud passages before proposing gain changes or calling normalize. Read-only.',
      inputSchema: {
        type: 'object',
        properties: { window_s: { type: 'number', description: 'Window length in seconds. Default 1. Long files are automatically coarsened to keep ≤ 600 points.' } },
        required: [],
        additionalProperties: false,
      },
      readOnly: true,
      destructive: false,
      example: { window_s: 1 },
      execute: async (input) => {
        const { buffer } = requireAudio();
        let window_s = Math.max(0.1, num(input.window_s, 1));
        if (buffer.duration / window_s > 600) window_s = r3(buffer.duration / 600);
        return analyzeLoudness(buffer, window_s);
      },
      summarize: (r) => { const x = r as { integrated_db: number; peak_db: number; dynamic_range_db: number }; return `integrated ${x.integrated_db} dBFS · peak ${x.peak_db} · range ${x.dynamic_range_db} dB`; },
    },
    {
      name: 'detect_clipping',
      description: 'Find digitally clipped regions: runs of 2+ consecutive samples whose absolute value is at or above threshold (0–1 linear, default 0.99). Returns regions [{ start, end, samples }] in seconds and the total clipped sample count. Read-only.',
      inputSchema: {
        type: 'object',
        properties: { threshold: { type: 'number', description: 'Linear amplitude threshold between 0 and 1. Default 0.99.' } },
        required: [],
        additionalProperties: false,
      },
      readOnly: true,
      destructive: false,
      example: { threshold: 0.99 },
      execute: async (input) => {
        const { buffer } = requireAudio();
        const threshold = Math.min(1, Math.max(0.5, num(input.threshold, 0.99)));
        const r = await analyzeClipping(buffer, threshold);
        return { threshold, count: r.regions.length, clipped_samples: r.clippedSamples, regions: r.regions };
      },
      summarize: (r) => { const x = r as { count: number; clipped_samples: number }; return x.count ? `${x.count} clipped regions (${x.clipped_samples} samples)` : 'No clipping'; },
    },
    {
      name: 'find_filler_words',
      description: 'Find filler words ("um", "uh", "like", "you know", "so" by default) in the transcript. Returns [{ word, start, end, confidence, context }] in seconds. "um"/"uh" are high confidence; "like"/"so"/"you know" are only flagged when set off by commas. Typical next step: propose_cut for each high-confidence hit with ~0.03 s padding. Triggers transcription if needed. Read-only.',
      inputSchema: {
        type: 'object',
        properties: { words: { type: 'array', items: { type: 'string' }, description: 'Filler words/phrases to look for. Default ["um","uh","like","you know","so"].' } },
        required: [],
        additionalProperties: false,
      },
      readOnly: true,
      destructive: false,
      example: { words: ['um', 'uh', 'like', 'you know', 'so'] },
      execute: async (input) => {
        const { s } = requireAudio();
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const list = Array.isArray(input.words) && input.words.length ? (input.words as unknown[]).map((w) => String(w)) : DEFAULT_FILLERS;
        const words = workingWords(res.transcript, getCuts(s));
        const hits = findFillers(words, list).map(({ wordIndex: _i, ...h }) => h);
        return { count: hits.length, high_confidence: hits.filter((h) => h.confidence === 'high').length, words_searched: list, fillers: hits };
      },
      summarize: (r) => { const x = r as { count?: number; high_confidence?: number; status?: string }; return x.count != null ? `${x.count} fillers (${x.high_confidence} high confidence)` : (x.status ?? 'pending'); },
    },
    {
      name: 'compare_speakers',
      description: 'Best-effort loudness comparison across speech segments. Uses transcript sentences when available, otherwise splits on pauses ≥ 0.6 s. Returns per-segment mean RMS and peak (dBFS), flags segments that are ≥ 5 dB quieter or louder than the integrated level, and suggests gain changes. Use it to spot a quiet guest, then propose_gain on those ranges. Read-only.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: true,
      destructive: false,
      example: {},
      execute: async () => {
        const { s, buffer } = requireAudio();
        const cuts = getCuts(s);
        const t = s.transcript.status === 'ready' ? s.transcript.transcript : null;
        const segs = t ? workingSegments(t, cuts) : undefined;
        const r = await analyzeSegments(buffer, segs?.map((x) => ({ start: x.start, end: x.end })));
        const segments = r.segments.map((seg, i) => ({ ...seg, ...(segs ? { text: segs[i]?.text } : {}), suggested_gain_db: seg.quiet || seg.loud ? r1(r.integrated_db - seg.mean_rms_db) : 0 }));
        const quiet = segments.filter((x) => x.quiet);
        return {
          method: t ? 'transcript_segments' : 'pause_split',
          integrated_db: r.integrated_db,
          segment_count: segments.length,
          quiet_segments: quiet.length,
          loud_segments: segments.filter((x) => x.loud).length,
          hint: quiet.length ? `Quiet segments are ${r1(Math.abs(r.integrated_db - Math.min(...quiet.map((q) => q.mean_rms_db))))} dB below average; consider propose_gain over the contiguous quiet span.` : 'Levels are fairly consistent.',
          segments,
        };
      },
      summarize: (r) => { const x = r as { segment_count: number; quiet_segments: number; loud_segments: number }; return `${x.segment_count} segments · ${x.quiet_segments} quiet · ${x.loud_segments} loud`; },
    },
    {
      name: 'list_markers',
      description: 'List every marker on the timeline: agent proposals (cut/gain/fade/filter) with status pending | approved | rejected | applied, and plain notes. Times are seconds on the working timeline. Use this to see what the human approved before calling apply_proposals. Read-only.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: true,
      destructive: false,
      example: {},
      execute: () => {
        const s = useStore.getState();
        const cuts = getCuts(s);
        const markers = s.markers.map((m) => markerView(m, cuts));
        return { count: markers.length, pending: markers.filter((m) => m.status === 'pending').length, approved: markers.filter((m) => m.status === 'approved').length, markers };
      },
      summarize: (r) => { const x = r as { count: number; pending: number; approved: number }; return `${x.count} markers · ${x.pending} pending · ${x.approved} approved`; },
    },

    // ------------------------------------------------------------ PROPOSALS
    {
      name: 'propose_cut',
      description: 'Propose removing a time range (seconds). Creates a PENDING cut marker on the timeline for the human to approve or reject — nothing is removed until apply_proposals runs. Give a specific reason (e.g. "2.8 s dead air" or "filler word: um"). Prefer this over direct edits.',
      inputSchema: {
        type: 'object',
        properties: { ...SCHEMA_RANGE, reason: { type: 'string', description: 'Short, human-readable justification shown on the proposal card.' } },
        required: ['start', 'end', 'reason'],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: false,
      example: { start: 30.2, end: 32.9, reason: 'Long pause (2.7 s of dead air)' },
      execute: (input) => proposal('cut', input),
      summarize: (r) => { const x = r as { start: number; end: number; reason: string }; return `Cut ${ts(x.start)}–${ts(x.end)} · ${x.reason}`; },
    },
    {
      name: 'propose_gain',
      description: 'Propose a gain change of gain_db decibels (−24 to +24) over a time range, e.g. to lift a quiet guest by +6 dB. Creates a PENDING marker for human approval; applied with 10 ms crossfades. Prefer this over normalize for local fixes.',
      inputSchema: {
        type: 'object',
        properties: { ...SCHEMA_RANGE, gain_db: { type: 'number', description: 'Gain in dB, positive to boost, negative to attenuate. Range −24 to +24.' }, reason: { type: 'string', description: 'Why, e.g. "guest is 9 dB below host".' } },
        required: ['start', 'end', 'gain_db', 'reason'],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: false,
      example: { start: 40, end: 58, gain_db: 6, reason: 'Guest is ~9 dB quieter than the host' },
      execute: (input) => {
        const gain = num(input.gain_db, NaN);
        if (!Number.isFinite(gain)) throw new ToolError('"gain_db" must be a number.');
        return proposal('gain', input, { gainDb: r1(Math.max(-24, Math.min(24, gain))) });
      },
      summarize: (r) => { const x = r as { start: number; end: number; edit: { gainDb: number } }; return `Gain ${x.edit.gainDb > 0 ? '+' : ''}${x.edit.gainDb} dB over ${ts(x.start)}–${ts(x.end)}`; },
    },
    {
      name: 'propose_fade',
      description: 'Propose a fade "in" (silence → full over the range) or "out" (full → silence over the range). Creates a PENDING marker for human approval. Typical: fade in over the first 0.5 s, fade out over the last 1–2 s.',
      inputSchema: {
        type: 'object',
        properties: { ...SCHEMA_RANGE, direction: { type: 'string', enum: ['in', 'out'], description: '"in" or "out".' }, reason: { type: 'string', description: 'Why.' } },
        required: ['start', 'end', 'direction', 'reason'],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: false,
      example: { start: 78.5, end: 80.5, direction: 'out', reason: 'Smooth ending' },
      execute: (input) => {
        const direction = str(input.direction);
        if (direction !== 'in' && direction !== 'out') throw new ToolError('"direction" must be "in" or "out".');
        return proposal('fade', input, { direction });
      },
      summarize: (r) => { const x = r as { start: number; end: number; edit: { direction: string } }; return `Fade ${x.edit.direction} ${ts(x.start)}–${ts(x.end)}`; },
    },
    {
      name: 'propose_filter',
      description: 'Propose a region-limited filter: "notch" (narrow cut at frequency_hz, e.g. 50/60 Hz mains hum) or "highpass" (removes rumble below frequency_hz, e.g. 80 Hz). Creates a PENDING marker for human approval; blended in with 10 ms crossfades.',
      inputSchema: {
        type: 'object',
        properties: { ...SCHEMA_RANGE, type: { type: 'string', enum: ['notch', 'highpass'], description: '"notch" or "highpass".' }, frequency_hz: { type: 'number', description: 'Center (notch) or cutoff (highpass) frequency in Hz, 20–20000.' }, reason: { type: 'string', description: 'Why.' } },
        required: ['start', 'end', 'type', 'frequency_hz', 'reason'],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: false,
      example: { start: 0, end: 80, type: 'highpass', frequency_hz: 80, reason: 'Remove low-frequency rumble' },
      execute: (input) => {
        const type = str(input.type);
        if (type !== 'notch' && type !== 'highpass') throw new ToolError('"type" must be "notch" or "highpass".');
        const f = num(input.frequency_hz, NaN);
        if (!Number.isFinite(f) || f < 20 || f > 20000) throw new ToolError('"frequency_hz" must be between 20 and 20000.');
        return proposal('filter', input, { filterType: type, frequencyHz: Math.round(f) });
      },
      summarize: (r) => { const x = r as { start: number; end: number; edit: { filterType: string; frequencyHz: number } }; return `${x.edit.filterType} @ ${x.edit.frequencyHz} Hz over ${ts(x.start)}–${ts(x.end)}`; },
    },
    {
      name: 'add_marker',
      description: 'Drop a plain note marker at a time (seconds) with a comment, e.g. "possible chapter break" or "check pronunciation". No edit is attached and nothing needs approval.',
      inputSchema: {
        type: 'object',
        properties: { time: { type: 'number', description: 'Position in seconds.' }, note: { type: 'string', description: 'The note text.' } },
        required: ['time', 'note'],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: false,
      example: { time: 12.5, note: 'Possible chapter break' },
      execute: (input) => {
        const { duration } = requireAudio();
        const time = num(input.time, NaN);
        if (!Number.isFinite(time) || time < 0 || time > duration) throw new ToolError(`"time" must be between 0 and ${r3(duration)}.`);
        const note = str(input.note).trim() || 'Note';
        const m = useStore.getState().addMarker({ kind: 'comment', start: time, end: time, note, author: 'agent' });
        return { id: m.id, time: r3(time), note };
      },
      summarize: (r) => { const x = r as { time: number; note: string }; return `Note at ${ts(x.time)}: ${x.note}`; },
    },
    {
      name: 'clear_proposals',
      description: 'Remove ALL of the agent\'s pending/approved/rejected proposals and notes from the timeline. Edits that were already applied are untouched. Use before re-planning.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: {},
      execute: () => {
        requireAudio();
        const removed = useStore.getState().clearProposals();
        return { removed, remaining: useStore.getState().markers.length };
      },
      summarize: (r) => `Cleared ${(r as { removed: number }).removed} proposals`,
    },

    // --------------------------------------------------------------- DIRECT
    {
      name: 'apply_proposals',
      description: 'Apply APPROVED proposals to the edit list and re-render the audio (non-destructive; undo is available). By default only markers the human marked "approved" are applied; pass ids to restrict to specific markers. force: true also applies still-pending proposals — only do that when the user explicitly asked you to. Cuts shift all later times: re-read get_status afterwards. Returns what was applied and skipped, plus the new duration.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Optional marker ids to apply. Omit to apply every approved proposal.' },
          force: { type: 'boolean', description: 'Apply pending (not yet approved) proposals too. Default false. Never applies rejected ones.' },
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: true,
      example: {},
      execute: async (input) => {
        requireAudio();
        const ids = Array.isArray(input.ids) ? (input.ids as unknown[]).map(String) : undefined;
        const force = input.force === true;
        const res = await useStore.getState().applyMarkers(ids, force);
        const s = useStore.getState();
        return {
          applied: res.applied.map((m) => ({ id: m.id, kind: m.kind, reason: m.note })),
          applied_count: res.applied.length,
          skipped: res.skipped,
          new_duration_s: r3(res.newDuration),
          edl_ops: s.edl.length,
          ...(res.applied.length === 0 ? { hint: 'Nothing applied. Ask the human to approve proposals on the timeline (or pass force: true if they asked you to apply directly).' } : {}),
        };
      },
      summarize: (r) => { const x = r as { applied_count: number; skipped: unknown[]; new_duration_s: number }; return `Applied ${x.applied_count} · skipped ${x.skipped.length} · now ${ts(x.new_duration_s)}`; },
    },
    {
      name: 'normalize',
      description: 'Normalize the whole track to target_db dBFS (default −16 RMS; mode "peak" targets peak level instead). Appended to the edit list immediately (undoable) with a −0.1 dBFS peak ceiling so it never clips. For fixing one quiet section prefer propose_gain.',
      inputSchema: {
        type: 'object',
        properties: {
          target_db: { type: 'number', description: 'Target level in dBFS. Default −16 (RMS). Typical spoken-word delivery: −16 to −19 RMS.' },
          mode: { type: 'string', enum: ['rms', 'peak'], description: '"rms" (default) or "peak".' },
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: true,
      example: { target_db: -16, mode: 'rms' },
      execute: async (input) => {
        const { buffer } = requireAudio();
        const mode = str(input.mode, 'rms') === 'peak' ? 'peak' : 'rms';
        const target_db = num(input.target_db, mode === 'peak' ? -1 : -16);
        const g = computeNormalizeGain(monoOf(buffer), target_db, mode);
        await useStore.getState().appendOps([{ id: uid('op'), type: 'normalize', targetDb: target_db, gainDb: g.gainDb, mode }]);
        return { mode, target_db, measured_db: g.measuredDb, gain_db: g.gainDb, peak_before_db: g.peakDb, limited_by_peak: g.limitedByPeak, edl_ops: useStore.getState().edl.length };
      },
      summarize: (r) => { const x = r as { gain_db: number; target_db: number; mode: string }; return `${x.gain_db > 0 ? '+' : ''}${x.gain_db} dB → ${x.target_db} dBFS ${x.mode}`; },
    },
    {
      name: 'set_selection',
      description: 'Set the user\'s timeline selection to { start, end } seconds and scroll the waveform to it. Use this to point the human at something ("here is the pause I mean"). Does not change audio.',
      inputSchema: { type: 'object', properties: { ...SCHEMA_RANGE }, required: ['start', 'end'], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: { start: 30, end: 33 },
      execute: (input) => {
        const { duration } = requireAudio();
        const range = requireRange(input, duration);
        useStore.getState().setSelection(range);
        player.scrollTo(Math.max(0, range.start - 1));
        return { ...range, duration_s: r3(range.end - range.start) };
      },
      summarize: (r) => { const x = r as { start: number; end: number }; return `Selected ${ts(x.start)} → ${ts(x.end)}`; },
    },
    {
      name: 'seek',
      description: 'Move the playhead to time (seconds) and scroll the waveform there. Does not start playback.',
      inputSchema: { type: 'object', properties: { time: { type: 'number', description: 'Target time in seconds.' } }, required: ['time'], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: { time: 30 },
      execute: (input) => {
        const { duration } = requireAudio();
        const t = num(input.time, NaN);
        if (!Number.isFinite(t)) throw new ToolError('"time" must be a number.');
        const playhead = player.seek(Math.max(0, Math.min(duration, t)));
        player.scrollTo(Math.max(0, playhead - 1));
        return { playhead_s: r3(playhead) };
      },
      summarize: (r) => `Playhead → ${ts((r as { playhead_s: number }).playhead_s)}`,
    },
    {
      name: 'undo',
      description: 'Undo the last applied edit (apply_proposals or normalize). Restores proposals to their previous status. Returns the new edit count and duration.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: false,
      destructive: true,
      example: {},
      execute: async () => {
        requireAudio();
        const ok = await useStore.getState().undo();
        const s = useStore.getState();
        return { undone: ok, edl_ops: s.edl.length, duration_s: r3(s.workingBuffer?.duration ?? 0), can_undo: s.history.length > 0 };
      },
      summarize: (r) => ((r as { undone: boolean }).undone ? 'Undid last edit' : 'Nothing to undo'),
    },
    {
      name: 'redo',
      description: 'Redo the most recently undone edit. Returns the new edit count and duration.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: false,
      destructive: true,
      example: {},
      execute: async () => {
        requireAudio();
        const ok = await useStore.getState().redo();
        const s = useStore.getState();
        return { redone: ok, edl_ops: s.edl.length, duration_s: r3(s.workingBuffer?.duration ?? 0), can_redo: s.future.length > 0 };
      },
      summarize: (r) => ((r as { redone: boolean }).redone ? 'Redid edit' : 'Nothing to redo'),
    },
    {
      name: 'export_audio',
      description: 'Render the edit list and download the result as a 16-bit PCM WAV file in the user\'s browser. Returns file name, size in bytes and duration. Only call when the user asked to export.',
      inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['wav'], description: 'Output format. Only "wav" is supported.' } }, required: [], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: { format: 'wav' },
      execute: async (input) => {
        requireAudio();
        const format = str(input.format, 'wav');
        if (format !== 'wav') throw new ToolError('Only "wav" export is supported.');
        const r = await useStore.getState().exportWav();
        return { file_name: r.fileName, bytes: r.bytes, duration_s: r3(r.duration), format: 'wav' };
      },
      summarize: (r) => { const x = r as { file_name: string; bytes: number }; return `Downloaded ${x.file_name} (${(x.bytes / 1e6).toFixed(1)} MB)`; },
    },
  ];
  return tools;
}

export function toolCounts(defs: ToolDef[]) {
  const read = defs.filter((t) => t.readOnly).length;
  return { total: defs.length, read, write: defs.length - read };
}

/** Shared invocation path: validates, executes, logs to the Activity feed. Never throws. */
export async function invokeTool(name: string, input: unknown, source: ActivityEntry['source'], defs?: ToolDef[]): Promise<unknown> {
  const all = defs ?? (useStore.getState().workingBuffer ? getToolDefs() : getIdleToolDefs());
  const def = all.find((t) => t.name === name);
  const args: Input = input && typeof input === 'object' && !Array.isArray(input) ? (input as Input) : {};
  const t0 = performance.now();
  let result: unknown;
  if (!def) {
    result = { error: `Unknown tool "${name}". Available: ${all.map((t) => t.name).join(', ')}` };
  } else {
    try {
      const missing = (def.inputSchema.required as string[] | undefined)?.filter((k) => args[k] === undefined) ?? [];
      if (missing.length) throw new ToolError(`Missing required argument(s): ${missing.join(', ')}`);
      result = await def.execute(args);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  const ok = !(result && typeof result === 'object' && 'error' in (result as object));
  const durationMs = Math.round(performance.now() - t0);
  let summary = ok ? 'ok' : String((result as { error: string }).error);
  if (ok && def?.summarize) { try { summary = def.summarize(result, args); } catch { /* keep */ } }
  useStore.getState().logActivity({ tool: name, args, result, summary, durationMs, ok, source, access: def?.readOnly === false ? 'write' : 'read' });
  return result;
}
