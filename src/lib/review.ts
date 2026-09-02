import { useStore, markerWorkingRange, getCuts } from '../store/useStore';
import { formatTime } from './format';
import type { MarkerStatus } from '../types';

const VERB: Record<string, string> = { approved: 'Approved', rejected: 'Rejected', pending: 'Restored' };

/** Shared by the Proposals panel buttons and keyboard shortcuts. Logs to the Activity feed as a human action. */
export function reviewMarker(id: string, status: Extract<MarkerStatus, 'approved' | 'rejected' | 'pending'>): void {
  const s = useStore.getState();
  const m = s.setMarkerStatus(id, status);
  if (!m) return;
  const w = markerWorkingRange(m, getCuts(s));
  const range = w ? `${formatTime(w.start, { ms: true })}–${formatTime(w.end, { ms: true })}` : '';
  s.logActivity({
    tool: status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'restore',
    args: { id },
    result: { id, status },
    summary: `${VERB[status]} ${m.kind} ${range}`.trim(),
    durationMs: 0,
    ok: true,
    source: 'ui',
    access: 'write',
  });
}

export function approveAll(): number {
  const s = useStore.getState();
  const ids = s.markers.filter((m) => m.kind !== 'comment' && m.status === 'pending').map((m) => m.id);
  for (const id of ids) s.setMarkerStatus(id, 'approved');
  if (ids.length) s.logActivity({ tool: 'approve_all', args: {}, result: { approved: ids.length }, summary: `Approved ${ids.length} proposals`, durationMs: 0, ok: true, source: 'ui', access: 'write' });
  return ids.length;
}

export async function applyApproved(): Promise<void> {
  const s = useStore.getState();
  const t0 = performance.now();
  const r = await s.applyMarkers();
  s.logActivity({
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
