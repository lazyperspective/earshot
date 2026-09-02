import type { TranscriptWord } from '../types';

export const DEFAULT_FILLERS = ['um', 'uh', 'like', 'you know', 'so'];
const STRONG_FILLERS = new Set(['um', 'uh', 'umm', 'uhh', 'hmm', 'mm', 'er', 'erm', 'ah']);

export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '');
}

export interface PhraseMatch {
  text: string;
  start: number;
  end: number;
  wordIndex: number;
  wordCount: number;
}

/** Case-insensitive phrase match over normalized word tokens. */
export function findPhrase(words: TranscriptWord[], query: string): PhraseMatch[] {
  const q = query.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (!q.length) return [];
  const norm = words.map((w) => normalizeWord(w.text));
  const out: PhraseMatch[] = [];
  for (let i = 0; i + q.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < q.length; k++) if (norm[i + k] !== q[k]) { ok = false; break; }
    if (!ok) continue;
    out.push({
      text: words.slice(i, i + q.length).map((w) => w.text).join(' '),
      start: words[i].start,
      end: words[i + q.length - 1].end,
      wordIndex: i,
      wordCount: q.length,
    });
  }
  return out;
}

export interface FillerHit {
  word: string;
  start: number;
  end: number;
  confidence: 'high' | 'medium';
  context: string;
  wordIndex: number;
}

/**
 * Filler detection. "um"/"uh"-type disfluencies are always high confidence.
 * "like"/"so"/"you know" are only flagged when set off by punctuation (", like,") or at a sentence start,
 * which is how Whisper renders spoken fillers.
 */
export function findFillers(words: TranscriptWord[], fillers = DEFAULT_FILLERS): FillerHit[] {
  const hits: FillerHit[] = [];
  const used = new Set<number>();
  for (const f of fillers) {
    for (const m of findPhrase(words, f)) {
      if (used.has(m.wordIndex)) continue;
      const first = words[m.wordIndex];
      const last = words[m.wordIndex + m.wordCount - 1];
      const prev = words[m.wordIndex - 1];
      const strong = STRONG_FILLERS.has(normalizeWord(first.text));
      const setOff = /[,.!?;:]$/.test(last.text.trim()) || (prev ? /[,.!?;:]$/.test(prev.text.trim()) : true);
      if (!strong && !setOff) continue;
      for (let k = 0; k < m.wordCount; k++) used.add(m.wordIndex + k);
      const a = Math.max(0, m.wordIndex - 3);
      const b = Math.min(words.length, m.wordIndex + m.wordCount + 3);
      hits.push({
        word: m.text,
        start: m.start,
        end: m.end,
        confidence: strong ? 'high' : 'medium',
        context: words.slice(a, b).map((w, i) => (a + i >= m.wordIndex && a + i < m.wordIndex + m.wordCount ? `[${w.text}]` : w.text)).join(' '),
        wordIndex: m.wordIndex,
      });
    }
  }
  return hits.sort((x, y) => x.start - y.start);
}

export function isFillerToken(text: string): boolean {
  return STRONG_FILLERS.has(normalizeWord(text));
}
