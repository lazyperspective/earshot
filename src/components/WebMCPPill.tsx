import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Plug, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cx } from '../lib/format';

/** Agent connection status. Click for how to connect an agent browser. */
export function WebMCPPill() {
  const webmcp = useStore((s) => s.webmcp);
  const hasAudio = useStore((s) => !!s.workingBuffer);
  const activeCount = useStore((s) => s.activeCalls.length);
  const activeAccess = useStore((s) => s.activeCalls.some((c) => c.access === 'write') ? 'write' : 'read');
  const [glow, setGlow] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!webmcp.lastCallAt) return;
    setGlow(true);
    const t = setTimeout(() => setGlow(false), 700);
    return () => clearTimeout(t);
  }, [webmcp.lastCallAt]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const connected = webmcp.available && webmcp.native && webmcp.toolCount > 0;
  const busy = activeCount > 0;
  const label = busy
    ? `Agent ${activeAccess === 'write' ? 'editing' : 'listening'}`
    : connected
      ? `Agent connected · ${webmcp.toolCount} tools`
      : webmcp.available
        ? `${webmcp.toolCount} agent tool${webmcp.toolCount === 1 ? '' : 's'} ready`
        : 'Agent tools unavailable';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Agent connection"
        className={cx(
          'relative inline-flex items-center gap-2 h-7 pl-2 pr-2.5 rounded-full border text-[11.5px] font-medium select-none transition-all duration-150',
          connected ? 'border-accent/30 bg-accent/[0.07] text-accent' : 'border-line-2 bg-panel-2 text-fg-3 hover:text-fg-2 hover:border-fg-4',
          busy && (activeAccess === 'write' ? 'border-amber/50 text-amber' : 'border-accent/50 text-accent'),
          glow && 'animate-glow',
        )}
      >
        {webmcp.lastCallAt && (
          <span key={webmcp.lastCallAt} className="absolute inset-0 pointer-events-none">
            <span className="fx-ring" />
            <span className="fx-ring second" />
          </span>
        )}
        <span className="relative flex h-2 w-2">
          {connected && <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping [animation-duration:2.4s]" />}
          <span className={cx('relative inline-flex rounded-full h-2 w-2', connected ? 'bg-accent' : webmcp.available ? 'bg-fg-3' : 'bg-fg-4')} />
        </span>
        <span className="mono">{label}</span>
        {busy && <span className={cx('fx-eq', activeAccess === 'write' ? 'text-amber' : 'text-accent')}><i /><i /><i /><i /></span>}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-40 w-[340px] glass border border-line-2 rounded-lg p-4 shadow-2xl animate-fade-up text-left">
          <div className="flex items-start gap-2.5">
            <span className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', connected ? 'bg-accent/15 text-accent' : 'bg-panel-3 text-fg-3')}><Plug size={15} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{connected ? 'Agent connected' : 'Connect an agent'}</div>
              <div className="mt-0.5 text-[12px] text-fg-3 leading-snug">
                {connected
                  ? `This browser's agent can see ${webmcp.toolCount} tools (${webmcp.readCount} to listen, ${webmcp.writeCount} to edit).`
                  : hasAudio
                    ? `${webmcp.toolCount} tools are published for agents (${webmcp.readCount} to listen, ${webmcp.writeCount} to edit). No agent browser is attached to this tab yet.`
                    : 'Open a recording first. Until then only a status tool is published.'}
              </div>
            </div>
            <button className="btn btn-icon btn-ghost h-6 w-6 -mr-1 -mt-1" onClick={() => setOpen(false)} aria-label="Close"><X size={12} /></button>
          </div>
          {!connected && (
            <ol className="mt-3 space-y-1.5 text-[12px] text-fg-2">
              <li className="flex gap-2"><span className="kbd h-5 min-w-5 mt-px">1</span><span>Open this page inside an agent browser, e.g. ChatGPT's desktop app or Chrome with WebMCP.</span></li>
              <li className="flex gap-2"><span className="kbd h-5 min-w-5 mt-px">2</span><span>Check the address bar's <span className="text-fg">Site tools</span> panel: Earshot's tools appear there automatically.</span></li>
              <li className="flex gap-2"><span className="kbd h-5 min-w-5 mt-px">3</span><span>Ask: <span className="text-fg">“Clean this up for release.”</span></span></li>
            </ol>
          )}
          <div className="mt-3 flex items-center justify-between text-[11px] text-fg-4">
            <span>Without an agent, use the Tool Console tab.</span>
            <a className="inline-flex items-center gap-1 hover:text-fg-2" href="https://github.com/lazyperspective/earshot#tool-catalog" target="_blank" rel="noreferrer">Tool list <ExternalLink size={10} /></a>
          </div>
        </div>
      )}
    </div>
  );
}
