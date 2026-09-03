import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useFx, reducedMotion, type FxEvent, type FxRangeKind } from '../lib/fx';

export interface FxMap { x0: number; pps: number; top: number; height: number; width: number }

interface Item { id: number; kind: 'flash' | 'slice' | 'spark'; start: number; end: number; color: string; border: string; born: number; ttl: number }
interface Cursor { t: number; label: string; born: number }

const COLORS: Record<FxRangeKind, { fill: string; border: string; label: string }> = {
  silence: { fill: 'rgba(163,172,184,0.22)', border: 'rgba(163,172,184,0.8)', label: 'silence' },
  filler: { fill: 'rgba(245,185,66,0.28)', border: 'rgba(245,185,66,0.9)', label: 'filler' },
  quiet: { fill: 'rgba(46,230,197,0.14)', border: 'rgba(46,230,197,0.6)', label: 'quiet' },
  match: { fill: 'rgba(46,230,197,0.30)', border: 'rgba(46,230,197,0.95)', label: 'match' },
  clip: { fill: 'rgba(242,109,109,0.30)', border: 'rgba(242,109,109,0.9)', label: 'clip' },
  cut: { fill: 'rgba(242,109,109,0.35)', border: 'rgba(242,109,109,0.95)', label: 'cut' },
  proposal: { fill: 'rgba(46,230,197,0.24)', border: 'rgba(46,230,197,0.9)', label: 'proposal' },
  gain: { fill: 'rgba(46,230,197,0.16)', border: 'rgba(46,230,197,0.7)', label: 'gain' },
  selection: { fill: 'rgba(245,185,66,0.18)', border: 'rgba(245,185,66,0.9)', label: 'look here' },
  read: { fill: 'rgba(46,230,197,0.06)', border: 'rgba(46,230,197,0.0)', label: 'listening' },
};

let seq = 0;

/** Overlay on the waveform: scanline while the agent listens, flashes where it looked, slices where it cut, an AI cursor. */
export function AgentFxLayer({ getMap }: { getMap: () => FxMap | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [, setTick] = useState(0);
  const sweepUntil = useRef(0);
  const active = useStore((s) => s.activeCalls);
  const reduced = reducedMotion();

  const handler = useCallback((e: FxEvent) => {
    if (reduced) return;
    const now = Date.now();
    if (e.type === 'tool-start') { sweepUntil.current = Math.max(sweepUntil.current, now + 1000); setTick((t) => t + 1); return; }
    if (e.type === 'ranges') {
      const c = COLORS[e.kind];
      const ranges = e.ranges.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end)).slice(0, 60);
      if (!ranges.length) return;
      const kind: Item['kind'] = e.kind === 'cut' ? 'slice' : 'flash';
      setItems((prev) => [...prev, ...ranges.map((r) => ({ id: ++seq, kind, start: r.start, end: Math.max(r.end, r.start + 0.05), color: c.fill, border: c.border, born: now, ttl: kind === 'slice' ? 720 : 1650 }))].slice(-120));
      const first = [...ranges].sort((a, b) => a.start - b.start)[0];
      if (e.kind !== 'read') setCursor({ t: first.start, label: e.label ?? c.label, born: now });
      return;
    }
    if (e.type === 'point') {
      setItems((prev) => [...prev, { id: ++seq, kind: 'spark', start: e.time, end: e.time, color: 'transparent', border: 'rgba(46,230,197,0.9)', born: now, ttl: 900 }]);
      setCursor({ t: e.time, label: e.label ? e.label.slice(0, 28) : e.kind, born: now });
    }
  }, [reduced]);
  useFx(handler);

  // keep repainting while anything is alive (positions follow scroll/zoom), then stop
  const alive = items.length > 0 || cursor !== null || active.length > 0 || Date.now() < sweepUntil.current;
  useEffect(() => {
    if (!alive) return;
    const id = setInterval(() => {
      const now = Date.now();
      setItems((prev) => (prev.some((i) => now - i.born > i.ttl) ? prev.filter((i) => now - i.born <= i.ttl) : prev));
      setCursor((c) => (c && now - c.born > 4200 ? null : c));
      setTick((t) => t + 1);
    }, 70);
    return () => clearInterval(id);
  }, [alive]);

  const map = getMap();
  if (!map) return null;
  const now = Date.now();
  const sweeping = active.length > 0 || now < sweepUntil.current;
  const sweepKind = active.some((c) => c.access === 'write') ? 'write' : 'read';
  const x = (t: number) => map.x0 + t * map.pps;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-[5]" aria-hidden="true">
      {sweeping && (
        <div className={`fx-sweep ${sweepKind}`} style={{ top: map.top, height: map.height, ['--fx-w' as string]: `${map.width}px` }} />
      )}
      {items.map((it) => {
        if (it.kind === 'spark') {
          return <span key={it.id} className="fx-spark" style={{ left: x(it.start), top: map.top + map.height / 2 }} />;
        }
        const left = x(it.start);
        const width = Math.max(2, (it.end - it.start) * map.pps);
        if (left + width < -50 || left > map.width + 50) return null;
        return (
          <div
            key={it.id}
            className={it.kind === 'slice' ? 'fx-slice' : 'fx-flash'}
            style={{ left, width, top: map.top + 2, height: map.height - 4, background: it.kind === 'slice' ? undefined : it.color, boxShadow: it.kind === 'slice' ? undefined : `inset 0 0 0 1px ${it.border}` }}
          />
        );
      })}
      {cursor && (
        <div className="fx-cursor" style={{ left: Math.max(6, Math.min(map.width - 6, x(cursor.t))), top: map.top + map.height * 0.82, opacity: now - cursor.born > 3400 ? 0 : 1 }}>
          <span className="dot block" />
          <span className="tag">AI · {cursor.label}</span>
        </div>
      )}
    </div>
  );
}
