/**
 * Worker client for the analysis functions. Falls back to running inline if Workers are unavailable.
 * Channel data is copied before transfer so the AudioBuffer is never detached.
 */
import type { ClipRegion, LoudnessProfile, SilenceRegion } from '../types';
import type { Range } from './edl';
import { detectClipping, detectSilences, loudnessProfile, segmentLoudness, type SilenceOptions, type SpeakerSegment } from './analysis';
import { toMono } from './decode';

export type AnalysisRequest =
  | { id: number; kind: 'silences'; mono: Float32Array; sampleRate: number; opts: SilenceOptions }
  | { id: number; kind: 'loudness'; mono: Float32Array; sampleRate: number; windowS: number }
  | { id: number; kind: 'clipping'; channels: Float32Array[]; sampleRate: number; threshold: number }
  | { id: number; kind: 'segments'; mono: Float32Array; sampleRate: number; segments?: Range[] };

export type AnalysisResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<AnalysisResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('analysis worker crashed'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function run<T>(req: DistributiveOmit<AnalysisRequest, 'id'>, transfer: ArrayBuffer[]): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.resolve(runInline(req as AnalysisRequest) as T);
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject });
    w.postMessage({ ...req, id }, transfer);
  });
}

function runInline(req: AnalysisRequest): unknown {
  switch (req.kind) {
    case 'silences': return detectSilences(req.mono, req.sampleRate, req.opts);
    case 'loudness': return loudnessProfile(req.mono, req.sampleRate, req.windowS);
    case 'clipping': return detectClipping(req.channels, req.sampleRate, req.threshold);
    case 'segments': return segmentLoudness(req.mono, req.sampleRate, req.segments);
  }
}

const monoCache = new WeakMap<AudioBuffer, Float32Array>();
function monoOf(buffer: AudioBuffer): Float32Array {
  let m = monoCache.get(buffer);
  if (!m) { m = toMono(buffer); monoCache.set(buffer, m); }
  return m;
}
function copy(x: Float32Array): Float32Array<ArrayBuffer> {
  const c = new Float32Array(x.length);
  c.set(x);
  return c;
}

export function analyzeSilences(buffer: AudioBuffer, opts: SilenceOptions): Promise<SilenceRegion[]> {
  const mono = copy(monoOf(buffer));
  return run<SilenceRegion[]>({ kind: 'silences', mono, sampleRate: buffer.sampleRate, opts }, [mono.buffer]);
}

export function analyzeLoudness(buffer: AudioBuffer, windowS: number): Promise<LoudnessProfile> {
  const mono = copy(monoOf(buffer));
  return run<LoudnessProfile>({ kind: 'loudness', mono, sampleRate: buffer.sampleRate, windowS }, [mono.buffer]);
}

export function analyzeClipping(buffer: AudioBuffer, threshold: number): Promise<{ regions: ClipRegion[]; clippedSamples: number }> {
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(copy(buffer.getChannelData(ch)));
  return run({ kind: 'clipping', channels, sampleRate: buffer.sampleRate, threshold }, channels.map((c) => c.buffer));
}

export function analyzeSegments(buffer: AudioBuffer, segments?: Range[]): Promise<{ segments: SpeakerSegment[]; integrated_db: number }> {
  const mono = copy(monoOf(buffer));
  return run({ kind: 'segments', mono, sampleRate: buffer.sampleRate, segments }, [mono.buffer]);
}

export { monoOf };
