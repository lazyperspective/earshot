import { Pause, Play, Repeat, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from '../store/useStore';
import { player } from '../audio/player';
import { formatTime, cx } from '../lib/format';
import { ShortcutsPopover } from './ShortcutsPopover';

const MAX_PPS = 800;
const PRESETS: [string, number][] = [['Fit', 0], ['10m', 600], ['2m', 120], ['30s', 30], ['5s', 5]];

export function Transport() {
  const isPlaying = useStore((s) => s.isPlaying);
  const playhead = useStore((s) => s.playhead);
  const selection = useStore((s) => s.selection);
  const loop = useStore((s) => s.loopSelection);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const setSelection = useStore((s) => s.setSelection);
  const pxPerSec = useStore((s) => s.pxPerSec);
  const duration = useStore((s) => s.workingBuffer?.duration ?? 0);
  const hasAudio = useStore((s) => !!s.workingBuffer);

  const width = player.viewportWidth || 900;
  const fit = duration > 0 ? width / duration : 1;
  const t = pxPerSec > 0 ? Math.max(0, Math.min(1, Math.log(pxPerSec / fit) / Math.log(MAX_PPS / fit))) : 0;
  const visible = pxPerSec > 0 ? Math.min(duration, width / pxPerSec) : duration;
  const activePreset = PRESETS.find(([, s]) => (s === 0 ? pxPerSec === 0 : Math.abs(visible - s) < s * 0.15))?.[0];

  return (
    <div className="h-14 shrink-0 flex items-center gap-3 px-4 border-t border-b border-line bg-panel">
      <div className="flex items-center gap-1">
        <button className="btn btn-icon btn-ghost" title="Back 5s (⇧←)" disabled={!hasAudio} aria-label="Back 5 seconds" onClick={() => player.skip(-5)}><RotateCcw size={15} /></button>
        <button
          className={cx('btn btn-icon w-10 h-10 rounded-full', hasAudio ? 'btn-primary' : '')}
          title="Play / Pause (Space)"
          disabled={!hasAudio}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={() => void player.playPause()}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <button className="btn btn-icon btn-ghost" title="Forward 5s (⇧→)" disabled={!hasAudio} aria-label="Forward 5 seconds" onClick={() => player.skip(5)}><RotateCw size={15} /></button>
        <button
          className={cx('btn btn-icon btn-ghost ml-1', loop && 'text-amber bg-amber/10')}
          title="Loop selection (L)"
          disabled={!hasAudio}
          aria-label="Loop selection"
          onClick={toggleLoop}
        >
          <Repeat size={15} />
        </button>
      </div>

      <div className="h-6 w-px bg-line-2" />

      <div className="mono text-[15px] text-fg tracking-tight min-w-[104px]">{formatTime(playhead, { ms: true })}</div>

      <div className="h-6 w-px bg-line-2" />

      <div className="flex items-center gap-2 text-[12px] text-fg-3 min-w-0">
        <span className="uppercase tracking-wider text-[10.5px] font-semibold">Selection</span>
        {selection ? (
          <>
            <span className="mono text-amber whitespace-nowrap">
              {formatTime(selection.start, { ms: true })} → {formatTime(selection.end, { ms: true })}
              <span className="text-fg-3 ml-2">({(selection.end - selection.start).toFixed(2)}s)</span>
            </span>
            <button className="btn btn-icon btn-ghost h-6 w-6" title="Clear selection (Esc)" onClick={() => setSelection(null)} aria-label="Clear selection"><X size={12} /></button>
          </>
        ) : (
          <span className="mono text-fg-4 whitespace-nowrap">none<span className="hidden 2xl:inline"> · drag on waveform or press <span className="kbd">[</span> <span className="kbd">]</span></span></span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 text-fg-3">
        <div className="hidden xl:flex items-center gap-0.5 mr-1">
          {PRESETS.map(([label, secs]) => (
            <button
              key={label}
              className={cx('btn btn-ghost h-6 px-1.5 text-[11px] mono', activePreset === label && 'text-accent bg-accent/10')}
              disabled={!hasAudio || (secs > 0 && secs >= duration)}
              onClick={() => (secs === 0 ? player.fit() : player.setView(undefined, secs))}
              title={secs === 0 ? 'Show the whole file (0)' : `Show ${label} of audio around the playhead`}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn btn-icon btn-ghost h-6 w-6" disabled={!hasAudio} onClick={() => player.zoomBy(1 / 1.6, playhead)} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut size={13} /></button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={t}
          onChange={(e) => {
            const v = Number(e.target.value);
            const pps = fit * Math.pow(MAX_PPS / fit, v);
            if (v < 0.005) player.fit(); else player.setView(undefined, width / pps);
          }}
          className="w-32"
          disabled={!hasAudio}
          aria-label="Zoom"
          title="Zoom · ⌘-wheel or pinch on the waveform"
        />
        <button className="btn btn-icon btn-ghost h-6 w-6" disabled={!hasAudio} onClick={() => player.zoomBy(1.6, playhead)} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={13} /></button>
        <span className="mono text-[11px] w-[88px] text-right whitespace-nowrap" title="Seconds of audio in view">{hasAudio ? `${formatTime(visible)} in view` : '—'}</span>
      </div>
      <ShortcutsPopover />
    </div>
  );
}
