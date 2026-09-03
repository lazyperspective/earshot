/**
 * Cut candidates from the transcript: fillers, stutters/repeats, false starts, flubs and retakes.
 * Word ids are indices into the SOURCE transcript so they stay stable across cuts.
 */
import type { TranscriptWord } from '../types';
import { findFillers, normalizeWord } from './text';

export type CandidateKind = 'filler' | 'repeat' | 'false_start' | 'flub' | 'retake';

export interface CutCandidate {
  kind: CandidateKind;
  from_id: number;
  to_id: number;
  text: string;
  start: number;
  end: number;
  reason: string;
  confidence: 'high' | 'medium';
}

/** A visible word with its stable source id. */
export interface IdWord extends TranscriptWord { id: number }

const FLUB_PHRASES = [
  'sorry', 'lost my place', 'let me start over', 'let me start again', 'start that again', 'say that again',
  'take two', 'scratch that', 'where was i', 'hang on', 'hold on', 'one sec', 'one second', 'let me try that again',
  'let me do that again', 'i mean', 'wait',
];
const FLUB_STRONG = new Set(['lost my place', 'let me start over', 'let me start again', 'start that again', 'say that again', 'take two', 'scratch that', 'let me try that again', 'let me do that again']);

function sentences(words: IdWord[]): IdWord[][] {
  const out: IdWord[][] = [];
  let buf: IdWord[] = [];
  for (const w of words) {
    buf.push(w);
    if (/[.!?]["')\]]?$/.test(w.text.trim())) { out.push(buf); buf = []; }
  }
  if (buf.length) out.push(buf);
  return out;
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

export function suggestCuts(words: IdWord[], opts: { kinds?: CandidateKind[]; keepFillers?: string[]; fillerConfidence?: 'high' | 'medium' } = {}): CutCandidate[] {
  const kinds = new Set(opts.kinds ?? ['filler', 'repeat', 'false_start', 'flub', 'retake']);
  const keep = new Set((opts.keepFillers ?? []).map(normalizeWord));
  const out: CutCandidate[] = [];
  const norm = words.map((w) => normalizeWord(w.text));
  const taken = new Set<number>();
  const push = (c: CutCandidate) => {
    for (let i = c.from_id; i <= c.to_id; i++) if (taken.has(i)) return;
    for (let i = c.from_id; i <= c.to_id; i++) taken.add(i);
    out.push(c);
  };
  const idxOfId = new Map<number, number>();
  words.forEach((w, i) => idxOfId.set(w.id, i));
  const span = (i: number, j: number) => ({ from_id: words[i].id, to_id: words[j].id, text: words.slice(i, j + 1).map((w) => w.text).join(' '), start: words[i].start, end: words[j].end });

  // Flubs and retakes first (they may swallow fillers inside them).
  if (kinds.has('flub') || kinds.has('retake')) {
    const sents = sentences(words);
    for (let si = 0; si < sents.length; si++) {
      const s = sents[si];
      const text = s.map((w) => normalizeWord(w.text)).join(' ');
      const i0 = idxOfId.get(s[0].id)!, i1 = idxOfId.get(s[s.length - 1].id)!;
      if (kinds.has('flub') && s.length <= 12) {
        const padded = ` ${text} `;
        const hits = FLUB_PHRASES.filter((p) => padded.includes(` ${p} `));
        const strong = hits.find((h) => FLUB_STRONG.has(h));
        const weak = hits.find((h) => !FLUB_STRONG.has(h));
        const hit = strong ?? (weak && s.length <= 4 ? weak : undefined);
        if (hit) {
          push({ kind: 'flub', ...span(i0, i1), reason: `Aside/flub: “${s.map((w) => w.text).join(' ')}”`, confidence: strong ? 'high' : 'medium' });
          // A one-word follow-up like "Anyway." right after a flub is part of the recovery.
          const nx = sents[si + 1];
          if (nx && nx.length <= 2 && /^(anyway|okay|ok|so|right|alright)\b/.test(nx.map((w) => normalizeWord(w.text)).join(' '))) {
            push({ kind: 'flub', ...span(idxOfId.get(nx[0].id)!, idxOfId.get(nx[nx.length - 1].id)!), reason: `Recovery word after a flub: “${nx.map((w) => w.text).join(' ')}”`, confidence: 'medium' });
          }
          continue;
        }
      }
      if (kinds.has('retake')) {
        for (let sj = si + 1; sj < Math.min(sents.length, si + 4); sj++) {
          const t2 = sents[sj];
          if (t2[0].start - s[s.length - 1].end > 30) break;
          const a = s.map((w) => normalizeWord(w.text)), b = t2.map((w) => normalizeWord(w.text));
          if (a.length >= 4 && b.length >= 4 && jaccard(a, b) >= 0.6) {
            push({ kind: 'retake', ...span(i0, i1), reason: `First take of a repeated sentence (re-said ${r1(t2[0].start - s[0].start)} s later)`, confidence: 'high' });
            break;
          }
        }
      }
    }
  }

  // Stutters / repeats: "the the", "I I think", repeated bigrams "I think I think".
  if (kinds.has('repeat') || kinds.has('false_start')) {
    for (let i = 0; i + 1 < words.length; i++) {
      if (norm[i] && norm[i] === norm[i + 1] && words[i + 1].start - words[i].end < 1.0) {
        push({ kind: 'repeat', ...span(i, i), reason: `Stutter: “${words[i].text} ${words[i + 1].text}”`, confidence: 'high' });
        continue;
      }
      if (i + 3 < words.length && norm[i] && norm[i] === norm[i + 2] && norm[i + 1] === norm[i + 3] && words[i + 2].start - words[i + 1].end < 1.2) {
        push({ kind: 'false_start', ...span(i, i + 1), reason: `False start: “${words[i].text} ${words[i + 1].text}” restarted`, confidence: 'high' });
      }
    }
  }

  if (kinds.has('filler')) {
    for (const f of findFillers(words)) {
      const first = normalizeWord(f.word.split(' ')[0]);
      if (keep.has(first) || keep.has(normalizeWord(f.word))) continue;
      if (opts.fillerConfidence === 'high' && f.confidence !== 'high') continue;
      const i = f.wordIndex;
      const n = f.word.split(' ').length;
      push({ kind: 'filler', ...span(i, i + n - 1), reason: `Filler word: “${f.word.replace(/[,.]$/, '')}”`, confidence: f.confidence });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
