import { Download, Loader2, Redo2, Undo2, X } from 'lucide-react';
import { Logo } from './Logo';
import { WebMCPPill } from './WebMCPPill';
import { useStore } from '../store/useStore';
import { formatTime } from '../lib/format';

export function TopBar() {
  const fileName = useStore((s) => s.fileName);
  const duration = useStore((s) => s.workingBuffer?.duration ?? null);
  const sourceDuration = useStore((s) => s.sourceBuffer?.duration ?? null);
  const canUndo = useStore((s) => s.history.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const hasAudio = useStore((s) => !!s.workingBuffer);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const exportWav = useStore((s) => s.exportWav);
  const exportProgress = useStore((s) => s.exportProgress);
  const closeProject = useStore((s) => s.closeProject);
  const edlCount = useStore((s) => s.edl.length);
  const logActivity = useStore((s) => s.logActivity);

  const onExport = async () => {
    const t0 = performance.now();
    try {
      const r = await exportWav();
      logActivity({ tool: 'export_audio', args: { format: 'wav' }, result: r, summary: `Exported ${r.fileName} (${(r.bytes / 1e6).toFixed(1)} MB)`, durationMs: Math.round(performance.now() - t0), ok: true, source: 'ui', access: 'write' });
    } catch (e) {
      logActivity({ tool: 'export_audio', args: { format: 'wav' }, result: { error: String(e) }, summary: 'Export failed', durationMs: Math.round(performance.now() - t0), ok: false, source: 'ui', access: 'write' });
    }
  };

  const trimmed = duration != null && sourceDuration != null && Math.abs(sourceDuration - duration) > 0.005;

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
            <span className="text-[13px] text-fg truncate max-w-[340px]" title={fileName}>{fileName}</span>
            <span className="mono text-[12px] text-fg-3" title={trimmed ? `Source ${formatTime(sourceDuration)} → working ${formatTime(duration)}` : undefined}>
              {formatTime(duration)}
              {trimmed && <span className="text-accent ml-1.5">−{(sourceDuration! - duration!).toFixed(1)}s</span>}
            </span>
            {edlCount > 0 && <span className="chip bg-panel-3 text-fg-3">{edlCount} {edlCount === 1 ? 'edit' : 'edits'}</span>}
            <button className="btn btn-icon btn-ghost h-6 w-6 text-fg-3" title="Close file" aria-label="Close file" onClick={closeProject}><X size={13} /></button>
          </>
        ) : (
          <span className="text-[13px] text-fg-3">No file loaded</span>
        )}
      </div>

      <WebMCPPill />

      <div className="flex items-center gap-1.5">
        <button className="btn btn-icon" title="Undo (⌘Z)" disabled={!canUndo} aria-label="Undo" onClick={() => void undo()}><Undo2 size={15} /></button>
        <button className="btn btn-icon" title="Redo (⇧⌘Z)" disabled={!canRedo} aria-label="Redo" onClick={() => void redo()}><Redo2 size={15} /></button>
        <button className="btn btn-primary ml-1 min-w-[96px]" disabled={!hasAudio || exportProgress != null} title="Render the edit list and download a 16-bit WAV" onClick={() => void onExport()}>
          {exportProgress != null ? (
            <><Loader2 size={14} className="animate-spin" /> {exportProgress >= 1 ? 'Saved' : `${Math.round(exportProgress * 100)}%`}</>
          ) : (
            <><Download size={14} /> Export</>
          )}
        </button>
      </div>
    </header>
  );
}
