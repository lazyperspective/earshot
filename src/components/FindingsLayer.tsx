import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useStore, getCuts } from '../store/useStore';
import { sourceRangeToWorking, sourceToWorking } from '../audio/edl';
import { cx } from '../lib/format';
import type { FindingKind } from '../types';
import type { FxMap } from './AgentFxLayer';

const STYLE: Record<FindingKind, { fill: string; bar: string; dot: string; name: string }> = {
  silence: { fill: 'rgba(163,172,184,0.24)', bar: 'rgba(163,172,184,0.9)', dot: 'bg-[#A3ACB8]', name: 'silence' },
  filler: { fill: 'rgba(245,185,66,0.38)', bar: 'rgba(245,185,66,0.95)', dot: 'bg-amber', name: 'fillers' },
  quiet: { fill: 'rgba(46,230,197,0.16)', bar: 'rgba(46,230,197,0.7)', dot: 'bg-accent/70', name: 'quiet' },
  loud: { fill: 'rgba(242,109,109,0.20)', bar: 'rgba(242,109,109,0.8)', dot: 'bg-danger/80', name: 'loud' },
  clip: { fill: 'rgba(242,109,109,0.34)', bar: 'rgba(242,109,109,0.95)', dot: 'bg-danger', name: 'clipping' },
  match: { fill: 'rgba(46,230,197,0.36)', bar: 'rgba(46,230,197,1)', dot: 'bg-accent', name: 'matches' },
};
const ORDER: FindingKind[] = ['silence', 'filler', 'quiet', 'loud', 'clip', 'match'];

/** Persistent layer: what the agent found stays on the waveform until the next analysis or a clear. */
export function FindingsLayer({ getMap }: { getMap: () => FxMap | null }) {
  const findings = useStore((s) => s.findings);
  const edl = useStore((s) => s.edl);
  const toggle = useStore((s) => s.toggleFinding);
  const clear = useStore((s) => s.clearFindings);
  const cuts = useMemo(() => getCuts({ edl }), [edl]);
  const kinds = ORDER.filter((k) => findings.ranges[k]);
  const map = getMap();
  if (!map || (kinds.length === 0 && !findings.curve)) return null;
  const x = (t: number) => map.x0 + t * map.pps;

  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-[4]" aria-hidden="true">
        {kinds.map((k, lane) => {
          if (findings.hidden.includes(k)) return null;
          const st = STYLE[k];
          return findings.ranges[k]!.ranges.map((r, i) => {
            const w = sourceRangeToWorking(r, cuts);
            if (!w) return null;
            const left = x(w.start), width = Math.max(2, (w.end - w.start) * map.pps);
            if (left + width < -20 || left > map.width + 20) return null;
            return (
              <div key={`${k}-${i}`} className="absolute" style={{ left, width, top: map.top, height: map.height, background: st.fill, boxShadow: `inset 1px 0 0 ${st.bar}, inset -1px 0 0 ${st.bar}` }}>
                <span className="absolute left-0 right-0" style={{ top: 2 + lane * 6, height: 4, background: st.bar, borderRadius: 2, boxShadow: `0 0 6px ${st.bar}` }} />
              </div>
            );
          });
        })}
        {findings.curve && (() => {
          const pts = findings.curve.points.map((p) => ({ t: sourceToWorking(p.t, cuts), db: p.db })).filter((p) => Number.isFinite(p.db));
          if (pts.length < 2) return null;
          const lo = -60, hi = 0;
          const y = (db: number) => map.top + 6 + (1 - (Math.max(lo, Math.min(hi, db)) - lo) / (hi - lo)) * (map.height - 12);
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.db).toFixed(1)}`).join(' ');
          return (
            <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.9 }}>
              <path d={d} fill="none" stroke="rgba(46,230,197,0.95)" strokeWidth={2} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px rgba(46,230,197,0.6))' }} />
            </svg>
          );
        })()}
      </div>

      <div className="absolute left-4 top-3 z-[6] flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-full glass border border-line-2 text-[11px] select-none animate-fade-up">
        <span className="chip bg-accent/12 text-accent">AI found</span>
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => toggle(k)}
            title={`${findings.hidden.includes(k) ? 'Show' : 'Hide'} ${STYLE[k].name}`}
            className={cx('inline-flex items-center gap-1.5 h-5 px-1.5 rounded-md mono transition-colors', findings.hidden.includes(k) ? 'text-fg-4 line-through' : 'text-fg-2 hover:bg-panel-3')}
          >
            <span className={cx('w-1.5 h-1.5 rounded-full', STYLE[k].dot)} />
            {findings.ranges[k]!.label}
          </button>
        ))}
        {findings.curve && <span className="inline-flex items-center gap-1.5 h-5 px-1.5 mono text-fg-2"><span className="w-3 h-[2px] bg-accent/80 rounded" />{findings.curve.label}</span>}
        <button className="btn btn-icon btn-ghost h-5 w-5 text-fg-4" onClick={clear} title="Clear findings" aria-label="Clear findings"><X size={11} /></button>
      </div>
    </>
  );
}
