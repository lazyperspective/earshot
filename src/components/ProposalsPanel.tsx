import { useEffect, useMemo, useRef } from 'react';
import { Check, Headphones, MessageSquare, RotateCcw, Scissors, Sparkles, Square, TrendingDown, Trash2, Volume2, Waves, X } from 'lucide-react';
import { useStore, getCuts, markerWorkingRange } from '../store/useStore';
import { reviewMarker, approveAll, applyApproved } from '../lib/review';
import { previewMarker, stopPreview } from '../audio/preview';
import { player } from '../audio/player';
import { sourceToWorking } from '../audio/edl';
import { formatTime, cx } from '../lib/format';
import type { Marker } from '../types';

const ICON: Record<Marker['kind'], typeof Scissors> = { cut: Scissors, gain: Volume2, fade: TrendingDown, filter: Waves, comment: MessageSquare };

function detail(m: Marker): string {
  if (m.kind === 'gain' && m.edit?.gainDb != null) return `${m.edit.gainDb > 0 ? '+' : ''}${m.edit.gainDb.toFixed(1)} dB`;
  if (m.kind === 'fade') return m.edit?.direction ?? '';
  if (m.kind === 'filter') return `${m.edit?.filterType ?? ''} ${m.edit?.frequencyHz ?? ''} Hz`;
  return '';
}

export function ProposalsPanel() {
  const markers = useStore((s) => s.markers);
  const edl = useStore((s) => s.edl);
  const focusedId = useStore((s) => s.focusedMarkerId);
  const setFocused = useStore((s) => s.setFocusedMarker);
  const previewingId = useStore((s) => s.previewingId);
  const removeMarker = useStore((s) => s.removeMarker);
  const clearProposals = useStore((s) => s.clearProposals);
  const isRendering = useStore((s) => s.isRendering);
  const cuts = useMemo(() => getCuts({ edl }), [edl]);
  const refs = useRef(new Map<string, HTMLLIElement>());

  const proposals = useMemo(() => {
    const items = markers.filter((m) => m.kind !== 'comment').map((m) => ({ m, w: markerWorkingRange(m, cuts) }));
    const rank = (st: Marker['status']) => (st === 'pending' ? 0 : st === 'approved' ? 1 : st === 'rejected' ? 2 : 3);
    return items.sort((a, b) => rank(a.m.status) - rank(b.m.status) || (a.w?.start ?? 1e9) - (b.w?.start ?? 1e9));
  }, [markers, cuts]);
  const notes = useMemo(() => markers.filter((m) => m.kind === 'comment').map((m) => ({ m, w: markerWorkingRange(m, cuts) })), [markers, cuts]);

  const pending = proposals.filter((p) => p.m.status === 'pending').length;
  const approved = proposals.filter((p) => p.m.status === 'approved').length;

  useEffect(() => {
    if (!focusedId) return;
    refs.current.get(focusedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedId]);

  const focus = (m: Marker, w: { start: number; end: number } | null) => {
    setFocused(m.id);
    if (w) { player.seek(w.start); player.scrollTo(Math.max(0, w.start - 1)); }
  };

  return (
    <aside className="w-[380px] shrink-0 flex flex-col border-l border-line bg-panel">
      <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-line">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">Proposals</span>
          {pending > 0 && <span className="chip bg-accent/12 text-accent">{pending} pending</span>}
          {pending === 0 && approved > 0 && <span className="chip bg-panel-3 text-fg-2">{approved} approved</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn h-7 px-2.5 text-[12px]" disabled={pending === 0} onClick={approveAll} title="Approve every pending proposal">Approve all</button>
          <button className="btn btn-primary h-7 px-2.5 text-[12px]" disabled={approved === 0 || isRendering} onClick={() => void applyApproved()} title="Apply approved proposals to the edit list (⌘Z to undo)">
            Apply{approved > 0 ? ` ${approved}` : ''}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {proposals.length === 0 && notes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Sparkles size={18} className="text-accent" />
            </div>
            <div className="text-[13px] text-fg-2 font-medium">Ask your agent to listen.</div>
            <div className="text-[12.5px] text-fg-3 leading-relaxed">
              Try: <span className="text-fg-2">“Clean this up for release.”</span>
              <br />
              Proposals land here for you to approve with your ears.
            </div>
          </div>
        ) : (
          <>
            <ul className="py-2">
              {proposals.map(({ m, w }) => {
                const Icon = ICON[m.kind];
                const focused = m.id === focusedId;
                const previewing = m.id === previewingId;
                const fresh = m.author === 'agent' && Date.now() - m.createdAt < 2500;
                return (
                  <li
                    key={m.id}
                    ref={(el) => { if (el) refs.current.set(m.id, el); else refs.current.delete(m.id); }}
                    onClick={() => focus(m, w)}
                    className={cx(
                      'group relative mx-3 my-1.5 rounded-lg border bg-panel-2 p-3 cursor-pointer transition-all duration-150',
                      m.status === 'approved' ? 'border-accent/40' : m.status === 'rejected' ? 'border-line opacity-60' : m.status === 'applied' ? 'border-line opacity-50' : 'border-line-2',
                      focused && 'ring-1 ring-accent/70 border-accent/60 bg-panel-3',
                      fresh && 'animate-pulse-once',
                    )}
                  >
                    {m.status === 'approved' && <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full bg-accent" />}
                    <div className="flex items-start gap-2.5">
                      <div className={cx('w-7 h-7 shrink-0 rounded-md flex items-center justify-center', m.status === 'rejected' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent')}>
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium capitalize">{m.kind}</span>
                          {detail(m) && <span className="mono text-[11.5px] text-fg-2">{detail(m)}</span>}
                          <span className={cx('chip ml-auto', m.status === 'approved' ? 'bg-accent/12 text-accent' : m.status === 'rejected' ? 'bg-danger/10 text-danger' : m.status === 'applied' ? 'bg-panel-3 text-fg-3' : 'bg-amber/12 text-amber')}>
                            {m.status}
                          </span>
                        </div>
                        <div className="mono text-[11.5px] text-fg-3 mt-0.5">
                          {w
                            ? <>{formatTime(w.start, { ms: true })} → {formatTime(w.end, { ms: true })} <span className="text-fg-4">· {(w.end - w.start).toFixed(2)}s</span></>
                            : m.status === 'applied' && m.kind === 'cut'
                              ? <>at {formatTime(sourceToWorking(m.start, cuts), { ms: true })} <span className="text-fg-4">· −{(m.end - m.start).toFixed(2)}s removed</span></>
                              : <span className="text-fg-4">inside an applied cut</span>}
                        </div>
                        <p className="text-[12.5px] text-fg-2 mt-1.5 leading-snug">{m.note}</p>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <span className={cx('chip mr-auto', m.author === 'agent' ? 'bg-accent/12 text-accent' : 'bg-amber/12 text-amber')}>{m.author === 'agent' ? 'AI' : 'You'}</span>
                      {m.status !== 'applied' && (
                        <button
                          className={cx('btn h-7 px-2 text-[12px]', previewing && 'text-accent border-accent/40')}
                          onClick={() => (previewing ? stopPreview() : void previewMarker(m))}
                          title="Preview: plays 1 s before → through → 1 s after with this edit applied"
                        >
                          {previewing ? <Square size={12} /> : <Headphones size={13} />} {previewing ? 'Stop' : 'Preview'}
                        </button>
                      )}
                      {m.status === 'pending' && (
                        <>
                          <button className="btn btn-danger h-7 px-2 text-[12px]" onClick={() => reviewMarker(m.id, 'rejected')} title="Reject (R)"><X size={13} /> Reject</button>
                          <button className="btn btn-ok h-7 px-2 text-[12px]" onClick={() => reviewMarker(m.id, 'approved')} title="Approve (A)"><Check size={13} /> Approve</button>
                        </>
                      )}
                      {m.status === 'approved' && (
                        <button className="btn btn-danger h-7 px-2 text-[12px]" onClick={() => reviewMarker(m.id, 'rejected')} title="Reject (R)"><X size={13} /> Reject</button>
                      )}
                      {m.status === 'rejected' && (
                        <button className="btn h-7 px-2 text-[12px]" onClick={() => reviewMarker(m.id, 'pending')} title="Back to pending"><RotateCcw size={12} /> Restore</button>
                      )}
                      {m.status === 'applied' && <span className="text-[11.5px] text-fg-4">Applied · ⌘Z to undo</span>}
                    </div>
                  </li>
                );
              })}
            </ul>

            {notes.length > 0 && (
              <div className="px-3 pb-3">
                <div className="text-[10.5px] uppercase tracking-wider text-fg-4 font-semibold px-1 mb-1">Notes</div>
                <ul className="space-y-1">
                  {notes.map(({ m, w }) => (
                    <li key={m.id} className="flex items-start gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-2 text-[12.5px] cursor-pointer hover:border-line-2" onClick={() => focus(m, w)}>
                      <MessageSquare size={13} className="text-fg-3 mt-0.5 shrink-0" />
                      <span className="mono text-[11px] text-fg-3 mt-0.5 shrink-0">{formatTime(w?.start ?? m.start, { ms: true })}</span>
                      <span className="text-fg-2 flex-1">{m.note}</span>
                      <button className="btn btn-icon btn-ghost h-5 w-5 text-fg-4" onClick={(e) => { e.stopPropagation(); removeMarker(m.id); }} aria-label="Remove note"><X size={11} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {proposals.some((p) => p.m.status !== 'applied') && (
              <div className="px-3 pb-3">
                <button className="btn btn-ghost h-7 px-2 text-[11.5px] text-fg-4 hover:text-danger" onClick={() => clearProposals()}>
                  <Trash2 size={12} /> Clear unapplied proposals
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
