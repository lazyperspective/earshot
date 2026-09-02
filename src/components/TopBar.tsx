import { Download, Redo2, Undo2 } from 'lucide-react';
import { Logo } from './Logo';
import { WebMCPPill } from './WebMCPPill';
import { useStore } from '../store/useStore';
import { formatTime } from '../lib/format';

export function TopBar() {
  const fileName = useStore((s) => s.fileName);
  const duration = useStore((s) => s.workingBuffer?.duration ?? null);
  const canUndo = useStore((s) => s.history.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const hasAudio = useStore((s) => !!s.workingBuffer);

  return (
    <header className="h-14 shrink-0 flex items-center gap-4 px-4 border-b border-line bg-panel/80 backdrop-blur">
      <div className="flex items-center gap-2.5 min-w-[220px]">
        <Logo />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">Earshot</div>
          <div className="text-[11px] text-fg-3 -mt-0.5">Your agent can hear now.</div>
        </div>
      </div>

      <div className="h-6 w-px bg-line-2" />

      <div className="flex items-center gap-3 min-w-0 flex-1">
        {fileName ? (
          <>
            <span className="text-[13px] text-fg truncate max-w-[360px]" title={fileName}>{fileName}</span>
            <span className="mono text-[12px] text-fg-3">{formatTime(duration)}</span>
          </>
        ) : (
          <span className="text-[13px] text-fg-3">No file loaded</span>
        )}
      </div>

      <WebMCPPill />

      <div className="flex items-center gap-1.5">
        <button className="btn btn-icon" title="Undo (⌘Z)" disabled={!canUndo} aria-label="Undo"><Undo2 size={15} /></button>
        <button className="btn btn-icon" title="Redo (⇧⌘Z)" disabled={!canRedo} aria-label="Redo"><Redo2 size={15} /></button>
        <button className="btn btn-primary ml-1" disabled={!hasAudio} title="Render the edit list and download a 16-bit WAV">
          <Download size={14} /> Export
        </button>
      </div>
    </header>
  );
}
