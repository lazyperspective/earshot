import { describe, expect, it } from 'vitest';
import { wordsToSegments } from './segments';

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe('wordsToSegments', () => {
  it('splits on sentence punctuation and long gaps', () => {
    const segs = wordsToSegments([
      w('Hello', 0, 0.3), w('there.', 0.3, 0.6),
      w('How', 0.8, 1.0), w('are', 1.0, 1.2), w('you', 1.2, 1.4),
      w('Fine', 3.0, 3.3), w('thanks!', 3.3, 3.7),
    ]);
    expect(segs.map((s) => s.text)).toEqual(['Hello there.', 'How are you', 'Fine thanks!']);
    expect(segs[1]).toMatchObject({ id: 1, start: 0.8, end: 1.4 });
  });

  it('caps segment length', () => {
    const many = Array.from({ length: 95 }, (_, i) => w(`w${i}`, i, i + 0.5));
    const segs = wordsToSegments(many, 40);
    expect(segs.map((s) => s.text.split(' ').length)).toEqual([40, 40, 15]);
  });
});
