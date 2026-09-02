import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { cx } from '../lib/format';

export function WebMCPPill() {
  const webmcp = useStore((s) => s.webmcp);
  const [glow, setGlow] = useState(false);

  useEffect(() => {
    if (!webmcp.lastCallAt) return;
    setGlow(true);
    const t = setTimeout(() => setGlow(false), 700);
    return () => clearTimeout(t);
  }, [webmcp.lastCallAt]);

  const live = webmcp.available && webmcp.toolCount > 0;
  const label = !webmcp.available
    ? 'WebMCP not detected'
    : webmcp.native
      ? `${webmcp.toolCount} tools live · ${webmcp.readCount} read · ${webmcp.writeCount} write`
      : `${webmcp.toolCount} tools · polyfill active`;

  const title = webmcp.native
    ? 'Native document.modelContext detected. Tools are visible to agent browsers (ChatGPT desktop, Chrome with WebMCP).'
    : webmcp.polyfill
      ? 'Native WebMCP not detected — @mcp-b/webmcp-polyfill is providing document.modelContext. Use the Tool Console tab to call tools manually.'
      : 'Waiting for WebMCP registration.';

  return (
    <div
      title={title}
      className={cx(
        'inline-flex items-center gap-2 h-7 pl-2 pr-2.5 rounded-full border text-[11.5px] font-medium select-none transition-all duration-150',
        live ? 'border-accent/30 bg-accent/[0.07] text-accent' : 'border-line-2 bg-panel-2 text-fg-3',
        glow && 'animate-glow',
      )}
    >
      <span className="relative flex h-2 w-2">
        {live && <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping [animation-duration:2.4s]" />}
        <span className={cx('relative inline-flex rounded-full h-2 w-2', live ? 'bg-accent' : 'bg-fg-4')} />
      </span>
      <span className="mono">{label}</span>
    </div>
  );
}
