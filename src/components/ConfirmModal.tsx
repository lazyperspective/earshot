import { ShieldAlert } from 'lucide-react';
import { useStore } from '../store/useStore';
import { resolveConfirm } from '../lib/confirm';

/** Human gate for agent actions that skip review (e.g. apply_proposals with force: true). */
export function ConfirmModal() {
  const req = useStore((s) => s.confirm);
  if (!req) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/70 backdrop-blur-sm animate-fade-up" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-[440px] panel p-5 shadow-2xl border-amber/30">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber/12 text-amber flex items-center justify-center shrink-0"><ShieldAlert size={18} /></div>
          <div className="min-w-0">
            <div id="confirm-title" className="text-[14px] font-semibold">{req.title}</div>
            <div className="mt-1 text-[12.5px] text-fg-2 leading-relaxed">{req.detail}</div>
            <div className="mt-1 text-[11.5px] text-fg-4">You can still undo afterwards with ⌘Z.</div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => resolveConfirm(req.id, false)} autoFocus>Deny</button>
          <button className="btn btn-primary" onClick={() => resolveConfirm(req.id, true)}>Allow once</button>
        </div>
      </div>
    </div>
  );
}
