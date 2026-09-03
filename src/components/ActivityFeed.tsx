import { useState } from 'react';
import { ChevronRight, PlayCircle, Radio } from 'lucide-react';
import { useStore } from '../store/useStore';
import { clockTime, cx } from '../lib/format';
import type { ActivityEntry } from '../types';
import { runSampleSession } from '../lib/sampleSession';

const SOURCE_LABEL: Record<ActivityEntry['source'], string> = { webmcp: 'WebMCP', console: 'Console', ui: 'You', replay: 'Replay' };

export function ActivityFeed() {
  const log = useStore((s) => s.activityLog);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (log.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-8">
        <Radio size={18} className="text-fg-4" />
        <div className="text-[13px] text-fg-2">Waiting for your agent.</div>
        <div className="text-[12px] text-fg-4 max-w-[400px]">Every WebMCP tool call — name, arguments, result and timing — streams here live. Open this page in an agent browser, or use the Tool Console.</div>
        <button className="btn mt-1" onClick={() => void runSampleSession()} title="Runs the same tools an agent would, through the same code path. No model involved.">
          <PlayCircle size={14} /> Replay a sample agent session
        </button>
        <div className="text-[11px] text-fg-4">Scripted locally · same tool path · no model</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <ul className="divide-y divide-line">
        {log.map((e) => {
          const isOpen = !!open[e.id];
          return (
            <li key={e.id} className={cx(Date.now() - e.timestamp < 1500 ? 'fx-row-in' : '')}>
              <button
                className="w-full flex items-center gap-3 px-4 h-9 text-left hover:bg-panel-2 transition-colors"
                onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))}
              >
                <ChevronRight size={12} className={cx('text-fg-4 transition-transform duration-150', isOpen && 'rotate-90')} />
                <span className="mono text-[11px] text-fg-4 w-[62px] shrink-0">{clockTime(e.timestamp)}</span>
                <span className={cx('chip w-[64px] justify-center shrink-0', e.source === 'webmcp' ? 'bg-accent/12 text-accent' : e.source === 'ui' ? 'bg-amber/12 text-amber' : 'bg-panel-3 text-fg-2')}>
                  {SOURCE_LABEL[e.source]}
                </span>
                <span className="mono text-[12.5px] text-fg w-[160px] shrink-0 truncate">{e.tool}</span>
                <span className={cx('chip shrink-0', e.access === 'read' ? 'bg-panel-3 text-fg-3' : 'bg-accent/10 text-accent')}>{e.access}</span>
                <span className={cx('text-[12.5px] truncate flex-1', e.ok ? 'text-fg-2' : 'text-danger')}>{e.summary}</span>
                <span className="mono text-[11px] text-fg-4 shrink-0">{e.durationMs} ms</span>
              </button>
              {isOpen && (
                <div className="grid grid-cols-2 gap-3 px-4 pb-3 pl-[46px]">
                  <Json label="args" value={e.args} />
                  <Json label="result" value={e.result} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  let text = '';
  try { text = JSON.stringify(value ?? null, null, 2); } catch { text = String(value); }
  if (text.length > 6000) text = text.slice(0, 6000) + '\n… (truncated)';
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-4 font-semibold mb-1">{label}</div>
      <pre className="mono text-[11px] leading-relaxed text-fg-2 bg-bg border border-line rounded-md p-2.5 max-h-[180px] overflow-auto whitespace-pre-wrap break-words">{text}</pre>
    </div>
  );
}
