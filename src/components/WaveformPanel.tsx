import { useCallback, useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.js';
import { Loader2 } from 'lucide-react';
import { useStore, getCuts, markerWorkingRange } from '../store/useStore';
import { audioBufferToWav } from '../audio/wav';
import { player } from '../audio/player';
import { formatTime } from '../lib/format';
import type { Marker } from '../types';

const SEL_ID = 'sel';
const TIMELINE_H = 22;

const KIND_GLYPH: Record<Marker['kind'], string> = { cut: '✂', gain: '◐', fade: '◢', filter: '≋', comment: '✎' };

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
  if (m.kind === 'comment') {
    el.style.background = 'transparent';
    el.style.borderLeft = `1px dashed rgba(${grey},0.9)`;
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
    el.animate(
      [{ opacity: 0, transform: 'scaleY(0.5)' }, { opacity: 1, transform: 'scaleY(1)' }],
      { duration: 280, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
    );
  }
}

export function WaveformPanel() {
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const selRegionRef = useRef<Region | null>(null);
  const markerRegions = useRef(new Map<string, Region>());
  const urlRef = useRef<string | null>(null);
  const [readyTick, setReadyTick] = useState(0);
  const ready = readyTick > 0;
  const [tooltip, setTooltip] = useState<{ x: number; y: number; marker: Marker } | null>(null);
  const mouse = useRef({ x: 0, y: 0 });

  const workingBuffer = useStore((s) => s.workingBuffer);
  const renderVersion = useStore((s) => s.renderVersion);
  const isRendering = useStore((s) => s.isRendering);
  const selection = useStore((s) => s.selection);
  const zoom = useStore((s) => s.zoom);
  const markers = useStore((s) => s.markers);
  const edl = useStore((s) => s.edl);
  const focusedMarkerId = useStore((s) => s.focusedMarkerId);

  const applyZoom = useCallback(() => {
    const ws = wsRef.current;
    const el = containerRef.current;
    if (!ws || !el) return;
    const d = ws.getDuration();
    if (!d) return;
    const base = Math.max(1, el.clientWidth) / d;
    try { ws.zoom(base * useStore.getState().zoom); } catch { /* not ready yet */ }
  }, []);

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
    const ws = WaveSurfer.create({
      container,
      height: Math.max(80, container.clientHeight - TIMELINE_H),
      waveColor: '#3B4756',
      progressColor: '#93A3B5',
      cursorColor: '#E7EBF0',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: false,
      dragToSeek: false,
      autoScroll: true,
      autoCenter: false,
      fillParent: true,
      minPxPerSec: 1,
      plugins: [timeline, hover, regions],
    });
    wsRef.current = ws;
    regionsRef.current = regions;
    player.attach(ws);

    const st = useStore.getState;
    ws.on('ready', () => { setReadyTick((t) => t + 1); applyZoom(); });
    ws.on('timeupdate', (t) => {
      const s = st();
      s.setPlayhead(t);
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
      const id = r.id.slice(2);
      st().setFocusedMarker(id);
      ws.setTime(r.start);
    });

    const ro = new ResizeObserver(() => {
      const h = Math.max(80, container.clientHeight - TIMELINE_H);
      ws.setOptions({ height: h });
      applyZoom();
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      player.detach();
      wsRef.current = null;
      regionsRef.current = null;
      markerRegions.current.clear();
      selRegionRef.current = null;
      ws.destroy();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [applyZoom]);

  // ---- (re)load working buffer ----
  useEffect(() => {
    const ws = wsRef.current;
    const regions = regionsRef.current;
    if (!ws || !regions || !workingBuffer) return;
    const prevTime = ws.getCurrentTime();
    regions.clearRegions();
    markerRegions.current.clear();
    selRegionRef.current = null;
    const blob = audioBufferToWav(workingBuffer);
    const url = URL.createObjectURL(blob);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    const peaks: Float32Array[] = [];
    for (let ch = 0; ch < workingBuffer.numberOfChannels; ch++) peaks.push(workingBuffer.getChannelData(ch));
    ws.load(url, peaks, workingBuffer.duration)
      .then(() => { ws.setTime(Math.min(prevTime, workingBuffer.duration)); })
      .catch((e) => { if ((e as Error)?.name !== 'AbortError') console.warn('load', e); });
  }, [workingBuffer, renderVersion]);

  // ---- zoom ----
  useEffect(() => { if (ready) applyZoom(); }, [zoom, ready, applyZoom]);

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
        r = regions.addRegion({ id, start: wr.start, end: wr.end, drag: false, resize: false, content: m.kind === 'comment' ? undefined : labelFor(m) });
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
      className="relative flex-1 min-h-[240px] ws-wrap bg-bg"
      onMouseMove={(e) => {
        const rect = outerRef.current?.getBoundingClientRect();
        mouse.current = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
        if (tooltip) setTooltip((t) => (t ? { ...t, x: mouse.current.x, y: mouse.current.y } : t));
      }}
    >
      <div ref={containerRef} className="absolute inset-x-0 top-2 bottom-2 px-3" />

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
