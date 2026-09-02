/**
 * Pure, testable EDL helpers. No Web Audio here.
 * Times are seconds. `cuts` are on the SOURCE timeline; "working" time is what the user sees/hears
 * after cuts are removed.
 */
import type { EDL } from '../types';

export interface Range {
  start: number;
  end: number;
}

export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges
    .map((r) => ({ start: Math.min(r.start, r.end), end: Math.max(r.start, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Sorted, merged cut ranges from an EDL (source timeline). */
export function cutsFromEdl(edl: EDL): Range[] {
  return mergeRanges(edl.filter((op) => op.type === 'cut').map((op) => ({ start: op.start, end: op.end })));
}

/** Source-timeline segments that survive the cuts, in order. */
export function keptSegments(sourceDuration: number, cuts: Range[]): Range[] {
  const segs: Range[] = [];
  let pos = 0;
  for (const c of cuts) {
    const s = Math.min(Math.max(c.start, 0), sourceDuration);
    const e = Math.min(Math.max(c.end, 0), sourceDuration);
    if (s > pos) segs.push({ start: pos, end: s });
    pos = Math.max(pos, e);
  }
  if (pos < sourceDuration) segs.push({ start: pos, end: sourceDuration });
  return segs;
}

export function workingDuration(sourceDuration: number, cuts: Range[]): number {
  return keptSegments(sourceDuration, cuts).reduce((acc, s) => acc + (s.end - s.start), 0);
}

/** Map a source-timeline time to the working timeline. Times inside a cut collapse to the cut point. */
export function sourceToWorking(t: number, cuts: Range[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (t >= c.end) removed += c.end - c.start;
    else if (t > c.start) return c.start - removed;
    else break;
  }
  return t - removed;
}

/** Map a working-timeline time back to the source timeline. */
export function workingToSource(t: number, cuts: Range[]): number {
  let src = t;
  for (const c of cuts) {
    if (c.start <= src) src += c.end - c.start;
    else break;
  }
  return src;
}

/** Map a source range to working; returns null if it is entirely inside a cut. */
export function sourceRangeToWorking(r: Range, cuts: Range[]): Range | null {
  const start = sourceToWorking(r.start, cuts);
  const end = sourceToWorking(r.end, cuts);
  if (end - start <= 1e-6) return null;
  return { start, end };
}

/**
 * Remove cut ranges from a channel with a short fade-out/fade-in at every splice point.
 * Output length is exactly the kept length (mapping stays exact).
 */
export function spliceChannel(data: Float32Array, sampleRate: number, cuts: Range[], fadeS = 0.005): Float32Array {
  const duration = data.length / sampleRate;
  const segs = keptSegments(duration, cuts).map((s) => ({
    a: Math.min(data.length, Math.max(0, Math.round(s.start * sampleRate))),
    b: Math.min(data.length, Math.max(0, Math.round(s.end * sampleRate))),
  })).filter((s) => s.b > s.a);

  const total = segs.reduce((acc, s) => acc + (s.b - s.a), 0);
  const out = new Float32Array(total);
  const fadeN = Math.max(1, Math.round(fadeS * sampleRate));

  let pos = 0;
  segs.forEach((seg, i) => {
    const len = seg.b - seg.a;
    out.set(data.subarray(seg.a, seg.b), pos);
    const n = Math.min(fadeN, Math.floor(len / 2));
    // fade-in at the start of every segment that follows a cut
    if (i > 0 && seg.a > 0) {
      for (let k = 0; k < n; k++) out[pos + k] *= k / n;
    }
    // fade-out at the end of every segment that precedes a cut
    if (i < segs.length - 1 && seg.b < data.length) {
      for (let k = 0; k < n; k++) out[pos + len - 1 - k] *= k / n;
    }
    pos += len;
  });
  return out;
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(lin: number): number {
  return lin <= 0 ? -Infinity : 20 * Math.log10(lin);
}
