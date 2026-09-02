/**
 * Transcript service: memory cache -> IndexedDB cache -> bundled demo transcript -> /api/transcribe.
 * Uploads are 16 kHz mono WAV chunks (<= 120 s, split at the quietest point) so each request stays
 * under Vercel's 4.5 MB body limit and long files still work. Times are on the SOURCE timeline.
 */
import { useStore } from '../store/useStore';
import type { Transcript, TranscriptSegment, TranscriptState, TranscriptWord } from '../types';
import { encodeWav } from '../audio/wav';
import { windowRms } from '../audio/analysis';

const DB_NAME = 'earshot';
const STORE = 'transcripts';
const memory = new Map<string, Transcript>();
const TARGET_SR = 16000;
const MAX_CHUNK_S = 120;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(hash: string): Promise<Transcript | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(hash);
      r.onsuccess = () => resolve((r.result as Transcript) ?? null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function cachePut(hash: string, t: Transcript): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(t, hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

async function bundledDemo(hash: string): Promise<Transcript | null> {
  try {
    const res = await fetch('/demo-transcript.json', { cache: 'force-cache' });
    if (!res.ok) return null;
    const j = await res.json();
    if (j?.hash !== hash) return null;
    return { text: j.text, words: j.words, segments: j.segments, language: j.language };
  } catch { return null; }
}

async function resampleMono(source: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(source.duration * TARGET_SR);
  const ctx = new OfflineAudioContext(1, length, TARGET_SR);
  const src = ctx.createBufferSource();
  src.buffer = source;
  src.connect(ctx.destination);
  src.start(0);
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

/** Split into chunks <= MAX_CHUNK_S, cutting at the quietest 20 ms window in the last 10 s of each chunk. */
function chunkPoints(mono: Float32Array): number[] {
  const total = mono.length / TARGET_SR;
  if (total <= MAX_CHUNK_S) return [0, total];
  const win = 0.02;
  const rms = windowRms(mono, TARGET_SR, win);
  const points = [0];
  let pos = 0;
  while (total - pos > MAX_CHUNK_S) {
    const lo = Math.floor((pos + MAX_CHUNK_S - 10) / win);
    const hi = Math.floor((pos + MAX_CHUNK_S) / win);
    let best = hi, bestV = Infinity;
    for (let w = lo; w < hi; w++) if (rms[w] < bestV) { bestV = rms[w]; best = w; }
    pos = best * win;
    points.push(pos);
  }
  points.push(total);
  return points;
}

async function transcribeViaApi(source: AudioBuffer, onProgress: (p: number, note: string) => void): Promise<Transcript> {
  onProgress(0.05, 'Preparing audio');
  const mono = await resampleMono(source);
  const points = chunkPoints(mono);
  const n = points.length - 1;
  const words: TranscriptWord[] = [];
  const segments: TranscriptSegment[] = [];
  const texts: string[] = [];
  let language: string | undefined;
  for (let i = 0; i < n; i++) {
    const a = Math.round(points[i] * TARGET_SR), b = Math.round(points[i + 1] * TARGET_SR);
    const offset = points[i];
    onProgress(0.1 + (0.85 * i) / n, n > 1 ? `Transcribing part ${i + 1} of ${n}` : 'Transcribing');
    const wav = encodeWav([mono.subarray(a, b)], TARGET_SR);
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'audio/wav', 'x-earshot-offset': String(offset) },
      body: wav,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error ?? `Transcription failed (${res.status})`);
    language = language ?? j.language;
    texts.push(String(j.text ?? '').trim());
    for (const w of j.words ?? []) words.push({ text: String(w.text), start: r3(w.start + offset), end: r3(w.end + offset) });
    for (const s of j.segments ?? []) segments.push({ id: segments.length, text: String(s.text).trim(), start: r3(s.start + offset), end: r3(s.end + offset) });
  }
  return { text: texts.join(' '), words, segments, language };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
let inflight: Promise<TranscriptState> | null = null;

/** Idempotent: returns the current state, kicking off transcription if needed. */
export function ensureTranscript(opts: { force?: boolean } = {}): Promise<TranscriptState> {
  const s = useStore.getState();
  if (!s.sourceBuffer || !s.fileHash) return Promise.resolve({ status: 'error', message: 'No audio loaded' });
  if (!opts.force && s.transcript.status === 'ready') return Promise.resolve(s.transcript);
  if (inflight) return inflight;
  const hash = s.fileHash;
  const buffer = s.sourceBuffer;
  const set = (t: TranscriptState) => { if (useStore.getState().fileHash === hash) useStore.getState().setTranscript(t); };

  inflight = (async (): Promise<TranscriptState> => {
    try {
      if (!opts.force) {
        const cached = memory.get(hash) ?? (await cacheGet(hash)) ?? (await bundledDemo(hash));
        if (cached) {
          memory.set(hash, cached);
          const st: TranscriptState = { status: 'ready', transcript: cached, cached: true };
          set(st);
          return st;
        }
      }
      set({ status: 'transcribing', startedAt: Date.now(), progress: 0, note: 'Starting' });
      const t = await transcribeViaApi(buffer, (progress, note) => set({ status: 'transcribing', startedAt: Date.now(), progress, note }));
      memory.set(hash, t);
      await cachePut(hash, t);
      const st: TranscriptState = { status: 'ready', transcript: t, cached: false };
      set(st);
      return st;
    } catch (e) {
      const st: TranscriptState = { status: 'error', message: (e as Error).message ?? String(e) };
      set(st);
      return st;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
