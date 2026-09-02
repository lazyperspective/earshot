import { describe, expect, it } from 'vitest';
import { cutsFromEdl, keptSegments, mergeRanges, sourceToWorking, spliceChannel, workingDuration, workingToSource } from './edl';

describe('EDL time mapping', () => {
  const cuts = mergeRanges([{ start: 2, end: 4 }, { start: 6, end: 8 }]);

  it('merges overlapping and unsorted ranges', () => {
    expect(mergeRanges([{ start: 5, end: 7 }, { start: 1, end: 3 }, { start: 2.5, end: 4 }])).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 7 },
    ]);
  });

  it('computes kept segments and working duration', () => {
    expect(keptSegments(10, cuts)).toEqual([{ start: 0, end: 2 }, { start: 4, end: 6 }, { start: 8, end: 10 }]);
    expect(workingDuration(10, cuts)).toBe(6);
  });

  it('maps source -> working and back', () => {
    expect(sourceToWorking(1, cuts)).toBe(1);
    expect(sourceToWorking(3, cuts)).toBe(2); // inside first cut collapses
    expect(sourceToWorking(5, cuts)).toBe(3);
    expect(sourceToWorking(9, cuts)).toBe(5);
    expect(workingToSource(1, cuts)).toBe(1);
    expect(workingToSource(2, cuts)).toBe(4);
    expect(workingToSource(3, cuts)).toBe(5);
    expect(workingToSource(5, cuts)).toBe(9);
    for (const t of [0, 0.5, 1.99, 2, 2.5, 3.99, 4, 5.5]) {
      expect(sourceToWorking(workingToSource(t, cuts), cuts)).toBeCloseTo(t, 9);
    }
  });

  it('extracts cuts from a mixed EDL', () => {
    expect(cutsFromEdl([
      { id: 'a', type: 'gain', start: 0, end: 1, gainDb: 3 },
      { id: 'b', type: 'cut', start: 4, end: 3 },
      { id: 'c', type: 'cut', start: 1, end: 2 },
    ])).toEqual([{ start: 1, end: 2 }, { start: 3, end: 4 }]);
  });
});

describe('spliceChannel', () => {
  it('removes cut samples exactly and fades splice points', () => {
    const sr = 1000;
    const data = new Float32Array(1000).fill(1);
    const out = spliceChannel(data, sr, [{ start: 0.2, end: 0.4 }], 0.005);
    expect(out.length).toBe(800);
    // fade-out before the splice
    expect(out[199]).toBeCloseTo(0, 5);
    expect(out[195]).toBeCloseTo(0.8, 5);
    // fade-in after the splice
    expect(out[200]).toBeCloseTo(0, 5);
    expect(out[204]).toBeCloseTo(0.8, 5);
    // untouched elsewhere
    expect(out[100]).toBe(1);
    expect(out[799]).toBe(1);
  });

  it('does not fade the file boundaries', () => {
    const data = new Float32Array(100).fill(1);
    const out = spliceChannel(data, 100, [{ start: 0, end: 0.1 }, { start: 0.9, end: 1 }], 0.01);
    expect(out.length).toBe(80);
    expect(out[0]).toBe(1);
    expect(out[79]).toBe(1);
  });
});
