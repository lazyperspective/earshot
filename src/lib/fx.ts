/**
 * Agent-presence event bus. invokeTool() emits lifecycle + "what did the agent look at / touch" events;
 * UI layers subscribe and animate. Pure pub/sub, no React state, so it never re-renders the store.
 */
import { useEffect } from 'react';
import type { ActivityEntry } from '../types';

export type FxRangeKind = 'silence' | 'filler' | 'quiet' | 'match' | 'clip' | 'cut' | 'proposal' | 'gain' | 'selection' | 'read';

export type FxEvent =
  | { type: 'tool-start'; id: string; tool: string; access: 'read' | 'write'; source: ActivityEntry['source'] }
  | { type: 'tool-end'; id: string; tool: string; access: 'read' | 'write'; source: ActivityEntry['source']; ok: boolean; durationMs: number; summary: string }
  | { type: 'ranges'; kind: FxRangeKind; ranges: { start: number; end: number }[]; label?: string }
  | { type: 'point'; kind: 'seek' | 'note' | 'chapter' | 'play'; time: number; label?: string }
  | { type: 'words'; kind: 'read' | 'cut' | 'match' | 'filler'; ids: number[] };

type Listener = (e: FxEvent) => void;
const listeners = new Set<Listener>();

export function emitFx(e: FxEvent): void {
  for (const l of listeners) { try { l(e); } catch (err) { console.warn('[fx]', err); } }
}

export function onFx(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useFx(handler: Listener): void {
  useEffect(() => onFx(handler), [handler]);
}

export const reducedMotion = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rangesOf = (list: unknown, s = 'start', e = 'end') => (Array.isArray(list) ? (list as Any[]).filter((x) => typeof x?.[s] === 'number' && typeof x?.[e] === 'number').map((x) => ({ start: x[s], end: x[e] })) : []);
const idsOf = (list: unknown) => (Array.isArray(list) ? (list as Any[]).flatMap((x) => (typeof x?.from_id === 'number' ? Array.from({ length: Math.max(1, (x.to_id ?? x.from_id) - x.from_id + 1) }, (_, i) => x.from_id + i) : typeof x?.id === 'number' ? [x.id] : [])) : []);

/** Translate a finished tool call into presence events (where the agent looked, what it touched). */
export function fxForToolResult(tool: string, args: Any, result: unknown): void {
  const r = (result && typeof result === 'object' ? result : {}) as Any;
  if ('error' in r) return;
  switch (tool) {
    case 'detect_silences': emitFx({ type: 'ranges', kind: 'silence', ranges: rangesOf(r.silences), label: 'silence' }); break;
    case 'detect_clipping': emitFx({ type: 'ranges', kind: 'clip', ranges: rangesOf(r.regions), label: 'clipping' }); break;
    case 'find_filler_words': emitFx({ type: 'ranges', kind: 'filler', ranges: rangesOf(r.fillers) }); emitFx({ type: 'words', kind: 'filler', ids: idsOf(r.fillers) }); break;
    case 'find_in_transcript': emitFx({ type: 'ranges', kind: 'match', ranges: rangesOf(r.matches) }); emitFx({ type: 'words', kind: 'match', ids: idsOf(r.matches) }); break;
    case 'compare_speakers': emitFx({ type: 'ranges', kind: 'quiet', ranges: rangesOf((r.segments ?? []).filter((s: Any) => s.quiet)), label: 'quiet' }); break;
    case 'get_loudness_profile': emitFx({ type: 'ranges', kind: 'read', ranges: [{ start: 0, end: 1e9 }] }); break;
    case 'get_transcript': { const w = Array.isArray(r.words) ? r.words : null; emitFx({ type: 'words', kind: 'read', ids: w ? idsOf(w) : [] }); break; }
    case 'suggest_cuts': emitFx({ type: 'ranges', kind: 'filler', ranges: rangesOf(r.candidates) }); emitFx({ type: 'ranges', kind: 'silence', ranges: rangesOf(r.pause_candidates) }); emitFx({ type: 'words', kind: 'filler', ids: idsOf(r.candidates) }); break;
    case 'cut_text': case 'remove_fillers': emitFx({ type: 'ranges', kind: r.mode === 'propose' ? 'proposal' : 'cut', ranges: rangesOf(r.cuts) }); emitFx({ type: 'words', kind: 'cut', ids: idsOf(r.cuts) }); break;
    case 'propose_cut_text': emitFx({ type: 'ranges', kind: 'proposal', ranges: rangesOf(r.proposals) }); break;
    case 'tighten_pauses': emitFx({ type: 'ranges', kind: r.mode === 'propose' ? 'proposal' : 'cut', ranges: rangesOf(r.pauses) }); break;
    case 'trim_edges': emitFx({ type: 'ranges', kind: 'cut', ranges: rangesOf(r.edges) }); break;
    case 'level_speakers': emitFx({ type: 'ranges', kind: 'gain', ranges: rangesOf(r.passages) }); break;
    case 'clean_for_release': { const items = Array.isArray(r.items) ? r.items : []; emitFx({ type: 'ranges', kind: r.mode === 'propose' ? 'proposal' : 'cut', ranges: rangesOf(items.filter((x: Any) => x.kind !== 'gain')) }); emitFx({ type: 'ranges', kind: 'gain', ranges: rangesOf(items.filter((x: Any) => x.kind === 'gain')) }); emitFx({ type: 'words', kind: 'cut', ids: idsOf(items) }); break; }
    case 'propose_cut': case 'propose_gain': case 'propose_fade': case 'propose_filter': emitFx({ type: 'ranges', kind: tool === 'propose_gain' ? 'gain' : 'proposal', ranges: rangesOf([r]) }); break;
    case 'apply_proposals': emitFx({ type: 'ranges', kind: 'cut', ranges: [] }); break;
    case 'normalize': emitFx({ type: 'ranges', kind: 'gain', ranges: [{ start: 0, end: 1e9 }] }); break;
    case 'set_selection': case 'zoom_to': emitFx({ type: 'ranges', kind: 'selection', ranges: rangesOf([r]) }); break;
    case 'seek': emitFx({ type: 'point', kind: 'seek', time: Number(r.playhead_s ?? args?.time ?? 0) }); break;
    case 'play': emitFx({ type: 'point', kind: 'play', time: Number(r.start ?? 0) }); break;
    case 'add_marker': emitFx({ type: 'point', kind: 'note', time: Number(r.time ?? 0), label: String(r.note ?? '') }); break;
    case 'add_chapter_marker': emitFx({ type: 'point', kind: 'chapter', time: Number(r.time ?? 0), label: String(r.title ?? '') }); break;
    default: break;
  }
}
