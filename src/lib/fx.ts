/**
 * Agent-presence event bus. invokeTool() emits lifecycle + "what did the agent look at / touch" events;
 * UI layers subscribe and animate. Pure pub/sub, no React state, so it never re-renders the store.
 */
import { useEffect } from 'react';
import type { ActivityEntry, Marker } from '../types';
import { useStore, getCuts, markerWorkingRange } from '../store/useStore';

export type FxRangeKind = 'silence' | 'filler' | 'quiet' | 'loud' | 'match' | 'clip' | 'cut' | 'proposal' | 'gain' | 'selection' | 'read' | 'undo' | 'export' | 'rejected' | 'pending' | 'restored';

export type FxEvent =
  | { type: 'tool-start'; id: string; tool: string; access: 'read' | 'write'; source: ActivityEntry['source'] }
  | { type: 'tool-end'; id: string; tool: string; access: 'read' | 'write'; source: ActivityEntry['source']; ok: boolean; durationMs: number; summary: string }
  | { type: 'ranges'; kind: FxRangeKind; ranges: { start: number; end: number }[]; label?: string }
  | { type: 'point'; kind: 'seek' | 'note' | 'chapter' | 'play'; time: number; label?: string }
  | { type: 'words'; kind: 'read' | 'cut' | 'match' | 'filler'; ids: number[] }
  | { type: 'curve'; points: { t: number; db: number }[]; label?: string }
  | { type: 'wash'; kind: 'commit' | 'undo' | 'export' };

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

function markerRanges(filter: (m: Marker) => boolean) {
  const st = useStore.getState();
  const cuts = getCuts(st);
  return st.markers.filter(filter).map((m) => markerWorkingRange(m, cuts)).filter((r): r is { start: number; end: number } => !!r).map((r) => ({ start: r.start, end: Math.max(r.end, r.start + 0.05) }));
}
const WHOLE = [{ start: 0, end: 1e9 }];

/** Translate a finished tool call into presence events (where the agent looked, what it touched). */
export function fxForToolResult(tool: string, args: Any, result: unknown): void {
  const r = (result && typeof result === 'object' ? result : {}) as Any;
  if ('error' in r) return;
  switch (tool) {
    // ---- perception
    case 'get_status': emitFx({ type: 'ranges', kind: 'read', ranges: WHOLE, label: 'status' }); { const sel = r.selection; if (sel) emitFx({ type: 'ranges', kind: 'selection', ranges: [sel], label: 'your selection' }); else emitFx({ type: 'point', kind: 'seek', time: Number(r.playhead_s ?? 0), label: 'playhead' }); } break;
    case 'get_selection': if (typeof r.start === 'number' && typeof r.end === 'number') emitFx({ type: 'ranges', kind: 'selection', ranges: [{ start: r.start, end: r.end }], label: 'your selection' }); else emitFx({ type: 'point', kind: 'seek', time: Number(r.playhead_s ?? 0), label: 'playhead' }); break;
    case 'detect_silences': emitFx({ type: 'ranges', kind: 'silence', ranges: rangesOf(r.silences), label: `${r.count ?? ''} silences` }); break;
    case 'detect_clipping': emitFx({ type: 'ranges', kind: 'clip', ranges: rangesOf(r.regions), label: 'clipping' }); break;
    case 'find_filler_words': emitFx({ type: 'ranges', kind: 'filler', ranges: rangesOf(r.fillers), label: `${r.count ?? ''} fillers` }); emitFx({ type: 'words', kind: 'filler', ids: idsOf(r.fillers) }); break;
    case 'find_in_transcript': emitFx({ type: 'ranges', kind: 'match', ranges: rangesOf(r.matches), label: `${r.count ?? ''} matches` }); emitFx({ type: 'words', kind: 'match', ids: idsOf(r.matches) }); break;
    case 'compare_speakers': emitFx({ type: 'ranges', kind: 'quiet', ranges: rangesOf((r.segments ?? []).filter((s: Any) => s.quiet)), label: 'quiet' }); emitFx({ type: 'ranges', kind: 'loud', ranges: rangesOf((r.segments ?? []).filter((s: Any) => s.loud)), label: 'loud' }); break;
    case 'get_loudness_profile': { const pts = Array.isArray(r.points) ? (r.points as Any[]).map((p) => ({ t: Number(p.t), db: Number(p.rms_db) })) : []; if (pts.length) emitFx({ type: 'curve', points: pts, label: `loudness · ${r.integrated_db} dBFS` }); break; }
    case 'get_transcript': { const w = Array.isArray(r.words) ? r.words : null; emitFx({ type: 'words', kind: 'read', ids: w ? idsOf(w) : [] }); const rg = r.range; emitFx({ type: 'ranges', kind: 'read', ranges: rg ? [rg] : WHOLE, label: `reading ${r.word_count ?? ''} words` }); break; }
    case 'suggest_cuts': emitFx({ type: 'ranges', kind: 'filler', ranges: rangesOf(r.candidates), label: `${r.candidate_count ?? ''} candidates` }); emitFx({ type: 'ranges', kind: 'silence', ranges: rangesOf(r.pause_candidates) }); emitFx({ type: 'words', kind: 'filler', ids: idsOf(r.candidates) }); break;
    case 'list_markers': emitFx({ type: 'ranges', kind: 'pending', ranges: markerRanges((m) => m.status === 'pending'), label: `${r.pending ?? 0} pending` }); emitFx({ type: 'ranges', kind: 'proposal', ranges: markerRanges((m) => m.status === 'approved') }); break;
    case 'get_review_feedback': emitFx({ type: 'ranges', kind: 'rejected', ranges: markerRanges((m) => m.status === 'rejected'), label: `${r.rejected_count ?? 0} rejected` }); break;
    case 'wait_for_decisions': emitFx({ type: 'ranges', kind: 'proposal', ranges: markerRanges((m) => m.status === 'approved'), label: `${r.approved_count ?? 0} approved` }); emitFx({ type: 'ranges', kind: 'rejected', ranges: markerRanges((m) => m.status === 'rejected') }); break;
    // ---- edits
    case 'cut_text': case 'remove_fillers': emitFx({ type: 'ranges', kind: r.mode === 'propose' ? 'proposal' : 'cut', ranges: rangesOf(r.cuts), label: r.mode === 'propose' ? 'proposed' : 'cut' }); emitFx({ type: 'words', kind: 'cut', ids: idsOf(r.cuts) }); break;
    case 'propose_cut_text': emitFx({ type: 'ranges', kind: 'proposal', ranges: rangesOf(r.proposals), label: 'proposed' }); break;
    case 'tighten_pauses': emitFx({ type: 'ranges', kind: r.mode === 'propose' ? 'proposal' : 'cut', ranges: rangesOf(r.pauses), label: r.mode === 'propose' ? 'proposed' : 'tightened' }); break;
    case 'trim_edges': emitFx({ type: 'ranges', kind: 'cut', ranges: rangesOf(r.edges), label: 'trimmed' }); break;
    case 'level_speakers': emitFx({ type: 'ranges', kind: 'gain', ranges: rangesOf(r.passages), label: 'levelled' }); break;
    case 'clean_for_release': { const items = Array.isArray(r.items) ? r.items : []; emitFx({ type: 'ranges', kind: r.mode === 'propose' ? 'proposal' : 'cut', ranges: rangesOf(items.filter((x: Any) => x.kind !== 'gain')), label: r.mode === 'propose' ? 'proposed' : 'cleaned' }); emitFx({ type: 'ranges', kind: 'gain', ranges: rangesOf(items.filter((x: Any) => x.kind === 'gain')) }); emitFx({ type: 'words', kind: 'cut', ids: idsOf(items) }); break; }
    case 'propose_cut': case 'propose_gain': case 'propose_fade': case 'propose_filter': emitFx({ type: 'ranges', kind: tool === 'propose_gain' ? 'gain' : 'proposal', ranges: rangesOf([r]), label: 'proposed' }); break;
    case 'apply_proposals': { const items = Array.isArray(r.applied) ? r.applied : []; emitFx({ type: 'ranges', kind: 'cut', ranges: rangesOf(items.filter((x: Any) => x.kind === 'cut')), label: `applied ${r.applied_count ?? 0}` }); emitFx({ type: 'ranges', kind: 'gain', ranges: rangesOf(items.filter((x: Any) => x.kind !== 'cut')) }); break; }
    case 'restore_cut': if (typeof r.start === 'number') emitFx({ type: 'ranges', kind: 'restored', ranges: [{ start: r.start, end: r.end }], label: 'restored' }); break;
    case 'clear_proposals': emitFx({ type: 'ranges', kind: 'rejected', ranges: rangesOf(r.removed_ranges), label: `cleared ${r.removed ?? 0}` }); break;
    case 'normalize': emitFx({ type: 'ranges', kind: 'gain', ranges: WHOLE, label: `normalize ${r.gain_db > 0 ? '+' : ''}${r.gain_db} dB` }); break;
    case 'undo': case 'redo': emitFx({ type: 'wash', kind: 'undo' }); emitFx({ type: 'point', kind: 'seek', time: Number(useStore.getState().playhead ?? 0), label: tool }); break;
    // ---- pointing / output
    case 'set_selection': case 'zoom_to': emitFx({ type: 'ranges', kind: 'selection', ranges: rangesOf([r]), label: 'look here' }); break;
    case 'set_view': { const v = r.view; if (v && !v.fit) emitFx({ type: 'ranges', kind: 'read', ranges: [{ start: v.start, end: v.end }], label: 'view' }); emitFx({ type: 'point', kind: 'seek', time: Number(v?.start ?? 0), label: v?.fit ? 'whole file' : 'view' }); break; }
    case 'seek': emitFx({ type: 'point', kind: 'seek', time: Number(r.playhead_s ?? args?.time ?? 0) }); break;
    case 'play': emitFx({ type: 'point', kind: 'play', time: Number(r.start ?? 0), label: 'playing' }); break;
    case 'stop': emitFx({ type: 'point', kind: 'seek', time: Number(r.playhead_s ?? 0), label: 'stopped' }); break;
    case 'add_marker': emitFx({ type: 'point', kind: 'note', time: Number(r.time ?? 0), label: String(r.note ?? '') }); break;
    case 'add_chapter_marker': emitFx({ type: 'point', kind: 'chapter', time: Number(r.time ?? 0), label: String(r.title ?? '') }); break;
    case 'export_audio': case 'export_transcript': case 'export_chapters': emitFx({ type: 'wash', kind: 'export' }); emitFx({ type: 'point', kind: 'seek', time: Number(useStore.getState().playhead ?? 0), label: `exported ${String(r.file_name ?? r.format ?? '')}`.trim() }); break;
    case 'set_preferences': emitFx({ type: 'point', kind: 'note', time: Number(useStore.getState().playhead ?? 0), label: 'preferences saved' }); break;
    case 'request_review': emitFx({ type: 'ranges', kind: 'pending', ranges: markerRanges((m) => m.status === 'pending'), label: `review ${r.pending ?? 0}` }); break;
    default: break;
  }
}