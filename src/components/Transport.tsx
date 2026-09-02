import { Pause, Play, Repeat, RotateCcw, RotateCw, ZoomIn } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatTime, cx } from '../lib/format';

export function Transport() {
  const isPlaying = useStore((s) => s.isPlaying);
  const playhead = useStore((s) => s.playhead);
  const selection = useStore((s) => s.selection);
  const loop = useStore((s) => s.loopSelection);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const hasAudio = useStore((s) => !!s.workingBuffer);

  return (
    <div className="h-14 shrink-0 flex items-center gap-3 px-4 border-t border-b border-line bg-panel">
      <div className="flex items-center gap-1">
        <button className="btn btn-icon btn-ghost" title="Back 5s" disabled={!hasAudio} aria-label="Back 5 seconds"><RotateCcw size={15} /></button>
        <button
          className={cx('btn btn-icon w-10 h-10 rounded-full', hasAudio ? 'btn-primary' : '')}
          title="Play / Pause (Space)"
          disabled={!hasAudio}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <button className="btn btn-icon btn-ghost" title="Forward 5s" disabled={!hasAudio} aria-label="Forward 5 seconds"><RotateCw size={15} /></button>
        <button
          className={cx('btn btn-icon btn-ghost ml-1', loop && 'text-amber')}
          title="Loop selection"
          disabled={!hasAudio || !selection}
          aria-label="Loop selection"
        >
          <Repeat size={15} />
        </button>
      </div>

      <div className="h-6 w-px bg-line-2" />

      <div className="mono text-[15px] text-fg tracking-tight min-w-[110px]">{formatTime(playhead, { ms: true })}</div>

      <div className="h-6 w-px bg-line-2" />

      <div className="flex items-center gap-2 text-[12px] text-fg-3">
        <span className="uppercase tracking-wider text-[10.5px] font-semibold">Selection</span>
        {selection ? (
          <span className="mono text-amber">
            {formatTime(selection.start, { ms: true })} → {formatTime(selection.end, { ms: true })}
            <span className="text-fg-3 ml-2">({(selection.end - selection.start).toFixed(2)}s)</span>
          </span>
        ) : (
          <span className="mono text-fg-4">none · drag on waveform or press <span className="kbd">[</span> <span className="kbd">]</span></span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2 text-fg-3">
        <ZoomIn size={14} />
        <input
          type="range"
          min={1}
          max={40}
          step={0.5}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-36"
          disabled={!hasAudio}
          aria-label="Zoom"
        />
        <span className="mono text-[11px] w-10 text-right">{zoom.toFixed(1)}×</span>
      </div>
    </div>
  );
}
