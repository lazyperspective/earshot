import { useCallback, useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.js';
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.js';
import { Loader2 } from 'lucide-react';
import { useStore, getCuts, markerWorkingRange } from '../store/useStore';
import { audioBufferToWav } from '../audio/wav';
import { player, type ViewRequest } from '../audio/player';
import { formatTime } from '../lib/format';
import type { Marker } from '../types';
import { AgentFxLayer, type FxMap } from './AgentFxLayer';
import { makeBarRenderer } from '../audio/renderBars';

const SEL_ID = 'sel';
const TIMELINE_H = 22;
const MINIMAP_H = 30;
const MAX_PPS = 800;
/** Long files open showing this many seconds instead of squeezing the whole file into the view. */
const DEFAULT_VIEW_S = 120;
const LONG_FILE_S = 300;

const KIND_GLYPH: Record<Marker['kind'], string> = { cut: '✂', gain: '◐', fade: '◢', filter: '≋', comment: '✎', chapter: '§' };

function labelFor(m: Marker): string {
  const extra =
    m.kind === 'gain' ? ` ${m.edit?.gainDb != null ? (m.edit.gainDb > 0 ? '+' : '') + m.edit.gainDb.toFixed(1) + ' dB' : ''}` :
    m.kind === 'fade' ? ` ${m.edit?.direction ?? ''}` :
    m.kind === 'filter' ? ` ${m.edit?.filterType ?? ''} ${m.edit?.frequencyHz ?? ''}Hz` : '';
  return `${KIND_GLYPH[m.kind]} ${m.kind}${extra}`;
}

function styleSelection(r: Region) {
  const el = r.element;
  if (!el) return;
  el.style.background = 'rgba(245, 185, 66, 0.14)';
  el.style.borderLeft = '1px solid rgba(245, 185, 66, 0.95)';
  el.style.borderRight = '1px solid rgba(245, 185, 66, 0.95)';
  el.style.boxSizing = 'border-box';
  el.style.zIndex = '3';
}

function styleMarker(r: Region, m: Marker, focused: boolean, animate: boolean) {
  const el = r.element;
  if (!el) return;
  const teal = '46,230,197', red = '242,109,109', grey = '163,172,184';
  let bg = `rgba(${teal},0.16)`;
  let border = `rgba(${teal},0.85)`;
  if (m.status === 'approved') { bg = `rgba(${teal},0.30)`; border = `rgba(${teal},1)`; }
  if (m.status === 'rejected') { bg = `rgba(${red},0.08)`; border = `rgba(${red},0.55)`; }
  if (m.status === 'applied') { bg = `rgba(${teal},0.08)`; border = `rgba(${teal},0.35)`; }
  if (m.kind === 'cut' && m.status !== 'rejected') {
    const a = m.status === 'approved' ? 0.36 : m.status === 'applied' ? 0.12 : 0.22;
    bg = `repeating-linear-gradient(135deg, rgba(${teal},${a}) 0 5px, rgba(${teal},0.04) 5px 10px)`;
  }
  el.style.boxSizing = 'border-box';
  el.style.borderRadius = '3px';
  el.style.cursor = 'pointer';
  el.style.overflow = 'hidden';
  el.style.zIndex = focused ? '4' : '2';
  if (m.kind === 'comment' || m.kind === 'chapter') {
    el.style.background = 'transparent';
    el.style.borderLeft = m.kind === 'chapter' ? `2px solid rgba(${teal},0.9)` : `1px dashed rgba(${grey},0.9)`;
    el.style.borderRight = 'none';
    el.style.minWidth = '3px';
  } else {
    el.style.background = bg;
    el.style.borderLeft = `1px solid ${border}`;
    el.style.borderRight = `1px solid ${border}`;
  }
  el.style.opacity = m.status === 'applied' ? '0.55' : '1';
  el.style.boxShadow = focused ? `0 0 0 1px ${border}, 0 0 14px rgba(${teal},0.35)` : 'none';
  el.style.transition = 'box-shadow 150ms ease, opacity 150ms ease';
  if (animate) {
    el.animate([{ opacity: 0, transform: 'scaleY(0.5)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 280, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' });
  }
}

export function WaveformPanel() {
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const selRegionRef = useRef<Region | null>(null);
  const markerRegions = useRef(new Map<string, Region>());
  const urlRef = useRef<string | null>(null);
  const lastHashRef = useRef<string | null>(null);
  const [readyTick, setReadyTick] = useState(0);
  const ready = readyTick > 0;
  const [tooltip, setTooltip] = useState<{ x: number; y: number; marker: Marker } | null>(null);
  const mouse = useRef({ x: 0, y: 0 });

  const workingBuffer = useStore((s) => s.workingBuffer);
  const sourceBlob = useStore((s) => s.sourceBlob);
  const edlLength = useStore((s) => s.edl.length);
  const renderVersion = useStore((s) => s.renderVersion);
  const isRendering = useStore((s) => s.isRendering);
  const selection = useStore((s) => s.selection);
  const pxPerSec = useStore((s) => s.pxPerSec);
  const markers = useStore((s) => s.markers);
  const edl = useStore((s) => s.edl);
  const focusedMarkerId = useStore((s) => s.focusedMarkerId);

  const viewportWidth = useCallback(() => {
    const ws = wsRef.current;
    const w = ws?.getWrapper().parentElement?.clientWidth || containerRef.current?.clientWidth || 800;
    player.viewportWidth = w;
    return w;
  }, []);

  const getFxMap = useCallback((): FxMap | null => {
    const ws = wsRef.current;
    const outer = outerRef.current;
    if (!ws || !outer) return null;
    const d = ws.getDuration();
    if (!d) return null;
    const wr = ws.getWrapper().getBoundingClientRect();
    const or = outer.getBoundingClientRect();
    if (!wr.width) return null;
    return { x0: wr.left - or.left, pps: wr.width / d, top: wr.top - or.top, height: wr.height, width: or.width };
  }, []);

  /** Apply the store's pxPerSec (0 = fit) to wavesurfer. */
  const applyZoom = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const d = ws.getDuration();
    if (!d) return;
    const fit = viewportWidth() / d;
    const want = useStore.getState().pxPerSec;
    const pps = want > 0 ? Math.max(fit, Math.min(MAX_PPS, want)) : fit;
    if (Math.abs((ws.options.minPxPerSec || 0) - pps) < 0.01) return;
    try { ws.zoom(pps); } catch { /* not ready yet */ }
  }, [viewportWidth]);

  /** Zoom/scroll request from tools, keys, presets or the wheel. */
  const applyView = useCallback((req: ViewRequest) => {
    const ws = wsRef.current;
    if (!ws) return;
    const d = ws.getDuration();
    if (!d) return;
    const width = viewportWidth();
    const fit = width / d;
    const cur = ws.options.minPxPerSec || fit;
    const view = player.getView();
    let pps = cur;
    let anchorT: number | null = null; // time that should stay at anchorX
    let anchorX = 0;
    let start: number | undefined = req.start;
    if (req.fit) { pps = fit; start = 0; }
    else if (req.secondsVisible) pps = width / req.secondsVisible;
    else if (req.factor) {
      pps = cur * req.factor;
      const around = req.around ?? (view.start + view.seconds_visible / 2);
      anchorT = Math.max(0, Math.min(d, around));
      anchorX = Math.max(0, Math.min(width, (anchorT - view.start) * cur));
    }
    pps = Math.max(fit, Math.min(MAX_PPS, pps));
    const isFit = pps <= fit + 1e-6;
    useStore.getState().setZoom(isFit ? 0 : pps);
    if (Math.abs((ws.options.minPxPerSec || 0) - pps) > 0.01) ws.zoom(pps);
    if (isFit) { ws.setScroll(0); return; }
    if (anchorT != null) { ws.setScroll(anchorT * pps - anchorX); return; }
    if (start == null && req.secondsVisible) start = useStore.getState().playhead - req.secondsVisible / 2;
    if (start != null) ws.setScroll(Math.max(0, Math.min(d * pps - width, start * pps)));
  }, [viewportWidth]);

  // ---- create wavesurfer once ----
  useEffect(() => {
    const container = containerRef.current!;
    const regions = RegionsPlugin.create();
    const timeline = TimelinePlugin.create({
      height: TIMELINE_H,
      insertPosition: 'beforebegin',
      formatTimeCallback: (s) => formatTime(s),
      style: { color: '#6B7684', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace' },
    });
    const hover = HoverPlugin.create({
      lineColor: 'rgba(231,235,240,0.28)',
      lineWidth: 1,
      labelBackground: '#181D23',
      labelColor: '#E7EBF0',
      labelSize: '10px',
      formatTimeCallback: (s) => formatTime(s, { ms: true }),
    });
    const minimap = MinimapPlugin.create({
      container: minimapRef.current!,
      height: MINIMAP_H,
      waveColor: '#3A4655',
      progressColor: '#2EE6C5',
      overlayColor: 'rgba(46,230,197,0.16)',
      cursorWidth: 0,
      barWidth: 1,
      barGap: 1,
      barRadius: 1,
      normalize: false,
    });
    const ws = WaveSurfer.create({
      container,
      height: Math.max(80, container.clientHeight - TIMELINE_H),
      // Vertical gradients (top → bottom). Unplayed: slate; played: bright teal → deep teal.
      waveColor: ['#4A5868', '#6B7C8F', '#4A5868'],
      progressColor: ['#9BFAE8', '#2EE6C5', '#0F8A73'],
      cursorColor: '#E7EBF0',
      cursorWidth: 1,
      renderFunction: makeBarRenderer(),
      normalize: false,
      dragToSeek: false,
      autoScroll: true,
      autoCenter: true,
      fillParent: true,
      hideScrollbar: false,
      minPxPerSec: 1,
      plugins: [timeline, hover, regions, minimap],
    });
    wsRef.current = ws;
    regionsRef.current = regions;
    player.attach(ws);
    player.viewHandler = applyView;

    const st = useStore.getState;
    ws.on('ready', () => { setReadyTick((t) => t + 1); applyZoom(); });
    ws.on('timeupdate', (t) => {
      const s = st();
      s.setPlayhead(t);
      if (player.stopAt != null && t >= player.stopAt - 0.02) { player.stopAt = null; ws.pause(); return; }
      if (s.loopSelection && s.selection && ws.isPlaying() && t >= s.selection.end - 0.02) ws.setTime(s.selection.start);
    });
    ws.on('play', () => st().setPlaying(true));
    ws.on('pause', () => st().setPlaying(false));
    ws.on('finish', () => st().setPlaying(false));
    ws.on('error', (e) => { if ((e as Error)?.name !== 'AbortError') console.warn('wavesurfer', e); });

    regions.enableDragSelection({ id: SEL_ID, color: 'rgba(245,185,66,0.14)', drag: true, resize: true });
    regions.on('region-created', (r) => {
      if (r.id !== SEL_ID) return;
      if (selRegionRef.current && selRegionRef.current !== r) selRegionRef.current.remove();
      selRegionRef.current = r;
      styleSelection(r);
      st().setSelection({ start: r.start, end: r.end });
    });
    regions.on('region-updated', (r) => {
      if (r.id === SEL_ID) st().setSelection({ start: r.start, end: r.end });
    });
    regions.on('region-clicked', (r, e) => {
      if (!r.id.startsWith('p:')) return;
      e.stopPropagation();
      st().setFocusedMarker(r.id.slice(2));
      ws.setTime(r.start);
    });

    // Wheel: ⌘/ctrl (or trackpad pinch) zooms around the cursor; plain vertical wheel scrolls the timeline.
    const outer = outerRef.current!;
    const onWheel = (e: WheelEvent) => {
      const d = ws.getDuration();
      if (!d) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = ws.getWrapper().parentElement?.getBoundingClientRect();
        const x = rect ? e.clientX - rect.left : 0;
        const cur = ws.options.minPxPerSec || 1;
        const t = (ws.getScroll() + x) / cur;
        applyView({ factor: Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.006), around: t });
        return;
      }
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const width = viewportWidth();
        if (d * (ws.options.minPxPerSec || 0) > width + 1) { e.preventDefault(); ws.setScroll(ws.getScroll() + e.deltaY); }
      }
    };
    outer.addEventListener('wheel', onWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      const h = Math.max(80, container.clientHeight - TIMELINE_H);
      ws.setOptions({ height: h });
      applyZoom();
    });
    ro.observe(container);

    return () => {
      outer.removeEventListener('wheel', onWheel);
      ro.disconnect();
      player.detach();
      wsRef.current = null;
      regionsRef.current = null;
      markerRegions.current.clear();
      selRegionRef.current = null;
      ws.destroy();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [applyZoom, applyView, viewportWidth]);

  // ---- (re)load working buffer ----
  useEffect(() => {
    const ws = wsRef.current;
    const regions = regionsRef.current;
    if (!ws || !regions || !workingBuffer) return;
    const prevTime = ws.getCurrentTime();
    regions.clearRegions();
    markerRegions.current.clear();
    selRegionRef.current = null;
    // Untouched file: play the original media (no multi-GB WAV blob). Edited: play the rendered WAV.
    const blob = edlLength === 0 && sourceBlob ? sourceBlob : audioBufferToWav(workingBuffer);
    const url = URL.createObjectURL(blob);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    const peaks: Float32Array[] = [];
    for (let ch = 0; ch < workingBuffer.numberOfChannels; ch++) peaks.push(workingBuffer.getChannelData(ch));
    const hash = useStore.getState().fileHash;
    const newFile = hash !== lastHashRef.current;
    lastHashRef.current = hash;
    if (newFile) {
      // Long files open at a readable zoom; short ones fit the screen.
      const d = workingBuffer.duration;
      useStore.getState().setZoom(d > LONG_FILE_S ? viewportWidth() / DEFAULT_VIEW_S : 0);
    }
    ws.load(url, peaks, workingBuffer.duration)
      .then(() => { ws.setTime(Math.min(newFile ? 0 : prevTime, workingBuffer.duration)); if (newFile) ws.setScroll(0); })
      .catch((e) => { if ((e as Error)?.name !== 'AbortError') console.warn('load', e); });
  }, [workingBuffer, renderVersion, edlLength, sourceBlob, viewportWidth]);

  // ---- zoom ----
  useEffect(() => { if (ready) applyZoom(); }, [pxPerSec, ready, applyZoom]);

  // ---- selection: store -> region ----
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !ready) return;
    const cur = selRegionRef.current;
    if (!selection) {
      if (cur) { selRegionRef.current = null; cur.remove(); }
      return;
    }
    if (cur && Math.abs(cur.start - selection.start) < 1e-4 && Math.abs(cur.end - selection.end) < 1e-4) return;
    if (cur) cur.setOptions({ start: selection.start, end: selection.end });
    else regions.addRegion({ id: SEL_ID, start: selection.start, end: selection.end, color: 'rgba(245,185,66,0.14)', drag: true, resize: true });
  }, [selection, readyTick]);

  // ---- markers: store -> regions ----
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !ready) return;
    const cuts = getCuts({ edl });
    const seen = new Set<string>();
    for (const m of markers) {
      const wr = markerWorkingRange(m, cuts);
      if (!wr) continue;
      const id = `p:${m.id}`;
      seen.add(id);
      let r = markerRegions.current.get(id);
      const isNew = !r;
      if (!r) {
        r = regions.addRegion({ id, start: wr.start, end: wr.end, drag: false, resize: false, content: m.kind === 'comment' || m.kind === 'chapter' ? undefined : labelFor(m) });
        markerRegions.current.set(id, r);
        r.on('over', () => setTooltip({ x: mouse.current.x, y: mouse.current.y, marker: m }));
        r.on('leave', () => setTooltip(null));
      } else if (Math.abs(r.start - wr.start) > 1e-4 || Math.abs(r.end - wr.end) > 1e-4) {
        r.setOptions({ start: wr.start, end: wr.end });
      }
      styleMarker(r, m, m.id === focusedMarkerId, isNew && m.author === 'agent');
    }
    for (const [id, r] of markerRegions.current) {
      if (!seen.has(id)) { r.remove(); markerRegions.current.delete(id); }
    }
  }, [markers, edl, readyTick, focusedMarkerId]);

  // ---- scroll focused marker into view ----
  useEffect(() => {
    if (!focusedMarkerId || !ready) return;
    const r = markerRegions.current.get(`p:${focusedMarkerId}`);
    if (r) player.scrollTo(Math.max(0, r.start - 1));
  }, [focusedMarkerId, readyTick]);

  return (
    <div
      ref={outerRef}
      className="relative flex-1 min-h-[260px] ws-wrap bg-bg"
      onMouseMove={(e) => {
        const rect = outerRef.current?.getBoundingClientRect();
        mouse.current = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
        if (tooltip) setTooltip((t) => (t ? { ...t, x: mouse.current.x, y: mouse.current.y } : t));
      }}
    >
      <div ref={containerRef} className="absolute inset-x-0 top-2 px-3" style={{ bottom: MINIMAP_H + 12 }} />
      <div ref={minimapRef} className="absolute inset-x-0 bottom-1 px-3 opacity-90 hover:opacity-100 transition-opacity" style={{ height: MINIMAP_H }} title="Overview — drag the highlighted window to scroll" />
      <AgentFxLayer getMap={getFxMap} />

      {isRendering && (
        <div className="absolute top-3 right-4 z-10 flex items-center gap-2 h-7 px-2.5 rounded-full glass border border-line-2 text-[11px] text-fg-2 animate-fade-up">
          <Loader2 size={12} className="animate-spin text-accent" /> Rendering edit list…
        </div>
      )}

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 max-w-[320px] glass border border-line-2 rounded-md px-2.5 py-2 text-[12px] leading-snug shadow-xl animate-fade-up"
          style={{ left: Math.min(tooltip.x + 14, (outerRef.current?.clientWidth ?? 800) - 330), top: Math.max(8, tooltip.y - 8) }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className="chip bg-accent/10 text-accent">{tooltip.marker.author === 'agent' ? 'AI' : 'You'}</span>
            <span className="text-fg-2 font-medium capitalize">{tooltip.marker.kind}</span>
            <span className="chip bg-panel-3 text-fg-3 ml-auto">{tooltip.marker.status}</span>
          </div>
          <div className="text-fg">{tooltip.marker.note || '—'}</div>
        </div>
      )}
    </div>
  );
}
