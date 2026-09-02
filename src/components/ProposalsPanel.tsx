import { Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';

export function ProposalsPanel() {
  const markers = useStore((s) => s.markers);
  const pending = markers.filter((m) => m.status === 'pending').length;
  const approved = markers.filter((m) => m.status === 'approved').length;

  return (
    <aside className="w-[360px] shrink-0 flex flex-col border-l border-line bg-panel">
      <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-line">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">Proposals</span>
          {markers.length > 0 && (
            <span className="chip bg-panel-3 text-fg-3">{pending} pending</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn h-7 text-[12px]" disabled={pending === 0}>Approve all</button>
          <button className="btn btn-primary h-7 text-[12px]" disabled={approved === 0}>Apply approved</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {markers.length === 0 ? (
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
        ) : null}
      </div>
    </aside>
  );
}
