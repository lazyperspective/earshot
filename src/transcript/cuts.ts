/**
 * Text-addressed ("surgical") cuts. Pure functions: given transcript words on the source timeline and a
 * word-id range, compute the audio range to remove, with natural pause handling and boundary snapping
 * to the quietest nearby window so cuts never land mid-phoneme.
 */
import type { TranscriptWord } from '../types';
import type { Range } from '../audio/edl';

export type KeepPause = 'after' | 'before' | 'both' | 'none';

export interface WordCutOptions {
  keepPause?: KeepPause;
  /** Max seconds of a neighbouring pause that may be absorbed into the cut. */
  maxAbsorbS?: number;
  /** Minimum gap left between the cut edge and the neighbouring word. */
  guardS?: number;
}

/** Audio range (source seconds) that removes words [fromId..toId]. */
export function wordCutRange(words: TranscriptWord[], fromId: number, toId: number, opts: WordCutOptions = {}): Range {
  const keep = opts.keepPause ?? 'after';
  const maxAbsorb = opts.maxAbsorbS ?? 0.4;
  const guard = opts.guardS ?? 0.03;
  const a = Math.min(fromId, toId), b = Math.max(fromId, toId);
  const first = words[a], last = words[b];
  if (!first || !last) throw new Error(`Word ids ${fromId}–${toId} are out of range (0–${words.length - 1}).`);
  const prev = words[a - 1], next = words[b + 1];
  let start = first.start;
  let end = last.end;
  const gapBefore = prev ? Math.max(0, first.start - prev.end) : 0;
  const gapAfter = next ? Math.max(0, next.start - last.end) : 0;
  const absorbBefore = keep === 'after' || keep === 'none';
  const absorbAfter = keep === 'before' || keep === 'none';
  if (absorbBefore && prev) start = Math.max(prev.end + guard, first.start - Math.min(gapBefore, maxAbsorb));
  if (absorbAfter && next) end = Math.min(next.start - guard, last.end + Math.min(gapAfter, maxAbsorb));
  if (end <= start) end = start + 0.01;
  return { start: r3(start), end: r3(end) };
}

/** Move t to the centre of the quietest 20 ms window within ±radius seconds. */
export function snapToQuiet(mono: Float32Array, sampleRate: number, t: number, radiusS = 0.04, windowS = 0.02, stepS = 0.005): number {
  const win = Math.max(1, Math.round(windowS * sampleRate));
  const step = Math.max(1, Math.round(stepS * sampleRate));
  const centre = Math.round(t * sampleRate);
  const radius = Math.round(radiusS * sampleRate);
  let best = centre, bestE = Infinity;
  for (let c = centre - radius; c <= centre + radius; c += step) {
    const s = c - (win >> 1);
    if (s < 0 || s + win > mono.length) continue;
    let e = 0;
    for (let i = s; i < s + win; i++) e += mono[i] * mono[i];
    if (e < bestE) { bestE = e; best = c; }
  }
  return best / sampleRate;
}

/** Snap both edges of a range, keeping it non-empty. */
export function snapRange(mono: Float32Array, sampleRate: number, r: Range, radiusS = 0.04): Range {
  const start = snapToQuiet(mono, sampleRate, r.start, radiusS);
  const end = snapToQuiet(mono, sampleRate, r.end, radiusS);
  return end - start > 0.01 ? { start: r3(start), end: r3(end) } : r;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
