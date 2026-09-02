import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { cx } from '../lib/format';

const ROWS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← →', 'Nudge 1 s (⇧ for 5 s)'],
  ['[  ]', 'Set selection start / end at playhead'],
  ['Esc', 'Clear selection & focus'],
  ['L', 'Loop selection'],
  ['J / K', 'Next / previous proposal'],
  ['A / R', 'Approve / reject focused proposal'],
  ['P', 'Preview focused proposal'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
];

export function ShortcutsPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button className={cx('btn btn-icon btn-ghost', open && 'text-fg bg-panel-3')} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => setOpen((o) => !o)}>
        <Keyboard size={15} />
      </button>
      {open && (
        <div className="absolute right-0 bottom-10 z-30 w-[300px] glass border border-line-2 rounded-lg p-3 shadow-2xl animate-fade-up">
          <div className="text-[10.5px] uppercase tracking-wider text-fg-4 font-semibold mb-2">Keyboard</div>
          <ul className="space-y-1.5">
            {ROWS.map(([k, d]) => (
              <li key={k} className="flex items-center justify-between text-[12px]">
                <span className="text-fg-2">{d}</span>
                <span className="kbd h-5 px-1.5 text-[10.5px]">{k}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
