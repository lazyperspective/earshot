/**
 * Pure signal analysis. Everything works on an *Envelope*: per-10 ms mean-square, peak and clipped-sample
 * counts computed in one pass over the channel data. A 2-hour episode becomes ~3 MB of envelope instead of
 * a 1.5 GB mono copy, so analysis stays fast and memory-flat. Times are seconds, levels are dBFS (RMS or
 * peak). We never claim LUFS (no K-weighting).
 */
import type { ClipRegion, LoudnessProfile, SilenceRegion } from '../types';
import type { Range } from './edl';

export const FLOOR_DB = -100;

export function toDb(lin: number): number {
  return lin <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(lin));
}
const msToDb = (ms: number) => (ms <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 10 * Math.log10(ms)));

export interface Envelope {
  sampleRate: number;
  hopS: number;
  /** Number of windows. */
  frames: number;
  duration: number;
  /** Mean square (linear) per window, channels averaged to mono. */
  ms: Float32Array;
  /** Peak absolute sample per window (any channel). */
  peak: Float32Array;
  /** Samples inside clipped runs (>= 2 consecutive samples at/above threshold) per window. */
  clipped: Uint16Array;
  clipThreshold: number;
  sumSq: number;
  totalSamples: number;
}

export function newEnvelope(totalSamples: number, sampleRate: number, hopS = 0.01, clipThreshold = 0.99): Envelope {
  const hop = Math.max(1, Math.round(hopS * sampleRate));
  const frames = Math.max(1, Math.ceil(totalSamples / hop));
  return { sampleRate, hopS: hop / sampleRate, frames, duration: totalSamples / sampleRate, ms: new Float32Array(frames), peak: new Float32Array(frames), clipped: new Uint16Array(frames), clipThreshold, sumSq: 0, totalSamples };
}

/** Fill windows [fromWindow, toWindow) of `env` from the channel data (no copies). */
export function accumulateEnvelope(env: Envelope, channels: ArrayLike<number>[], fromWindow: number, toWindow: number): void {
  const hop = Math.round(env.hopS * env.sampleRate);
  const n = channels.length;
  const thr = env.clipThreshold;
  const total = env.totalSamples;
  let run = 0;
  for (let w = fromWindow; w < toWindow; w++) {
    const a = w * hop;
    const b = Math.min(total, a + hop);
    let sum = 0, pk = 0, clipped = 0;
    for (let i = a; i < b; i++) {
      let v = 0, hot = false;
      for (let c = 0; c < n; c++) {
        const x = channels[c][i];
        v += x;
        const ax = x < 0 ? -x : x;
        if (ax > pk) pk = ax;
        if (ax >= thr) hot = true;
      }
      if (n > 1) v /= n;
      sum += v * v;
      if (hot) { run++; if (run === 2) clipped += 2; else if (run > 2) clipped++; }
      else run = 0;
    }
    env.ms[w] = b > a ? sum / (b - a) : 0;
    env.peak[w] = pk;
    env.clipped[w] = Math.min(65535, clipped);
    env.sumSq += sum;
  }
}

/** Synchronous full-pass envelope (small buffers, tests). */
export function computeEnvelope(channels: ArrayLike<number>[], sampleRate: number, hopS = 0.01, clipThreshold = 0.99): Envelope {
  const env = newEnvelope(channels[0]?.length ?? 0, sampleRate, hopS, clipThreshold);
  accumulateEnvelope(env, channels, 0, env.frames);
  return env;
}

export const integratedDb = (env: Envelope): number => msToDb(env.totalSamples ? env.sumSq / env.totalSamples : 0);
export function peakDbOf(env: Envelope, fromW = 0, toW = env.frames): number {
  let p = 0;
  for (let w = fromW; w < toW; w++) if (env.peak[w] > p) p = env.peak[w];
  return toDb(p);
}
export function rmsDbOf(env: Envelope, fromW: number, toW: number): number {
  const a = Math.max(0, fromW), b = Math.min(env.frames, toW);
  if (b <= a) return FLOOR_DB;
  let s = 0;
  for (let w = a; w < b; w++) s += env.ms[w];
  return msToDb(s / (b - a));
}
const winOf = (env: Envelope, t: number) => Math.round(t / env.hopS);

export interface SilenceOptions { thresholdDb?: number; minDurationS?: number; windowS?: number; start?: number; end?: number }

export function detectSilencesEnv(env: Envelope, opts: SilenceOptions = {}): SilenceRegion[] {
  const thresholdDb = opts.thresholdDb ?? -40;
  const minDurationS = opts.minDurationS ?? 0.7;
  const w0 = Math.max(0, winOf(env, opts.start ?? 0));
  const w1 = Math.min(env.frames, opts.end != null ? winOf(env, opts.end) : env.frames);
  const out: SilenceRegion[] = [];
  let runStart = -1;
  const flush = (endW: number) => {
    if (runStart < 0) return;
    const start = runStart * env.hopS;
    const end = Math.min(env.duration, endW * env.hopS);
    if (end - start >= minDurationS) out.push({ start: r3(start), end: r3(end), duration: r3(end - start) });
    runStart = -1;
  };
  for (let w = w0; w < w1; w++) {
    if (msToDb(env.ms[w]) < thresholdDb) { if (runStart < 0) runStart = w; }
    else flush(w);
  }
  flush(w1);
  return out;
}

export function loudnessProfileEnv(env: Envelope, windowS = 1): LoudnessProfile {
  const group = Math.max(1, Math.round(windowS / env.hopS));
  const count = Math.ceil(env.frames / group);
  const points: LoudnessProfile['points'] = [];
  const voiced: number[] = [];
  for (let g = 0; g < count; g++) {
    const a = g * group, b = Math.min(env.frames, a + group);
    const r = rmsDbOf(env, a, b);
    points.push({ t: r3(a * env.hopS), rms_db: r1(r), peak_db: r1(peakDbOf(env, a, b)) });
    if (r > -60) voiced.push(r);
  }
  voiced.sort((x, y) => x - y);
  const pct = (q: number) => (voiced.length ? voiced[Math.min(voiced.length - 1, Math.floor(q * voiced.length))] : FLOOR_DB);
  return { window_s: group * env.hopS, points, integrated_db: r1(integratedDb(env)), peak_db: r1(peakDbOf(env)), dynamic_range_db: r1(voiced.length ? pct(0.95) - pct(0.1) : 0), unit: 'dBFS RMS' };
}

export function detectClippingEnv(env: Envelope): { regions: ClipRegion[]; clippedSamples: number } {
  const regions: ClipRegion[] = [];
  let clippedSamples = 0;
  for (let w = 0; w < env.frames; w++) {
    const c = env.clipped[w];
    if (!c) continue;
    clippedSamples += c;
    const start = w * env.hopS, end = Math.min(env.duration, (w + 1) * env.hopS);
    const last = regions[regions.length - 1];
    if (last && start - last.end <= env.hopS + 1e-6) { last.end = r3(end); last.samples += c; }
    else regions.push({ start: r3(start), end: r3(end), samples: c });
  }
  return { regions, clippedSamples };
}

export function normalizeGainEnv(env: Envelope, targetDb: number, mode: 'rms' | 'peak'): { gainDb: number; measuredDb: number; peakDb: number; limitedByPeak: boolean } {
  const pk = peakDbOf(env);
  const measured = mode === 'peak' ? pk : integratedDb(env);
  let gain = targetDb - measured;
  const ceiling = -0.1;
  let limited = false;
  if (pk + gain > ceiling) { gain = ceiling - pk; limited = true; }
  return { gainDb: r2(gain), measuredDb: r1(measured), peakDb: r1(pk), limitedByPeak: limited };
}

export interface SpeakerSegment { start: number; end: number; duration: number; mean_rms_db: number; peak_db: number; quiet: boolean; loud: boolean }

/** Per-segment loudness. Segments default to speech runs split by pauses >= 0.6 s. */
export function segmentLoudnessEnv(env: Envelope, segments?: Range[]): { segments: SpeakerSegment[]; integrated_db: number } {
  let segs = segments;
  if (!segs || segs.length === 0) {
    const pauses = detectSilencesEnv(env, { thresholdDb: -40, minDurationS: 0.6 });
    segs = [];
    let pos = 0;
    for (const p of pauses) { if (p.start - pos > 0.5) segs.push({ start: pos, end: p.start }); pos = p.end; }
    if (env.duration - pos > 0.5) segs.push({ start: pos, end: env.duration });
  }
  const integrated = integratedDb(env);
  const out: SpeakerSegment[] = segs.map((s) => {
    const a = winOf(env, s.start), b = Math.max(a + 1, winOf(env, s.end));
    const r = rmsDbOf(env, a, b);
    return { start: r3(s.start), end: r3(s.end), duration: r3(s.end - s.start), mean_rms_db: r1(r), peak_db: r1(peakDbOf(env, a, b)), quiet: r < integrated - 5, loud: r > integrated + 5 };
  });
  return { segments: out, integrated_db: r1(integrated) };
}

/** Time (s) of the quietest window inside [fromS, toS]. */
export function quietestTime(env: Envelope, fromS: number, toS: number): number {
  const a = Math.max(0, winOf(env, fromS)), b = Math.min(env.frames, winOf(env, toS));
  let best = a, bestV = Infinity;
  for (let w = a; w < b; w++) if (env.ms[w] < bestV) { bestV = env.ms[w]; best = w; }
  return best * env.hopS;
}

// ---------------------------------------------------------------- mono conveniences (tests, small buffers)

export function rmsDb(x: Float32Array, a = 0, b = x.length): number {
  const s = Math.max(0, a), e = Math.min(x.length, b);
  if (e <= s) return FLOOR_DB;
  let acc = 0;
  for (let i = s; i < e; i++) acc += x[i] * x[i];
  return toDb(Math.sqrt(acc / (e - s)));
}
export function peakDb(x: Float32Array, a = 0, b = x.length): number {
  const s = Math.max(0, a), e = Math.min(x.length, b);
  let p = 0;
  for (let i = s; i < e; i++) { const v = Math.abs(x[i]); if (v > p) p = v; }
  return toDb(p);
}
export function windowRms(mono: Float32Array, sampleRate: number, windowS: number): Float64Array {
  const n = Math.max(1, Math.round(windowS * sampleRate));
  const count = Math.ceil(mono.length / n);
  const out = new Float64Array(count);
  for (let w = 0; w < count; w++) out[w] = rmsDb(mono, w * n, Math.min(mono.length, (w + 1) * n));
  return out;
}
export function detectSilences(mono: Float32Array, sampleRate: number, opts: SilenceOptions = {}): SilenceRegion[] {
  return detectSilencesEnv(computeEnvelope([mono], sampleRate, opts.windowS ?? 0.01), opts);
}
export function loudnessProfile(mono: Float32Array, sampleRate: number, windowS = 1): LoudnessProfile {
  return loudnessProfileEnv(computeEnvelope([mono], sampleRate, 0.01), windowS);
}
export function detectClipping(channels: Float32Array[], sampleRate: number, threshold = 0.99): { regions: ClipRegion[]; clippedSamples: number } {
  return detectClippingEnv(computeEnvelope(channels, sampleRate, 0.01, threshold));
}
export function computeNormalizeGain(mono: Float32Array, targetDb: number, mode: 'rms' | 'peak') {
  return normalizeGainEnv(computeEnvelope([mono], 8000, 0.01), targetDb, mode);
}
export function segmentLoudness(mono: Float32Array, sampleRate: number, segments?: Range[]) {
  return segmentLoudnessEnv(computeEnvelope([mono], sampleRate, 0.01), segments);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
