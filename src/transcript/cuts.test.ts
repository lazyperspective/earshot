import { describe, expect, it } from 'vitest';
import { snapToQuiet, wordCutRange } from './cuts';
import { suggestCuts } from './suggest';

const W = (text: string, start: number, end: number) => ({ text, start, end });
const words = [W('and,', 1.0, 1.2), W('um,', 1.3, 1.5), W('today', 1.6, 1.9), W('we', 1.9, 2.0)];

describe('wordCutRange', () => {
  it('absorbs the pause before a filler and keeps the pause after by default', () => {
    expect(wordCutRange(words, 1, 1)).toEqual({ start: 1.23, end: 1.5 });
  });
  it('supports keeping the pause before instead', () => {
    expect(wordCutRange(words, 1, 1, { keepPause: 'before' })).toEqual({ start: 1.3, end: 1.57 });
  });
  it('cuts exactly the words with both pauses kept', () => {
    expect(wordCutRange(words, 1, 2, { keepPause: 'both' })).toEqual({ start: 1.3, end: 1.9 });
  });
  it('rejects out-of-range ids', () => {
    expect(() => wordCutRange(words, 0, 9)).toThrow();
  });
});

describe('snapToQuiet', () => {
  it('moves the edge into the quiet gap', () => {
    const sr = 1000;
    const mono = new Float32Array(sr);
    mono.fill(0.5, 0, 480); // loud until 0.48 s, silence after
    mono.fill(0.5, 520, 1000); // loud again from 0.52 s
    const t = snapToQuiet(mono, sr, 0.47, 0.04);
    expect(t).toBeGreaterThanOrEqual(0.49);
    expect(t).toBeLessThanOrEqual(0.51);
  });
});

describe('suggestCuts', () => {
  const id = (arr: { text: string; start: number; end: number }[]) => arr.map((w, i) => ({ ...w, id: i }));
  it('finds stutters, false starts, fillers and flubs', () => {
    const ws = id([
      W('So,', 0, 0.2), W('um,', 0.3, 0.5), W('the', 0.6, 0.7), W('the', 0.75, 0.85), W('big', 0.9, 1.1), W('idea.', 1.1, 1.4),
      W('I', 1.6, 1.7), W('think', 1.7, 1.9), W('I', 2.0, 2.1), W('think', 2.1, 2.3), W('so.', 2.3, 2.5),
      W('Sorry,', 3.0, 3.3), W('I', 3.3, 3.4), W('lost', 3.4, 3.6), W('my', 3.6, 3.7), W('place.', 3.7, 4.0), W('Anyway.', 4.2, 4.6),
    ]);
    const kinds = suggestCuts(ws).map((c) => [c.kind, c.text]);
    expect(kinds).toContainEqual(['filler', 'um,']);
    expect(kinds).toContainEqual(['repeat', 'the']);
    expect(kinds).toContainEqual(['false_start', 'I think']);
    expect(kinds).toContainEqual(['flub', 'Sorry, I lost my place.']);
    expect(kinds).toContainEqual(['flub', 'Anyway.']);
  });
  it('respects keep_fillers', () => {
    const ws = id([W('and,', 0, 0.2), W('like,', 0.3, 0.5), W('um,', 0.6, 0.8), W('yes', 0.9, 1.1)]);
    const texts = suggestCuts(ws, { keepFillers: ['like'] }).map((c) => c.text);
    expect(texts).toEqual(['um,']);
  });
});
