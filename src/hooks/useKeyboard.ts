import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { player } from '../audio/player';
import { reviewMarker, exitReview, setRejectReason, getLastRejectedId, previewFocused } from '../lib/review';
import { previewMarker, stopPreview } from '../audio/preview';
import { performRangeOps, REJECT_REASONS } from '../webmcp/toolsExtra';
import { formatTime } from '../lib/format';

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useStore.getState();
      if (!s.workingBuffer) return;
      const meta = e.metaKey || e.ctrlKey;
      const d = s.workingBuffer.duration;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) void s.redo(); else void s.undo();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (s.review.active && s.focusedMarkerId) { if (s.previewingId) stopPreview(); else previewFocused(); return; }
        void player.playPause();
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        const start = s.playhead;
        const end = s.selection ? Math.max(s.selection.end, start + 0.1) : d;
        s.setSelection({ start, end });
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        const end = s.playhead;
        const start = s.selection ? Math.min(s.selection.start, end - 0.1) : 0;
        s.setSelection({ start, end });
        return;
      }
      if (e.key === 'Escape') {
        if (s.review.active) { exitReview(); return; }
        if (s.confirm) return;
        s.setSelection(null);
        s.setFocusedMarker(null);
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && s.selection && s.bottomTab !== 'transcript') {
        e.preventDefault();
        const sel = s.selection;
        void performRangeOps([{ kind: 'cut', start: sel.start, end: sel.end, note: `Cut by you: ${formatTime(sel.start, { ms: true })}–${formatTime(sel.end, { ms: true })}` }], 'apply', 'human').then((out) => {
          useStore.getState().logActivity({ tool: 'cut_selection', args: { start: sel.start, end: sel.end }, result: out, summary: `Cut ${(sel.end - sel.start).toFixed(2)}s of selection`, durationMs: 0, ok: true, source: 'ui', access: 'write' });
          useStore.getState().setSelection(null);
        });
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); player.skip(e.shiftKey ? -5 : -1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); player.skip(e.shiftKey ? 5 : 1); return; }
      if (e.key.toLowerCase() === 'l') { s.toggleLoop(); return; }
      if (e.key.toLowerCase() === 'p' && s.focusedMarkerId) {
        const m = s.markers.find((x) => x.id === s.focusedMarkerId);
        if (m) { if (s.previewingId === m.id) stopPreview(); else void previewMarker(m); }
        return;
      }
      if (/^[1-4]$/.test(e.key) && s.review.active) {
        const id = getLastRejectedId();
        if (id) setRejectReason(id, REJECT_REASONS[Number(e.key) - 1]);
        return;
      }

      // proposal review
      const focused = s.focusedMarkerId ? s.markers.find((m) => m.id === s.focusedMarkerId) : null;
      const order = s.markers.filter((m) => m.status === 'pending' || m.status === 'approved');
      if (e.key.toLowerCase() === 'a' && focused && focused.status === 'pending') {
        reviewMarker(focused.id, 'approved');
        if (!useStore.getState().review.active) focusNext(focused.id, order);
        return;
      }
      if (e.key.toLowerCase() === 'r' && focused && (focused.status === 'pending' || focused.status === 'approved')) {
        reviewMarker(focused.id, 'rejected');
        if (!useStore.getState().review.active) focusNext(focused.id, order);
        return;
      }
      if ((e.key === 'j' || e.key === 'k') && order.length) {
        const idx = focused ? order.findIndex((m) => m.id === focused.id) : -1;
        const next = e.key === 'j' ? order[Math.min(order.length - 1, idx + 1)] : order[Math.max(0, idx - 1)];
        if (next) s.setFocusedMarker(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function focusNext(currentId: string, order: { id: string }[]) {
  const s = useStore.getState();
  const idx = order.findIndex((m) => m.id === currentId);
  const next = order[idx + 1] ?? order[idx - 1] ?? null;
  s.setFocusedMarker(next && next.id !== currentId ? next.id : null);
}
