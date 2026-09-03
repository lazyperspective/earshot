import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useFx, reducedMotion, type FxEvent, type FxRangeKind } from '../lib/fx';

export interface FxMap { x0: number; pps: number; top: number; height: number; width: number }

interface Item { id: number; kind: 'flash' | 'slice' | 'spark'; start: number; end: number; color: string; border: string; born: number; ttl: number }
interface Cursor { t: number; label: string; born: number }
interface Curve { points: { t: number; db: number }[]; label?: string; born: number }
interface Wash { kind: 'commit' | 'undo' | 'export'; id: number; born: number }

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
  read: { fill: 'rgba(46,230,197,0.07)', border: 'rgba(46,230,197,0.25)', label: 'listening' },
  loud: { fill: 'rgba(242,109,109,0.16)', border: 'rgba(242,109,109,0.7)', label: 'loud' },
  undo: { fill: 'rgba(245,185,66,0.12)', border: 'rgba(245,185,66,0.5)', label: 'undo' },
  export: { fill: 'rgba(46,230,197,0.14)', border: 'rgba(46,230,197,0.6)', label: 'exported' },
  rejected: { fill: 'rgba(242,109,109,0.22)', border: 'rgba(242,109,109,0.9)', label: 'rejected' },
  pending: { fill: 'rgba(46,230,197,0.26)', border: 'rgba(46,230,197,1)', label: 'pending review' },
  restored: { fill: 'rgba(46,230,197,0.22)', border: 'rgba(46,230,197,0.9)', label: 'restored' },
};

let seq = 0;

/** Overlay on the waveform: scanline while the agent listens, flashes where it looked, slices where it cut, an AI cursor. */
export function AgentFxLayer({ getMap }: { getMap: () => FxMap | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [curve, setCurve] = useState<Curve | null>(null);
  const [washes, setWashes] = useState<Wash[]>([]);
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
      return;
    }
    if (e.type === 'curve') { setCurve({ points: e.points, label: e.label, born: now }); return; }
    if (e.type === 'wash') { setWashes((prev) => [...prev.slice(-2), { kind: e.kind, id: ++seq, born: now }]); }
  }, [reduced]);
  useFx(handler);

  // keep repainting while anything is alive (positions follow scroll/zoom), then stop
  const alive = items.length > 0 || cursor !== null || curve !== null || washes.length > 0 || active.length > 0 || Date.now() < sweepUntil.current;
  useEffect(() => {
    if (!alive) return;
    const id = setInterval(() => {
      const now = Date.now();
      setItems((prev) => (prev.some((i) => now - i.born > i.ttl) ? prev.filter((i) => now - i.born <= i.ttl) : prev));
      setCursor((c) => (c && now - c.born > 4200 ? null : c));
      setCurve((c) => (c && now - c.born > 3200 ? null : c));
      setWashes((prev) => (prev.some((w) => now - w.born > 1100) ? prev.filter((w) => now - w.born <= 1100) : prev));
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
      {washes.map((w) => (
        <div key={w.id} className={`fx-wash ${w.kind}`} style={{ top: map.top, height: map.height, ['--fx-w' as string]: `${map.width}px` }} />
      ))}
      {curve && (() => {
        const pts = curve.points.filter((p) => Number.isFinite(p.db));
        if (pts.length < 2) return null;
        const lo = -60, hi = 0;
        const y = (db: number) => map.top + 6 + (1 - (Math.max(lo, Math.min(hi, db)) - lo) / (hi - lo)) * (map.height - 12);
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.db).toFixed(1)}`).join(' ');
        const age = now - curve.born;
        const opacity = age < 300 ? age / 300 : age > 2400 ? Math.max(0, 1 - (age - 2400) / 800) : 1;
        return (
          <svg className="absolute inset-0 w-full h-full" style={{ opacity }}>
            <path d={d} fill="none" stroke="rgba(46,230,197,0.95)" strokeWidth={2} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgba(46,230,197,0.7))' }} />
            <path d={`${d} L${x(pts[pts.length - 1].t).toFixed(1)},${(map.top + map.height).toFixed(1)} L${x(pts[0].t).toFixed(1)},${(map.top + map.height).toFixed(1)} Z`} fill="rgba(46,230,197,0.08)" stroke="none" />
            {curve.label && <text x={map.x0 + 12} y={map.top + 22} fill="#2EE6C5" fontSize={11} fontFamily="JetBrains Mono, monospace">AI · {curve.label}</text>}
          </svg>
        );
      })()}
      {cursor && (
        <div className="fx-cursor" style={{ left: Math.max(6, Math.min(map.width - 6, x(cursor.t))), top: map.top + map.height * 0.82, opacity: now - cursor.born > 3400 ? 0 : 1 }}>
          <span className="dot block" />
          <span className="tag">AI · {cursor.label}</span>
        </div>
      )}
    </div>
  );
}
