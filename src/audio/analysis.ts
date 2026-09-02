/**
 * Pure signal analysis on Float32Array mono data. No Web Audio, no DOM: runs in a Worker and in Vitest.
 * All results are in seconds and dBFS (RMS or peak). We never claim LUFS (no K-weighting).
 */
import type { ClipRegion, LoudnessProfile, SilenceRegion } from '../types';
import type { Range } from './edl';

export const FLOOR_DB = -100;

export function toDb(lin: number): number {
  return lin <= 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(lin));
}

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

/** RMS in dB for each fixed window. */
export function windowRms(mono: Float32Array, sampleRate: number, windowS: number): Float64Array {
  const n = Math.max(1, Math.round(windowS * sampleRate));
  const count = Math.ceil(mono.length / n);
  const out = new Float64Array(count);
  for (let w = 0; w < count; w++) out[w] = rmsDb(mono, w * n, Math.min(mono.length, (w + 1) * n));
  return out;
}

export interface SilenceOptions {
  thresholdDb?: number;
  minDurationS?: number;
  windowS?: number;
}

/** RMS over 20ms windows; consecutive windows under threshold are merged; runs shorter than minDuration are dropped. */
export function detectSilences(mono: Float32Array, sampleRate: number, opts: SilenceOptions = {}): SilenceRegion[] {
  const thresholdDb = opts.thresholdDb ?? -40;
  const minDurationS = opts.minDurationS ?? 0.7;
  const windowS = opts.windowS ?? 0.02;
  const rms = windowRms(mono, sampleRate, windowS);
  const out: SilenceRegion[] = [];
  let runStart = -1;
  const flush = (endIdx: number) => {
    if (runStart < 0) return;
    const start = runStart * windowS;
    const end = Math.min(mono.length / sampleRate, endIdx * windowS);
    if (end - start >= minDurationS) out.push({ start: r3(start), end: r3(end), duration: r3(end - start) });
    runStart = -1;
  };
  for (let w = 0; w < rms.length; w++) {
    if (rms[w] < thresholdDb) { if (runStart < 0) runStart = w; }
    else flush(w);
  }
  flush(rms.length);
  return out;
}

export function loudnessProfile(mono: Float32Array, sampleRate: number, windowS = 1): LoudnessProfile {
  const n = Math.max(1, Math.round(windowS * sampleRate));
  const count = Math.ceil(mono.length / n);
  const points: LoudnessProfile['points'] = [];
  const voiced: number[] = [];
  for (let w = 0; w < count; w++) {
    const a = w * n, b = Math.min(mono.length, a + n);
    const r = rmsDb(mono, a, b);
    const p = peakDb(mono, a, b);
    points.push({ t: r3(a / sampleRate), rms_db: r1(r), peak_db: r1(p) });
    if (r > -60) voiced.push(r);
  }
  voiced.sort((x, y) => x - y);
  const pct = (q: number) => (voiced.length ? voiced[Math.min(voiced.length - 1, Math.floor(q * voiced.length))] : FLOOR_DB);
  const dyn = voiced.length ? pct(0.95) - pct(0.1) : 0;
  return {
    window_s: windowS,
    points,
    integrated_db: r1(rmsDb(mono)),
    peak_db: r1(peakDb(mono)),
    dynamic_range_db: r1(dyn),
    unit: 'dBFS RMS',
  };
}

/** Runs of >= minRun consecutive samples at or above threshold (absolute), merged when closer than 10ms. */
export function detectClipping(channels: Float32Array[], sampleRate: number, threshold = 0.99, minRun = 2): { regions: ClipRegion[]; clippedSamples: number } {
  const gap = Math.round(0.01 * sampleRate);
  const regions: ClipRegion[] = [];
  let clippedSamples = 0;
  for (const ch of channels) {
    let run = 0;
    for (let i = 0; i <= ch.length; i++) {
      const hot = i < ch.length && Math.abs(ch[i]) >= threshold;
      if (hot) { run++; continue; }
      if (run >= minRun) {
        const a = i - run, b = i;
        clippedSamples += run;
        const last = regions[regions.length - 1];
        if (last && a - Math.round(last.end * sampleRate) <= gap) { last.end = r3(b / sampleRate); last.samples += run; }
        else regions.push({ start: r3(a / sampleRate), end: r3(b / sampleRate), samples: run });
      }
      run = 0;
    }
  }
  regions.sort((x, y) => x.start - y.start);
  return { regions, clippedSamples };
}

export function computeNormalizeGain(mono: Float32Array, targetDb: number, mode: 'rms' | 'peak'): { gainDb: number; measuredDb: number; peakDb: number; limitedByPeak: boolean } {
  const pk = peakDb(mono);
  const measured = mode === 'peak' ? pk : rmsDb(mono);
  let gain = targetDb - measured;
  const ceiling = -0.1;
  let limited = false;
  if (pk + gain > ceiling) { gain = ceiling - pk; limited = true; }
  return { gainDb: r2(gain), measuredDb: r1(measured), peakDb: r1(pk), limitedByPeak: limited };
}

export interface SpeakerSegment {
  start: number;
  end: number;
  duration: number;
  mean_rms_db: number;
  peak_db: number;
  quiet: boolean;
  loud: boolean;
}

/** Per-segment loudness. Segments default to speech runs split by pauses >= 0.6s. */
export function segmentLoudness(mono: Float32Array, sampleRate: number, segments?: Range[]): { segments: SpeakerSegment[]; integrated_db: number } {
  let segs = segments;
  if (!segs || segs.length === 0) {
    const pauses = detectSilences(mono, sampleRate, { thresholdDb: -40, minDurationS: 0.6 });
    segs = [];
    let pos = 0;
    const dur = mono.length / sampleRate;
    for (const p of pauses) { if (p.start - pos > 0.5) segs.push({ start: pos, end: p.start }); pos = p.end; }
    if (dur - pos > 0.5) segs.push({ start: pos, end: dur });
  }
  const integrated = rmsDb(mono);
  const out: SpeakerSegment[] = segs.map((s) => {
    const a = Math.round(s.start * sampleRate), b = Math.round(s.end * sampleRate);
    const r = rmsDb(mono, a, b);
    return { start: r3(s.start), end: r3(s.end), duration: r3(s.end - s.start), mean_rms_db: r1(r), peak_db: r1(peakDb(mono, a, b)), quiet: r < integrated - 5, loud: r > integrated + 5 };
  });
  return { segments: out, integrated_db: r1(integrated) };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
