import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Ear, Wand2 } from 'lucide-react';
import { useFx, reducedMotion, type FxEvent } from '../lib/fx';
import { cx } from '../lib/format';
import type { ActivityEntry } from '../types';

interface Toast { id: string; tool: string; access: 'read' | 'write'; source: ActivityEntry['source']; status: 'running' | 'done' | 'error'; summary?: string; ms?: number; born: number; leaving: boolean }

const SOURCE: Record<ActivityEntry['source'], string> = { webmcp: 'WebMCP', console: 'Console', replay: 'Replay', ui: 'You' };
const MIN_VISIBLE = 1700;

/** HUD by the status pill: one line per agent tool call, narrating what the agent is doing. */
export function ToolToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const reduced = reducedMotion();

  const handler = useCallback((e: FxEvent) => {
    if (e.type === 'tool-start') {
      if (e.source === 'ui') return;
      setToasts((prev) => [...prev.slice(-3), { id: e.id, tool: e.tool, access: e.access, source: e.source, status: 'running', born: Date.now(), leaving: false }]);
    } else if (e.type === 'tool-end') {
      setToasts((prev) => prev.map((t) => (t.id === e.id ? { ...t, status: e.ok ? 'done' : 'error', summary: e.summary, ms: e.durationMs } : t)));
    }
  }, []);
  useFx(handler);

  useEffect(() => {
    if (!toasts.length) return;
    const id = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => {
        let changed = false;
        const next = prev.flatMap((t) => {
          const age = now - t.born;
          if (t.status !== 'running' && !t.leaving && age > MIN_VISIBLE + 900) { changed = true; return [{ ...t, leaving: true, born: now }]; }
          if (t.leaving && age > (reduced ? 0 : 320)) { changed = true; return []; }
          return [t];
        });
        return changed ? next : prev;
      });
    }, 100);
    return () => clearInterval(id);
  }, [toasts.length, reduced]);

  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed top-[62px] right-[396px] z-40 flex flex-col items-end gap-1.5" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'glass border rounded-full h-8 pl-2 pr-3 flex items-center gap-2 text-[12px] shadow-lg max-w-[520px]',
            t.status === 'error' ? 'border-danger/40' : t.access === 'write' ? 'border-amber/35' : 'border-accent/35',
            t.leaving ? 'fx-toast-out' : 'fx-toast-in',
          )}
        >
          <span className={cx('w-5 h-5 rounded-full flex items-center justify-center shrink-0', t.status === 'error' ? 'bg-danger/15 text-danger' : t.access === 'write' ? 'bg-amber/15 text-amber' : 'bg-accent/15 text-accent')}>
            {t.status === 'running' ? (t.access === 'write' ? <Wand2 size={11} /> : <Ear size={11} />) : t.status === 'done' ? <Check size={11} /> : <AlertCircle size={11} />}
          </span>
          <span className="mono text-fg whitespace-nowrap">{t.tool}</span>
          {t.status === 'running' ? (
            <span className={cx('flex items-center gap-1.5', t.access === 'write' ? 'text-amber' : 'text-accent')}>
              <span className="fx-eq"><i /><i /><i /><i /></span>
              <span className="text-[11px]">{t.access === 'write' ? 'editing' : 'listening'}</span>
            </span>
          ) : (
            <>
              <span className={cx('truncate', t.status === 'error' ? 'text-danger' : 'text-fg-2')}>{t.summary}</span>
              {t.ms != null && <span className="mono text-[10.5px] text-fg-4 shrink-0">{t.ms} ms</span>}
            </>
          )}
          <span className="chip bg-panel-3 text-fg-4 shrink-0">{SOURCE[t.source]}</span>
        </div>
      ))}
    </div>
  );
}
