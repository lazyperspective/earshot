/**
 * Second half of the tool catalog: text-addressed cuts, cleanup macros, the review handshake,
 * playback pointing, exports and preferences. Shares helpers with tools.ts.
 */
import { useStore, getCuts, markerWorkingRange, type NewMarkerInput } from '../store/useStore';
import {
  ToolError, r3, r1, num, str, ts, requireAudio, requireRange, workingWords, sourceWords, workingSegments, transcriptOrStatus, markerView,
  type ToolDef,
} from './tools';
import { wordCutRange, snapRange, type KeepPause } from '../transcript/cuts';
import { suggestCuts, type CandidateKind, type IdWord } from '../transcript/suggest';
import { findPhrase } from '../transcript/text';
import { analyzeSegments, analyzeSilences, monoOf } from '../audio/analyze';
import { sourceToWorking, workingToSource, type Range } from '../audio/edl';
import { player } from '../audio/player';
import { chaptersToYouTube, downloadText, toPlainText, toSrt, toVtt } from '../lib/exports';
import { uid } from '../lib/format';
import type { EditOp, Marker, Preferences, Transcript } from '../types';

type Input = Record<string, unknown>;
type Mode = 'apply' | 'propose';

const KEEP: KeepPause[] = ['after', 'before', 'both', 'none'];
const KINDS: CandidateKind[] = ['filler', 'repeat', 'false_start', 'flub', 'retake'];
const REJECT_REASONS = ['wrong timing', 'keep it natural', 'not a filler', 'other'];

const modeOf = (v: unknown, fallback: Mode = 'apply'): Mode => (v === 'propose' ? 'propose' : v === 'apply' ? 'apply' : fallback);

export interface TextCutItem { from: number; to: number; reason?: string }

/** Resolve { from_id,to_id } or { phrase, occurrence } items against the visible words. */
export function resolveCutItems(raw: unknown, t: Transcript, cuts: Range[], reasonDefault = ''): TextCutItem[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  if (!list.length) throw new ToolError('Provide "cuts": an array of { from_id, to_id } or { phrase, occurrence } items.');
  const visible = workingWords(t, cuts);
  const visibleIds = new Set(visible.map((w) => w.id));
  const items: TextCutItem[] = [];
  for (const it of list) {
    const o = (it && typeof it === 'object' ? it : {}) as Input;
    const reason = str(o.reason, reasonDefault);
    if (typeof o.from_id === 'number' || typeof o.to_id === 'number') {
      const from = num(o.from_id, NaN), to = num(o.to_id, from);
      if (!Number.isFinite(from) || !Number.isFinite(to)) throw new ToolError('"from_id" and "to_id" must be word ids from get_transcript.');
      const a = Math.min(from, to), b = Math.max(from, to);
      if (a < 0 || b >= t.words.length) throw new ToolError(`Word ids ${a}–${b} are out of range (0–${t.words.length - 1}).`);
      if (!visibleIds.has(a) && !visibleIds.has(b)) throw new ToolError(`Words ${a}–${b} are already cut.`);
      items.push({ from: a, to: b, reason });
      continue;
    }
    const phrase = str(o.phrase).trim();
    if (!phrase) throw new ToolError('Each cut needs from_id/to_id or a phrase.');
    const matches = findPhrase(visible, phrase);
    if (!matches.length) throw new ToolError(`Phrase not found in the transcript: "${phrase}".`);
    const occ = Math.max(1, Math.round(num(o.occurrence, 1)));
    const m = matches[Math.min(occ, matches.length) - 1];
    items.push({ from: visible[m.wordIndex].id, to: visible[m.wordIndex + m.wordCount - 1].id, reason: reason || `Cut “${m.text}”` });
  }
  return items;
}

export interface PerformedCut { id: string; op_id?: string; text: string; from_id: number; to_id: number; start: number; end: number; removed_s: number; status: string; reason: string }

/** Shared by cut_text, propose_cut_text, the macros and the transcript UI. Returns per-item results. */
export async function performTextCuts(opts: { items: TextCutItem[]; keepPause?: KeepPause; mode: Mode; author: 'agent' | 'human'; reasonDefault?: string }): Promise<{ results: PerformedCut[]; removed_s: number; new_duration_s: number }> {
  const { s } = requireAudio();
  if (s.transcript.status !== 'ready') throw new ToolError('No transcript yet — call get_transcript first.');
  const t = s.transcript.transcript;
  const cutsBefore = getCuts(s);
  const src = sourceWords(t);
  const mono = monoOf(s.sourceBuffer!);
  const sr = s.sourceBuffer!.sampleRate;
  const prepared = opts.items.map((it) => {
    const raw = wordCutRange(src, it.from, it.to, { keepPause: opts.keepPause ?? 'after' });
    const range = snapRange(mono, sr, raw, 0.025);
    const text = src.slice(Math.min(it.from, it.to), Math.max(it.from, it.to) + 1).map((w) => w.text).join(' ');
    const note = it.reason || opts.reasonDefault || `Cut “${text}”`;
    return { it, range, text, note };
  });
  const results: PerformedCut[] = [];
  if (opts.mode === 'apply') {
    const ops: EditOp[] = [];
    const inputs: NewMarkerInput[] = [];
    for (const p of prepared) {
      const op: EditOp = { id: uid('op'), type: 'cut', start: p.range.start, end: p.range.end };
      ops.push(op);
      inputs.push({ kind: 'cut', start: p.range.start, end: p.range.end, note: p.note, author: opts.author, text: p.text, wordRange: { from: Math.min(p.it.from, p.it.to), to: Math.max(p.it.from, p.it.to) }, appliedOpId: op.id });
    }
    const markers = await useStore.getState().applyOpsWithMarkers(ops, inputs);
    prepared.forEach((p, i) => {
      results.push({ id: markers[i]?.id ?? '', op_id: ops[i].id, text: p.text, from_id: Math.min(p.it.from, p.it.to), to_id: Math.max(p.it.from, p.it.to), start: r3(sourceToWorking(p.range.start, cutsBefore)), end: r3(sourceToWorking(p.range.end, cutsBefore)), removed_s: r3(p.range.end - p.range.start), status: 'applied', reason: p.note });
    });
  } else {
    for (const p of prepared) {
      const ws = sourceToWorking(p.range.start, cutsBefore), we = sourceToWorking(p.range.end, cutsBefore);
      const m = useStore.getState().addMarker({ kind: 'cut', start: ws, end: we, note: p.note, author: opts.author, text: p.text, wordRange: { from: Math.min(p.it.from, p.it.to), to: Math.max(p.it.from, p.it.to) } });
      results.push({ id: m.id, text: p.text, from_id: m.wordRange!.from, to_id: m.wordRange!.to, start: r3(ws), end: r3(we), removed_s: r3(we - ws), status: 'pending', reason: p.note });
    }
  }
  return { results, removed_s: r3(results.reduce((a, x) => a + x.removed_s, 0)), new_duration_s: r3(useStore.getState().workingBuffer?.duration ?? 0) };
}

/** Cuts / gains given as WORKING ranges (silences etc.). */
export async function performRangeOps(items: { kind: 'cut' | 'gain'; start: number; end: number; note: string; gainDb?: number }[], mode: Mode, author: 'agent' | 'human') {
  const s = useStore.getState();
  const cuts = getCuts(s);
  const out: { id: string; kind: string; start: number; end: number; note: string; status: string; gain_db?: number }[] = [];
  if (!items.length) return out;
  if (mode === 'apply') {
    const ops: EditOp[] = [];
    const inputs: NewMarkerInput[] = [];
    for (const it of items) {
      const a = workingToSource(it.start, cuts), b = workingToSource(it.end, cuts);
      const op: EditOp = it.kind === 'cut' ? { id: uid('op'), type: 'cut', start: a, end: b } : { id: uid('op'), type: 'gain', start: a, end: b, gainDb: it.gainDb ?? 0 };
      ops.push(op);
      inputs.push({ kind: it.kind, start: a, end: b, note: it.note, author, edit: it.kind === 'gain' ? { gainDb: it.gainDb } : undefined, appliedOpId: op.id });
    }
    const markers = await useStore.getState().applyOpsWithMarkers(ops, inputs);
    items.forEach((it, i) => out.push({ id: markers[i]?.id ?? '', kind: it.kind, start: r3(it.start), end: r3(it.end), note: it.note, status: 'applied', ...(it.gainDb != null ? { gain_db: it.gainDb } : {}) }));
  } else {
    for (const it of items) {
      const m = useStore.getState().addMarker({ kind: it.kind, start: it.start, end: it.end, note: it.note, author, edit: it.kind === 'gain' ? { gainDb: it.gainDb } : undefined });
      out.push({ id: m.id, kind: it.kind, start: r3(it.start), end: r3(it.end), note: it.note, status: 'pending', ...(it.gainDb != null ? { gain_db: it.gainDb } : {}) });
    }
  }
  return out;
}

async function pauseItems(maxPause: number) {
  const { buffer } = requireAudio();
  const sil = await analyzeSilences(buffer, { thresholdDb: -40, minDurationS: maxPause + 0.25 });
  return sil.map((p) => {
    const keep = maxPause;
    return { kind: 'cut' as const, start: r3(p.start + keep / 2), end: r3(p.end - keep / 2), note: `Pause ${p.duration.toFixed(1)} s → ${keep.toFixed(1)} s`, saves: r3(p.duration - keep) };
  }).filter((p) => p.end - p.start >= 0.1);
}

async function edgeItems(keepS: number) {
  const { buffer, duration } = requireAudio();
  const sil = await analyzeSilences(buffer, { thresholdDb: -45, minDurationS: Math.max(0.2, keepS + 0.1) });
  const items: { kind: 'cut'; start: number; end: number; note: string }[] = [];
  const lead = sil.find((p) => p.start <= 0.05);
  if (lead && lead.end - keepS > 0.05) items.push({ kind: 'cut', start: 0, end: r3(lead.end - keepS), note: `Trim ${(lead.end - keepS).toFixed(1)} s of leading silence` });
  const tail = [...sil].reverse().find((p) => p.end >= duration - 0.05);
  if (tail && duration - (tail.start + keepS) > 0.05) items.push({ kind: 'cut', start: r3(tail.start + keepS), end: r3(duration), note: `Trim ${(duration - tail.start - keepS).toFixed(1)} s of trailing silence` });
  return items;
}

async function levelItems(maxGain = 12) {
  const { s, buffer } = requireAudio();
  const cuts = getCuts(s);
  const t = s.transcript.status === 'ready' ? s.transcript.transcript : null;
  const segs = t ? workingSegments(t, cuts) : undefined;
  const r = await analyzeSegments(buffer, segs?.map((x) => ({ start: x.start, end: x.end })));
  const quiet = r.segments.filter((x) => x.quiet);
  const spans: { start: number; end: number; rms: number[] }[] = [];
  for (const q of quiet) {
    const last = spans[spans.length - 1];
    if (last && q.start - last.end < 1.5) { last.end = q.end; last.rms.push(q.mean_rms_db); }
    else spans.push({ start: q.start, end: q.end, rms: [q.mean_rms_db] });
  }
  return spans.filter((sp) => sp.end - sp.start >= 1).map((sp) => {
    const mean = sp.rms.reduce((a, b) => a + b, 0) / sp.rms.length;
    const gain = Math.max(1, Math.min(maxGain, Math.round(r.integrated_db - mean)));
    return { kind: 'gain' as const, start: r3(sp.start), end: r3(sp.end), gainDb: gain, note: `Quiet passage ${Math.round(mean)} dBFS vs ${Math.round(r.integrated_db)} average — lift +${gain} dB` };
  });
}

function candidatesFor(s = useStore.getState(), kinds?: CandidateKind[], confidence?: 'high' | 'medium') {
  if (s.transcript.status !== 'ready') return [];
  const cuts = getCuts(s);
  const vis = workingWords(s.transcript.transcript, cuts);
  return suggestCuts(vis, { kinds, keepFillers: s.preferences.keep_fillers, fillerConfidence: confidence ?? s.preferences.filler_confidence });
}

const MODE_SCHEMA = { type: 'string', enum: ['apply', 'propose'], description: '"apply" (default) edits immediately (undoable); "propose" creates pending markers for the human to approve.' };

export function extraToolDefs(): ToolDef[] {
  return [
    // ------------------------------------------------------------ TEXT CUTS
    {
      name: 'cut_text',
      description: 'Surgically remove words from the audio by editing the transcript. Address words by stable ids from get_transcript ({ from_id, to_id }) or by phrase ({ phrase, occurrence }). The cut is computed from word timestamps, absorbs the hesitation before the words while keeping the pause after them (keep_pause), and snaps both edges to the quietest nearby moment so nothing clips. Applies immediately in one undoable step and records each cut in the Proposals panel with your reason. Use suggest_cuts first to see candidates.',
      inputSchema: {
        type: 'object',
        properties: {
          cuts: {
            type: 'array',
            description: 'Cuts to make. Each item: { from_id, to_id, reason } (word ids, inclusive) or { phrase, occurrence, reason } (occurrence is 1-based, default 1).',
            items: {
              type: 'object',
              properties: {
                from_id: { type: 'number', description: 'First word id (inclusive).' },
                to_id: { type: 'number', description: 'Last word id (inclusive). Defaults to from_id.' },
                phrase: { type: 'string', description: 'Alternative to ids: the exact words to remove.' },
                occurrence: { type: 'number', description: 'Which match of the phrase (1 = first).' },
                reason: { type: 'string', description: 'Why, shown to the human, e.g. "filler word" or "false start".' },
              },
              required: [],
              additionalProperties: false,
            },
          },
          keep_pause: { type: 'string', enum: ['after', 'before', 'both', 'none'], description: 'Which neighbouring pause to keep so speech stays natural. Default "after".' },
          reason: { type: 'string', description: 'Default reason for items that omit one.' },
        },
        required: ['cuts'],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: true,
      example: { cuts: [{ phrase: 'Sorry, I lost my place there for a second.', reason: 'Flub' }, { from_id: 5, to_id: 5, reason: 'Filler word' }] },
      execute: async (input) => {
        const { s } = requireAudio();
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const items = resolveCutItems(input.cuts, res.transcript, getCuts(s), str(input.reason));
        const keep = KEEP.includes(input.keep_pause as KeepPause) ? (input.keep_pause as KeepPause) : 'after';
        const r = await performTextCuts({ items, keepPause: keep, mode: 'apply', author: 'agent' });
        return { applied_count: r.results.length, removed_s: r.removed_s, new_duration_s: r.new_duration_s, cuts: r.results, undo_hint: 'restore_cut { id } reverses one; undo reverses the whole batch.' };
      },
      summarize: (r) => { const x = r as { applied_count?: number; removed_s?: number; status?: string }; return x.applied_count != null ? `Cut ${x.applied_count} passage${x.applied_count === 1 ? '' : 's'} · −${x.removed_s}s` : (x.status ?? 'pending'); },
    },
    {
      name: 'propose_cut_text',
      description: 'Same addressing as cut_text (word ids or phrases) but creates PENDING cut markers for the human to approve instead of applying. Use when the user wants to review edits before they happen.',
      inputSchema: {
        type: 'object',
        properties: {
          cuts: { type: 'array', description: 'Same item shape as cut_text.', items: { type: 'object', properties: { from_id: { type: 'number', description: 'First word id.' }, to_id: { type: 'number', description: 'Last word id.' }, phrase: { type: 'string', description: 'Exact words to remove.' }, occurrence: { type: 'number', description: '1-based match index.' }, reason: { type: 'string', description: 'Why.' } }, required: [], additionalProperties: false } },
          keep_pause: { type: 'string', enum: ['after', 'before', 'both', 'none'], description: 'Default "after".' },
          reason: { type: 'string', description: 'Default reason.' },
        },
        required: ['cuts'],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: false,
      example: { cuts: [{ phrase: 'you know', reason: 'Filler phrase' }] },
      execute: async (input) => {
        const { s } = requireAudio();
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const items = resolveCutItems(input.cuts, res.transcript, getCuts(s), str(input.reason));
        const keep = KEEP.includes(input.keep_pause as KeepPause) ? (input.keep_pause as KeepPause) : 'after';
        const r = await performTextCuts({ items, keepPause: keep, mode: 'propose', author: 'agent' });
        return { proposed_count: r.results.length, would_remove_s: r.removed_s, proposals: r.results, next: 'Call request_review, then wait_for_decisions.' };
      },
      summarize: (r) => { const x = r as { proposed_count?: number; status?: string }; return x.proposed_count != null ? `Proposed ${x.proposed_count} text cut${x.proposed_count === 1 ? '' : 's'}` : (x.status ?? 'pending'); },
    },
    {
      name: 'restore_cut',
      description: 'Put back one applied cut (by the marker id or op id returned from cut_text / list_markers) without undoing anything else. The marker is kept as rejected+restored so get_review_feedback can learn from it.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Marker id or op id of the applied cut.' } }, required: ['id'], additionalProperties: false },
      readOnly: false,
      destructive: true,
      example: { id: 'm_xxxxxx' },
      execute: async (input) => {
        requireAudio();
        const id = str(input.id).trim();
        const m = await useStore.getState().restoreCut(id);
        if (!m) throw new ToolError(`No applied cut with id "${id}".`);
        return { restored: true, id: m.id, text: m.text ?? null, new_duration_s: r3(useStore.getState().workingBuffer?.duration ?? 0) };
      },
      summarize: (r) => `Restored “${(r as { text?: string }).text ?? 'cut'}”`,
    },
    {
      name: 'suggest_cuts',
      description: 'Scan the transcript and audio for things worth cutting and return candidates without changing anything: filler words, stutters ("the the"), false starts ("I think I think"), flubs/asides ("sorry, I lost my place"), repeated takes, plus pauses longer than the preferred maximum. Each candidate has from_id/to_id, the text, a reason and confidence. Respects the user\'s preferences (keep_fillers, filler_confidence, max_pause_s). Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          kinds: { type: 'array', items: { type: 'string', enum: KINDS }, description: 'Subset of candidate kinds. Default all.' },
          confidence: { type: 'string', enum: ['high', 'medium'], description: 'Minimum filler confidence. Default from preferences (high).' },
          max_pause_s: { type: 'number', description: 'Pauses longer than this are listed as pause candidates. Default from preferences (0.6).' },
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: true,
      destructive: false,
      untrusted: true,
      example: {},
      execute: async (input) => {
        const { s } = requireAudio();
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const kinds = Array.isArray(input.kinds) ? (input.kinds as unknown[]).filter((k): k is CandidateKind => KINDS.includes(k as CandidateKind)) : undefined;
        const conf = input.confidence === 'medium' ? 'medium' : input.confidence === 'high' ? 'high' : undefined;
        const cands = candidatesFor(s, kinds && kinds.length ? kinds : undefined, conf);
        const maxPause = Math.max(0.2, num(input.max_pause_s, s.preferences.max_pause_s));
        const pauses = await pauseItems(maxPause);
        const counts: Record<string, number> = {};
        for (const c of cands) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
        return {
          candidate_count: cands.length,
          counts,
          candidates: cands,
          pause_candidates: pauses.map((p) => ({ start: p.start, end: p.end, saves_s: p.saves, note: p.note })),
          estimated_savings_s: r3(cands.reduce((a, c) => a + (c.end - c.start), 0) + pauses.reduce((a, p) => a + p.saves, 0)),
          next: 'Pick the ones you agree with and call cut_text (or propose_cut_text); tighten_pauses handles the pause candidates; clean_for_release does all high-confidence ones at once.',
        };
      },
      summarize: (r) => { const x = r as { candidate_count?: number; pause_candidates?: unknown[]; status?: string }; return x.candidate_count != null ? `${x.candidate_count} text candidates · ${x.pause_candidates?.length ?? 0} long pauses` : (x.status ?? 'pending'); },
    },

    // ---------------------------------------------------------------- MACROS
    {
      name: 'remove_fillers',
      description: 'Remove every filler word in one call (um, uh, and comma-set-off like / so / you know), honouring the user\'s keep_fillers preference. mode "apply" (default) cuts immediately in one undoable step; "propose" creates pending markers instead.',
      inputSchema: {
        type: 'object',
        properties: {
          confidence: { type: 'string', enum: ['high', 'medium'], description: 'Minimum confidence. Default from preferences (high = only um/uh-type).' },
          mode: MODE_SCHEMA,
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: true,
      example: { confidence: 'high', mode: 'apply' },
      execute: async (input) => {
        const { s } = requireAudio();
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const conf = input.confidence === 'medium' ? 'medium' : 'high';
        const cands = candidatesFor(s, ['filler'], conf);
        if (!cands.length) return { removed_count: 0, hint: 'No fillers found at this confidence.' };
        const r = await performTextCuts({ items: cands.map((c) => ({ from: c.from_id, to: c.to_id, reason: c.reason })), mode: modeOf(input.mode), author: 'agent' });
        return { mode: modeOf(input.mode), count: r.results.length, removed_s: r.removed_s, new_duration_s: r.new_duration_s, cuts: r.results };
      },
      summarize: (r) => { const x = r as { count?: number; removed_s?: number; mode?: string; status?: string }; return x.count != null ? `${x.mode === 'propose' ? 'Proposed' : 'Removed'} ${x.count} fillers · ${x.removed_s}s` : (x.status ?? 'nothing to do'); },
    },
    {
      name: 'tighten_pauses',
      description: 'Shorten every pause longer than max_pause_s down to max_pause_s (keeps breathing room, removes dead air) by cutting the middle of each silence. mode "apply" (default) or "propose".',
      inputSchema: {
        type: 'object',
        properties: {
          max_pause_s: { type: 'number', description: 'Longest pause to keep, in seconds. Default from preferences (0.6).' },
          mode: MODE_SCHEMA,
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: true,
      example: { max_pause_s: 0.6 },
      execute: async (input) => {
        const { s } = requireAudio();
        const maxPause = Math.max(0.2, num(input.max_pause_s, s.preferences.max_pause_s));
        const items = await pauseItems(maxPause);
        const out = await performRangeOps(items, modeOf(input.mode), 'agent');
        return { mode: modeOf(input.mode), max_pause_s: maxPause, count: out.length, saved_s: r3(items.reduce((a, p) => a + p.saves, 0)), pauses: out, new_duration_s: r3(useStore.getState().workingBuffer?.duration ?? 0) };
      },
      summarize: (r) => { const x = r as { count: number; saved_s: number; mode: string }; return `${x.mode === 'propose' ? 'Proposed tightening' : 'Tightened'} ${x.count} pauses · ${x.saved_s}s`; },
    },
    {
      name: 'trim_edges',
      description: 'Remove leading and trailing silence, leaving keep_s of room at each end. mode "apply" (default) or "propose".',
      inputSchema: { type: 'object', properties: { keep_s: { type: 'number', description: 'Silence to keep at each edge. Default 0.3.' }, mode: MODE_SCHEMA }, required: [], additionalProperties: false },
      readOnly: false,
      destructive: true,
      example: { keep_s: 0.3 },
      execute: async (input) => {
        requireAudio();
        const items = await edgeItems(Math.max(0, num(input.keep_s, 0.3)));
        const out = await performRangeOps(items, modeOf(input.mode), 'agent');
        return { count: out.length, edges: out, new_duration_s: r3(useStore.getState().workingBuffer?.duration ?? 0) };
      },
      summarize: (r) => `Trimmed ${(r as { count: number }).count} edge${(r as { count: number }).count === 1 ? '' : 's'}`,
    },
    {
      name: 'clean_for_release',
      description: 'The whole cleanup in one call: remove fillers/stutters/false starts/flubs at the chosen confidence, tighten long pauses, trim the edges, and lift quiet passages to the average level. mode "propose" creates pending markers grouped for review (recommended when the user wants control); "apply" (default) performs everything as one undoable step. Returns a summary with seconds saved.',
      inputSchema: {
        type: 'object',
        properties: {
          mode: MODE_SCHEMA,
          filler_confidence: { type: 'string', enum: ['high', 'medium'], description: 'Default from preferences (high).' },
          max_pause_s: { type: 'number', description: 'Default from preferences (0.6).' },
          level: { type: 'boolean', description: 'Also lift quiet passages. Default true.' },
          trim: { type: 'boolean', description: 'Also trim leading/trailing silence. Default true.' },
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: true,
      example: { mode: 'propose' },
      execute: async (input) => {
        const { s } = requireAudio();
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const mode = modeOf(input.mode);
        const conf = input.filler_confidence === 'medium' ? 'medium' : 'high';
        const maxPause = Math.max(0.2, num(input.max_pause_s, s.preferences.max_pause_s));
        const cands = candidatesFor(s, undefined, conf).filter((c) => c.confidence === 'high' || (c.kind === 'filler' && conf === 'medium'));
        const text = cands.length ? await performTextCuts({ items: cands.map((c) => ({ from: c.from_id, to: c.to_id, reason: c.reason })), mode, author: 'agent' }) : null;
        const pauses = await pauseItems(maxPause);
        const edges = input.trim === false ? [] : await edgeItems(0.3);
        const levels = input.level === false ? [] : await levelItems();
        const rangeOut = await performRangeOps([...pauses, ...edges, ...levels], mode, 'agent');
        const counts: Record<string, number> = {};
        for (const c of cands) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
        const saved = (text?.removed_s ?? 0) + pauses.reduce((a, p) => a + p.saves, 0) + edges.reduce((a, e) => a + (e.end - e.start), 0);
        return {
          mode,
          text_cuts: text?.results.length ?? 0,
          by_kind: counts,
          pauses_tightened: pauses.length,
          edges_trimmed: edges.length,
          quiet_passages_lifted: levels.length,
          seconds_saved: r3(saved),
          new_duration_s: r3(useStore.getState().workingBuffer?.duration ?? 0),
          items: [...(text?.results ?? []), ...rangeOut],
          next: mode === 'propose' ? 'Call request_review so the human can listen and approve, then wait_for_decisions and apply_proposals.' : 'Done. undo reverses the whole cleanup; restore_cut reverses one cut.',
        };
      },
      summarize: (r) => { const x = r as { mode: string; text_cuts: number; pauses_tightened: number; quiet_passages_lifted: number; seconds_saved: number; status?: string }; return x.mode ? `${x.mode === 'propose' ? 'Proposed' : 'Applied'} ${x.text_cuts} text cuts · ${x.pauses_tightened} pauses · ${x.quiet_passages_lifted} lifts · saved ${x.seconds_saved}s` : (x.status ?? 'pending'); },
    },
    {
      name: 'level_speakers',
      description: 'Find passages that are ≥ 5 dB quieter than the track average (a quiet guest) and lift them to the average with region gains (max +12 dB). mode "apply" (default) or "propose".',
      inputSchema: { type: 'object', properties: { mode: MODE_SCHEMA, max_gain_db: { type: 'number', description: 'Cap per passage. Default 12.' } }, required: [], additionalProperties: false },
      readOnly: false,
      destructive: true,
      example: {},
      execute: async (input) => {
        requireAudio();
        const items = await levelItems(Math.max(1, Math.min(24, num(input.max_gain_db, 12))));
        const out = await performRangeOps(items, modeOf(input.mode), 'agent');
        return { count: out.length, passages: out, hint: out.length ? undefined : 'Levels are already consistent.' };
      },
      summarize: (r) => `${(r as { count: number }).count} passage${(r as { count: number }).count === 1 ? '' : 's'} levelled`,
    },

    // ------------------------------------------------------------ REVIEW LOOP
    {
      name: 'request_review',
      description: 'Ask the human to review pending proposals now. Opens Review mode in the app: each proposal auto-plays with 1 s of context and the human approves/rejects with one key, optionally giving a reason. Pass a short message explaining what you did. Returns immediately; follow with wait_for_decisions.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Marker ids to review. Default: every pending proposal.' },
          message: { type: 'string', description: 'One or two sentences shown to the human, e.g. "I proposed 9 cuts: 6 fillers, 2 pauses, 1 flub."' },
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: false,
      example: { message: 'I proposed 9 cuts — 6 fillers, 2 long pauses and one flub. Reject anything that sounds unnatural.' },
      execute: (input) => {
        const { s } = requireAudio();
        const ids = Array.isArray(input.ids) ? (input.ids as unknown[]).map(String) : null;
        const pending = s.markers.filter((m) => m.status === 'pending' && (!ids || ids.includes(m.id)));
        if (!pending.length) return { review_mode: false, pending: 0, hint: 'Nothing is pending. Create proposals first (propose_cut_text, clean_for_release mode "propose", …).' };
        const cuts = getCuts(s);
        const first = [...pending].sort((a, b) => (markerWorkingRange(a, cuts)?.start ?? 1e9) - (markerWorkingRange(b, cuts)?.start ?? 1e9))[0];
        s.setReview({ active: true, ids: ids, message: str(input.message).trim() || null, startedAt: Date.now() });
        s.setFocusedMarker(first.id);
        return { review_mode: true, pending: pending.length, next: 'Call wait_for_decisions to block until the human is done.' };
      },
      summarize: (r) => { const x = r as { pending: number; review_mode: boolean }; return x.review_mode ? `Review requested · ${x.pending} pending` : 'Nothing to review'; },
    },
    {
      name: 'wait_for_decisions',
      description: 'Block until the human has approved or rejected every pending proposal (or the ones passed to request_review), or until timeout_s (default 60, max 120). Returns approved ids, rejected ids with the human\'s reasons, and anything still pending. Call apply_proposals afterwards.',
      inputSchema: { type: 'object', properties: { timeout_s: { type: 'number', description: 'Seconds to wait. Default 60, max 120.' } }, required: [], additionalProperties: false },
      readOnly: true,
      destructive: false,
      example: { timeout_s: 60 },
      execute: async (input) => {
        const { s } = requireAudio();
        const ids = s.review.ids;
        const timeout = Math.max(1, Math.min(120, num(input.timeout_s, 60))) * 1000;
        const inScope = (m: Marker) => m.kind !== 'comment' && m.kind !== 'chapter' && (!ids || ids.includes(m.id));
        const settled = () => !useStore.getState().markers.some((m) => inScope(m) && m.status === 'pending');
        const t0 = Date.now();
        if (!settled()) {
          await new Promise<void>((resolve) => {
            const unsub = useStore.subscribe((st) => { if (!st.markers.some((m) => inScope(m) && m.status === 'pending')) { unsub(); resolve(); } });
            setTimeout(() => { unsub(); resolve(); }, timeout);
          });
        }
        const st = useStore.getState();
        const cuts = getCuts(st);
        const since = st.review.startedAt ?? t0;
        const scoped = st.markers.filter(inScope);
        const view = (m: Marker) => markerView(m, cuts);
        const decidedNow = (m: Marker) => (m.decidedAt ?? 0) >= since - 1000;
        const approved = scoped.filter((m) => m.status === 'approved' && decidedNow(m)).map(view);
        const rejected = scoped.filter((m) => m.status === 'rejected' && decidedNow(m)).map(view);
        const pending = scoped.filter((m) => m.status === 'pending').map(view);
        if (!pending.length) st.setReview({ active: false });
        return { waited_s: r1((Date.now() - t0) / 1000), timed_out: pending.length > 0, approved_count: approved.length, rejected_count: rejected.length, approved, rejected, still_pending: pending, next: approved.length ? 'Call apply_proposals to apply the approved ones.' : 'Nothing approved yet.' };
      },
      summarize: (r) => { const x = r as { approved_count: number; rejected_count: number; timed_out: boolean }; return `${x.approved_count} approved · ${x.rejected_count} rejected${x.timed_out ? ' · timed out' : ''}`; },
    },
    {
      name: 'get_review_feedback',
      description: 'What the human has rejected or restored so far, with their reasons, aggregated by kind and by filler word — use it to adapt your next proposals (e.g. stop cutting "like" if they keep rejecting it). Read-only.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: true,
      destructive: false,
      example: {},
      execute: () => {
        const { s } = requireAudio();
        const cuts = getCuts(s);
        const rejected = s.markers.filter((m) => m.status === 'rejected');
        const approved = s.markers.filter((m) => m.status === 'approved' || m.status === 'applied').filter((m) => m.author === 'agent');
        const byKind: Record<string, { rejected: number; accepted: number }> = {};
        for (const m of rejected) { byKind[m.kind] = byKind[m.kind] ?? { rejected: 0, accepted: 0 }; byKind[m.kind].rejected++; }
        for (const m of approved) { byKind[m.kind] = byKind[m.kind] ?? { rejected: 0, accepted: 0 }; byKind[m.kind].accepted++; }
        const byWord: Record<string, number> = {};
        for (const m of rejected) if (m.text) { const w = m.text.toLowerCase().replace(/[^a-z' ]/g, '').trim(); if (w && w.split(' ').length <= 2) byWord[w] = (byWord[w] ?? 0) + 1; }
        const advice: string[] = [];
        for (const [w, n] of Object.entries(byWord)) if (n >= 2) advice.push(`The human rejected "${w}" cuts ${n} times — stop proposing them (or call set_preferences keep_fillers).`);
        const timing = rejected.filter((m) => m.feedback?.reason === 'wrong timing').length;
        if (timing >= 2) advice.push('Several rejections cite wrong timing — prefer keep_pause "both" or propose instead of applying.');
        return { rejected_count: rejected.length, accepted_count: approved.length, by_kind: byKind, rejected_words: byWord, rejected: rejected.map((m) => markerView(m, cuts)), reasons_available: REJECT_REASONS, advice, preferences: s.preferences };
      },
      summarize: (r) => { const x = r as { rejected_count: number; accepted_count: number }; return `${x.accepted_count} accepted · ${x.rejected_count} rejected`; },
    },
    {
      name: 'set_preferences',
      description: 'Remember the user\'s editing preferences (persisted in the browser and echoed by get_status): filler words to always keep, the longest pause to keep, minimum filler confidence, and free-text style notes. The macros honour them.',
      inputSchema: {
        type: 'object',
        properties: {
          keep_fillers: { type: 'array', items: { type: 'string' }, description: 'Words never to cut, e.g. ["like", "so"].' },
          max_pause_s: { type: 'number', description: 'Longest pause to keep when tightening. 0.2–3.' },
          filler_confidence: { type: 'string', enum: ['high', 'medium'], description: 'Default minimum confidence for filler removal.' },
          style_notes: { type: 'string', description: 'Free text, e.g. "conversational, keep laughs".' },
        },
        required: [],
        additionalProperties: false,
      },
      readOnly: false,
      destructive: false,
      example: { keep_fillers: ['like'], max_pause_s: 0.8 },
      execute: (input) => {
        const patch: Partial<Preferences> = {};
        if (Array.isArray(input.keep_fillers)) patch.keep_fillers = (input.keep_fillers as unknown[]).map((w) => String(w).toLowerCase().trim()).filter(Boolean);
        if (typeof input.max_pause_s === 'number') patch.max_pause_s = Math.max(0.2, Math.min(3, input.max_pause_s));
        if (input.filler_confidence === 'high' || input.filler_confidence === 'medium') patch.filler_confidence = input.filler_confidence;
        if (typeof input.style_notes === 'string') patch.style_notes = input.style_notes.slice(0, 500);
        useStore.getState().setPreferences(patch);
        return { preferences: useStore.getState().preferences };
      },
      summarize: (r) => { const p = (r as { preferences: Preferences }).preferences; return `keep ${p.keep_fillers.length ? p.keep_fillers.join('/') : 'none'} · pause ≤ ${p.max_pause_s}s · ${p.filler_confidence}`; },
    },

    // ------------------------------------------------------------- POINTING
    {
      name: 'play',
      description: 'Play audio to the human from start (seconds), stopping at end if given, so they can hear what you mean. Non-destructive.',
      inputSchema: { type: 'object', properties: { start: { type: 'number', description: 'Start in seconds. Default: current playhead.' }, end: { type: 'number', description: 'Optional stop time in seconds.' } }, required: [], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: { start: 30, end: 34 },
      execute: async (input) => {
        const { s, duration } = requireAudio();
        const start = Math.max(0, Math.min(duration, num(input.start, s.playhead)));
        const end = typeof input.end === 'number' ? Math.max(start, Math.min(duration, input.end)) : undefined;
        await player.playRange(start, end);
        player.scrollTo(Math.max(0, start - 1));
        return { playing: true, start: r3(start), ...(end != null ? { end: r3(end) } : {}) };
      },
      summarize: (r) => { const x = r as { start: number; end?: number }; return `Playing ${ts(x.start)}${x.end != null ? ` → ${ts(x.end)}` : ''}`; },
    },
    {
      name: 'stop',
      description: 'Stop playback.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: {},
      execute: () => { requireAudio(); player.pause(); return { playing: false, playhead_s: r3(player.currentTime) }; },
      summarize: () => 'Stopped',
    },
    {
      name: 'zoom_to',
      description: 'Zoom the waveform so the range fills the view and scroll to it. Pair with set_selection or play to point at something.',
      inputSchema: { type: 'object', properties: { start: { type: 'number', description: 'Range start in seconds.' }, end: { type: 'number', description: 'Range end in seconds.' } }, required: ['start', 'end'], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: { start: 28, end: 34 },
      execute: (input) => {
        const { duration } = requireAudio();
        const range = requireRange(input, duration);
        player.zoomTo(range.start, range.end);
        return { ...range, zoom: r1(useStore.getState().zoom) };
      },
      summarize: (r) => { const x = r as { start: number; end: number }; return `Zoomed to ${ts(x.start)} → ${ts(x.end)}`; },
    },

    // ---------------------------------------------------------------- OUTPUT
    {
      name: 'export_transcript',
      description: 'Download the transcript of the EDITED audio (cuts removed, times shifted) as SRT or VTT captions, plain text, or JSON. Returns file name, size and cue count.',
      inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['srt', 'vtt', 'txt', 'json'], description: 'Default "srt".' } }, required: [], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: { format: 'srt' },
      execute: async (input) => {
        const { s } = requireAudio();
        const res = await transcriptOrStatus();
        if (!('transcript' in res)) return res;
        const cuts = getCuts(s);
        const segments = workingSegments(res.transcript, cuts);
        const format = ['srt', 'vtt', 'txt', 'json'].includes(str(input.format)) ? str(input.format) : 'srt';
        const base = (s.fileName ?? 'earshot').replace(/\.[^.]+$/, '');
        const body = format === 'srt' ? toSrt(segments) : format === 'vtt' ? toVtt(segments) : format === 'txt' ? toPlainText(segments) : JSON.stringify({ words: workingWords(res.transcript, cuts), segments }, null, 1);
        const mime = format === 'json' ? 'application/json' : format === 'vtt' ? 'text/vtt' : 'text/plain';
        const bytes = downloadText(`${base}-earshot.${format}`, body, mime);
        return { file_name: `${base}-earshot.${format}`, format, bytes, cues: segments.length };
      },
      summarize: (r) => { const x = r as { file_name?: string; cues?: number; status?: string }; return x.file_name ? `Downloaded ${x.file_name} (${x.cues} cues)` : (x.status ?? 'pending'); },
    },
    {
      name: 'add_chapter_marker',
      description: 'Add a chapter at time (seconds) with a title, e.g. from topic changes in the transcript. Chapters appear on the timeline and in export_chapters.',
      inputSchema: { type: 'object', properties: { time: { type: 'number', description: 'Chapter start in seconds.' }, title: { type: 'string', description: 'Short chapter title.' } }, required: ['time', 'title'], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: { time: 12.5, title: 'The big idea' },
      execute: (input) => {
        const { duration } = requireAudio();
        const time = num(input.time, NaN);
        if (!Number.isFinite(time) || time < 0 || time > duration) throw new ToolError(`"time" must be between 0 and ${r3(duration)}.`);
        const title = str(input.title).trim() || 'Chapter';
        const m = useStore.getState().addMarker({ kind: 'chapter', start: time, end: time, note: title, author: 'agent' });
        return { id: m.id, time: r3(time), title };
      },
      summarize: (r) => { const x = r as { time: number; title: string }; return `Chapter “${x.title}” at ${ts(x.time)}`; },
    },
    {
      name: 'export_chapters',
      description: 'Return (and download) the chapter list as YouTube-style timestamps ("01:23 Title") or JSON, on the edited timeline. An "Intro" at 00:00 is added if the first chapter starts later.',
      inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['youtube', 'json'], description: 'Default "youtube".' }, download: { type: 'boolean', description: 'Also download a file. Default true.' } }, required: [], additionalProperties: false },
      readOnly: false,
      destructive: false,
      example: { format: 'youtube' },
      execute: (input) => {
        const { s } = requireAudio();
        const cuts = getCuts(s);
        const chapters = s.markers.filter((m) => m.kind === 'chapter').map((m) => ({ time: markerWorkingRange(m, cuts)?.start ?? sourceToWorking(m.start, cuts), title: m.note })).sort((a, b) => a.time - b.time);
        if (!chapters.length) throw new ToolError('No chapters yet — call add_chapter_marker first.');
        const format = str(input.format, 'youtube') === 'json' ? 'json' : 'youtube';
        const text = format === 'json' ? JSON.stringify(chapters.map((c) => ({ time: r3(c.time), title: c.title })), null, 1) : chaptersToYouTube(chapters);
        const base = (s.fileName ?? 'earshot').replace(/\.[^.]+$/, '');
        const bytes = input.download === false ? 0 : downloadText(`${base}-chapters.${format === 'json' ? 'json' : 'txt'}`, text, format === 'json' ? 'application/json' : 'text/plain');
        return { format, count: chapters.length, text, bytes };
      },
      summarize: (r) => `${(r as { count: number }).count} chapters exported`,
    },
  ];
}

export { REJECT_REASONS };
export type { IdWord };
