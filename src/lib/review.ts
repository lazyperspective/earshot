import { useStore, markerWorkingRange, getCuts } from '../store/useStore';
import { formatTime } from './format';
import { previewMarker, stopPreview } from '../audio/preview';
import type { Marker, MarkerStatus } from '../types';

const VERB: Record<string, string> = { approved: 'Approved', rejected: 'Rejected', pending: 'Restored' };
let lastRejected: string | null = null;
export const getLastRejectedId = () => lastRejected;

function log(tool: string, args: unknown, result: unknown, summary: string) {
  useStore.getState().logActivity({ tool, args, result, summary, durationMs: 0, ok: true, source: 'ui', access: 'write' });
}

/** Shared by the Proposals panel buttons and keyboard shortcuts. Logs to the Activity feed as a human action. */
export function reviewMarker(id: string, status: Extract<MarkerStatus, 'approved' | 'rejected' | 'pending'>): void {
  const s = useStore.getState();
  const m = s.setMarkerStatus(id, status);
  if (!m) return;
  if (status === 'rejected') lastRejected = id;
  const w = markerWorkingRange(m, getCuts(s));
  const range = w ? `${formatTime(w.start, { ms: true })}–${formatTime(w.end, { ms: true })}` : '';
  log(status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'restore', { id }, { id, status }, `${VERB[status]} ${m.kind}${m.text ? ` “${m.text}”` : ''} ${range}`.trim());
  if (s.review.active) advanceReview(id);
}

export function setRejectReason(id: string, reason: string): void {
  const s = useStore.getState();
  const m = s.markers.find((x) => x.id === id);
  if (!m) return;
  s.setMarkerFeedback(id, reason);
  log('feedback', { id, reason }, { id, reason }, `Reason for rejecting ${m.kind}${m.text ? ` “${m.text}”` : ''}: ${reason}`);
}

export function approveAll(): number {
  const s = useStore.getState();
  const ids = s.markers.filter((m) => m.kind !== 'comment' && m.kind !== 'chapter' && m.status === 'pending').map((m) => m.id);
  for (const id of ids) s.setMarkerStatus(id, 'approved');
  if (ids.length) log('approve_all', {}, { approved: ids.length }, `Approved ${ids.length} proposals`);
  if (s.review.active) s.setReview({ active: false, ids: null, message: null });
  return ids.length;
}

export async function applyApproved(): Promise<void> {
  const s = useStore.getState();
  const t0 = performance.now();
  const r = await s.applyMarkers();
  useStore.getState().logActivity({
    tool: 'apply_proposals',
    args: {},
    result: { applied: r.applied.map((m) => m.id), skipped: r.skipped, new_duration_s: r.newDuration },
    summary: `Applied ${r.applied.length} · now ${formatTime(r.newDuration, { ms: true })}`,
    durationMs: Math.round(performance.now() - t0),
    ok: true,
    source: 'ui',
    access: 'write',
  });
}

/** Pending proposals in timeline order, limited to the review scope. */
export function reviewQueue(): Marker[] {
  const s = useStore.getState();
  const cuts = getCuts(s);
  const ids = s.review.ids;
  return s.markers
    .filter((m) => m.status === 'pending' && m.kind !== 'comment' && m.kind !== 'chapter' && (!ids || ids.includes(m.id)))
    .sort((a, b) => (markerWorkingRange(a, cuts)?.start ?? 1e9) - (markerWorkingRange(b, cuts)?.start ?? 1e9));
}

export function startReview(message?: string | null): void {
  const s = useStore.getState();
  s.setReview({ active: true, ids: null, message: message ?? null, startedAt: Date.now() });
  const first = reviewQueue()[0];
  if (first) s.setFocusedMarker(first.id);
}

export function exitReview(): void {
  stopPreview();
  useStore.getState().setReview({ active: false, ids: null, message: null });
}

/** After a decision in review mode, focus (and preview) the next pending item, or leave review mode. */
export function advanceReview(decidedId: string): void {
  const s = useStore.getState();
  const queue = reviewQueue().filter((m) => m.id !== decidedId);
  if (!queue.length) { exitReview(); s.setFocusedMarker(null); return; }
  const cuts = getCuts(s);
  const decided = s.markers.find((m) => m.id === decidedId);
  const t = decided ? (markerWorkingRange(decided, cuts)?.start ?? 0) : 0;
  const next = queue.find((m) => (markerWorkingRange(m, cuts)?.start ?? 0) >= t) ?? queue[0];
  s.setFocusedMarker(next.id);
}

/** Preview the focused proposal (used by review mode on focus change). */
export function previewFocused(): void {
  const s = useStore.getState();
  const m = s.markers.find((x) => x.id === s.focusedMarkerId);
  if (m && m.status !== 'applied') void previewMarker(m);
}
