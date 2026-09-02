import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { player } from '../audio/player';
import { reviewMarker } from '../lib/review';
import { previewMarker, stopPreview } from '../audio/preview';

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
        s.setSelection(null);
        s.setFocusedMarker(null);
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

      // proposal review
      const focused = s.focusedMarkerId ? s.markers.find((m) => m.id === s.focusedMarkerId) : null;
      const pendingOrder = s.markers.filter((m) => m.status === 'pending' || m.status === 'approved');
      if (e.key.toLowerCase() === 'a' && focused) {
        reviewMarker(focused.id, 'approved');
        focusNext(focused.id, pendingOrder);
        return;
      }
      if (e.key.toLowerCase() === 'r' && focused) {
        reviewMarker(focused.id, 'rejected');
        focusNext(focused.id, pendingOrder);
        return;
      }
      if ((e.key === 'j' || e.key === 'k') && pendingOrder.length) {
        const idx = focused ? pendingOrder.findIndex((m) => m.id === focused.id) : -1;
        const next = e.key === 'j' ? pendingOrder[Math.min(pendingOrder.length - 1, idx + 1)] : pendingOrder[Math.max(0, idx - 1)];
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
