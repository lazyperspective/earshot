import { useEffect, useMemo, useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { getToolDefs, invokeTool, type ToolDef } from '../webmcp/tools';
import { cx } from '../lib/format';

export function ToolConsole() {
  const hasAudio = useStore((s) => !!s.workingBuffer);
  const defs = useMemo(() => getToolDefs(), []);
  const [name, setName] = useState(defs[0]?.name ?? 'get_status');
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState<{ value: unknown; ms: number; ok: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const def = defs.find((d) => d.name === name) as ToolDef | undefined;

  useEffect(() => {
    if (def) setArgs(JSON.stringify(def.example ?? {}, null, 2));
    setResult(null);
  }, [def]);

  const run = async () => {
    if (!def || running) return;
    let parsed: unknown = {};
    try { parsed = args.trim() ? JSON.parse(args) : {}; }
    catch (e) { setResult({ value: { error: `Invalid JSON: ${(e as Error).message}` }, ms: 0, ok: false }); return; }
    setRunning(true);
    const t0 = performance.now();
    const value = await invokeTool(def.name, parsed, 'console', defs);
    setRunning(false);
    setResult({ value, ms: Math.round(performance.now() - t0), ok: !(value && typeof value === 'object' && 'error' in (value as object)) });
  };

  const props = (def?.inputSchema.properties ?? {}) as Record<string, { type?: string; description?: string; enum?: string[] }>;
  const required = (def?.inputSchema.required ?? []) as string[];

  return (
    <div className="h-full grid grid-cols-[minmax(340px,5fr)_7fr] min-h-0">
      <div className="flex flex-col min-h-0 border-r border-line">
        <div className="flex items-center gap-2 px-4 h-11 border-b border-line">
          <select className="select flex-1" value={name} onChange={(e) => setName(e.target.value)} disabled={!hasAudio} aria-label="Tool">
            <optgroup label="Read (perception)">
              {defs.filter((d) => d.readOnly).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </optgroup>
            <optgroup label="Write · proposals">
              {defs.filter((d) => !d.readOnly && !d.destructive).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </optgroup>
            <optgroup label="Write · direct">
              {defs.filter((d) => !d.readOnly && d.destructive).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </optgroup>
          </select>
          {def && <span className={cx('chip shrink-0', def.readOnly ? 'bg-panel-3 text-fg-3' : 'bg-accent/10 text-accent')}>{def.readOnly ? 'read' : def.destructive ? 'write · direct' : 'write · proposal'}</span>}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {def && <p className="text-[12.5px] text-fg-2 leading-relaxed">{def.description}</p>}
          {Object.keys(props).length > 0 && (
            <div className="space-y-1.5">
              {Object.entries(props).map(([k, p]) => (
                <div key={k} className="text-[12px] leading-snug">
                  <span className="mono text-fg">{k}</span>
                  <span className="mono text-fg-4 ml-1.5">{p.enum ? p.enum.map((v) => `"${v}"`).join(' | ') : p.type}</span>
                  {required.includes(k) && <span className="chip bg-amber/10 text-amber ml-1.5 h-4">required</span>}
                  <div className="text-fg-3">{p.description}</div>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10.5px] uppercase tracking-wider text-fg-4 font-semibold">Arguments (JSON)</span>
              <span className="text-[10.5px] text-fg-4"><span className="kbd">⌘</span> <span className="kbd">↩</span> to run</span>
            </div>
            <textarea
              className="textarea h-[92px]"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run(); } }}
              spellCheck={false}
              aria-label="Tool arguments as JSON"
            />
          </div>
          <button className="btn btn-primary" onClick={() => void run()} disabled={!def || running}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run {def?.name}
          </button>
        </div>
      </div>

      <div className="flex flex-col min-h-0">
        <div className="flex items-center gap-2 px-4 h-11 border-b border-line text-[12px]">
          <span className="text-[10.5px] uppercase tracking-wider text-fg-4 font-semibold">Result</span>
          {result && (
            <>
              <span className={cx('chip', result.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger')}>{result.ok ? 'ok' : 'error'}</span>
              <span className="mono text-fg-4">{result.ms} ms</span>
            </>
          )}
        </div>
        <pre className="flex-1 min-h-0 overflow-auto p-4 mono text-[11.5px] leading-relaxed text-fg-2 whitespace-pre-wrap break-words">
          {result ? pretty(result.value) : <span className="text-fg-4">Run a tool to see its JSON result here — exactly what an agent receives.</span>}
        </pre>
      </div>
    </div>
  );
}

function pretty(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}
