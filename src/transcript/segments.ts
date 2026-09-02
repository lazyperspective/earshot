import type { TranscriptSegment, TranscriptWord } from '../types';

/** Group words into sentence-like segments: break on terminal punctuation, gaps >= 1 s, or 40 words. */
export function wordsToSegments(words: TranscriptWord[], maxWords = 40, gapS = 1.0): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let buf: TranscriptWord[] = [];
  const flush = () => {
    if (!buf.length) return;
    out.push({ id: out.length, text: buf.map((w) => w.text).join(' '), start: buf[0].start, end: buf[buf.length - 1].end });
    buf = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = buf[buf.length - 1];
    if (prev && w.start - prev.end >= gapS) flush();
    buf.push(w);
    if (/[.!?]["')\]]?$/.test(w.text.trim()) || buf.length >= maxWords) flush();
  }
  flush();
  return out;
}
