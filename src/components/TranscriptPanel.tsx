import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, RefreshCw, Scissors, Settings2, X } from 'lucide-react';
import { useStore, getCuts } from '../store/useStore';
import { sourceToWorking } from '../audio/edl';
import { ensureTranscript } from '../transcript/service';
import { isFillerToken } from '../transcript/text';
import { performTextCuts } from '../webmcp/toolsExtra';
import { player } from '../audio/player';
import { cx, formatTime } from '../lib/format';
import { TranscriptionSettings } from './TranscriptionSettings';

interface WWord { id: number; text: string; start: number; end: number; filler: boolean; para: boolean; removed: boolean; opId?: string }

/** Index (into `words`) of the visible word under time t, or -1. */
function indexAt(words: WWord[], visible: number[], t: number): number {
  let lo = 0, hi = visible.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[visible[mid]].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans >= 0 && t <= words[visible[ans]].end + 0.15) return visible[ans];
  return -1;
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

const Word = memo(function Word({ w, i, active, selected, onDown, onEnter, onRestore }: {
  w: WWord; i: number; active: boolean; selected: boolean;
  onDown: (i: number) => void; onEnter: (i: number) => void; onRestore: (opId: string) => void;
}) {
  if (w.removed) {
    return (
      <span
        data-i={i}
        onClick={() => w.opId && onRestore(w.opId)}
        title="Removed — click to restore this cut"
        className="inline-block px-[2px] rounded-[3px] cursor-pointer select-none line-through decoration-danger/60 text-fg-4 hover:text-fg-2 hover:bg-danger/10 transition-colors duration-100"
      >
        {w.text}
      </span>
    );
  }
  return (
    <span
      data-i={i}
      onMouseDown={(e) => { e.preventDefault(); onDown(i); }}
      onMouseEnter={() => onEnter(i)}
      className={cx(
        'inline-block px-[2px] rounded-[3px] cursor-pointer select-none transition-colors duration-100',
        active ? 'bg-accent text-bg' : selected ? 'bg-amber/25 text-fg' : 'hover:bg-panel-3',
        w.filler && !active && 'underline decoration-dotted decoration-amber/70 underline-offset-[3px] text-fg-2',
      )}
    >
      {w.text}
    </span>
  );
});

function engineLabel(engine?: string, model?: string): string {
  if (engine === 'bundled') return 'bundled demo transcript';
  if (engine === 'local') return `Local Whisper · ${model ?? ''}`;
  if (engine === 'openai') return `OpenAI · ${model ?? 'whisper-1'}`;
  return model ?? 'transcript';
}

export function TranscriptPanel() {
  const transcript = useStore((s) => s.transcript);
  const engine = useStore((s) => s.transcription.engine);
  const edl = useStore((s) => s.edl);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const hasAudio = useStore((s) => !!s.workingBuffer);
  const showRemoved = useStore((s) => s.showRemovedWords);
  const toggleShowRemoved = useStore((s) => s.toggleShowRemoved);
  const restoreCut = useStore((s) => s.restoreCut);
  const logActivity = useStore((s) => s.logActivity);
  const isRendering = useStore((s) => s.isRendering);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const dragRef = useRef<{ a: number; b: number } | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const { words, visible } = useMemo(() => {
    if (transcript.status !== 'ready') return { words: [] as WWord[], visible: [] as number[] };
    const cuts = getCuts({ edl });
    const cutOps = edl.filter((op) => op.type === 'cut');
    const t = transcript.transcript;
    const segStarts = new Set(t.segments.map((s) => s.start));
    const out: WWord[] = [];
    const vis: number[] = [];
    for (let i = 0; i < t.words.length; i++) {
      const w = t.words[i];
      const a = sourceToWorking(w.start, cuts), b = sourceToWorking(w.end, cuts);
      const removed = cuts.length > 0 && (b - a < 0.001 || b - a < 0.3 * (w.end - w.start));
      const mid = (w.start + w.end) / 2;
      const op = removed ? cutOps.find((o) => o.type === 'cut' && mid >= o.start - 1e-3 && mid <= o.end + 1e-3) : undefined;
      out.push({ id: i, text: w.text, start: a, end: b, filler: isFillerToken(w.text), para: segStarts.has(w.start) && out.length > 0, removed, opId: op?.id });
      if (!removed) vis.push(out.length - 1);
    }
    return { words: out, visible: vis };
  }, [transcript, edl]);

  const removedCount = words.length - visible.length;
  const activeIdx = useStore((s) => indexAt(words, visible, s.playhead));

  useEffect(() => {
    if (activeIdx < 0) return;
    activeRef.current?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  useEffect(() => {
    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDrag(null);
      const lo = Math.min(d.a, d.b), hi = Math.max(d.a, d.b);
      if (lo === hi) player.seek(words[lo].start);
      else setSelection({ start: words[lo].start, end: words[hi].end });
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [words, setSelection]);

  const onDown = (i: number) => { dragRef.current = { a: i, b: i }; setDrag({ a: i, b: i }); };
  const onEnter = (i: number) => { if (dragRef.current) { dragRef.current.b = i; setDrag({ ...dragRef.current }); } };

  const selRange = useMemo(() => {
    if (drag) return { lo: Math.min(drag.a, drag.b), hi: Math.max(drag.a, drag.b) };
    if (!selection) return null;
    let lo = -1, hi = -1;
    for (const i of visible) {
      if (words[i].end > selection.start && words[i].start < selection.end) { if (lo < 0) lo = i; hi = i; }
    }
    return lo >= 0 ? { lo, hi } : null;
  }, [drag, selection, words, visible]);

  const selectedCount = useMemo(() => (selRange ? visible.filter((i) => i >= selRange.lo && i <= selRange.hi).length : 0), [selRange, visible]);

  const cutSelected = async () => {
    if (!selRange || selectedCount === 0 || isRendering) return;
    const from = words[selRange.lo].id, to = words[selRange.hi].id;
    const text = words.slice(selRange.lo, selRange.hi + 1).filter((w) => !w.removed).map((w) => w.text).join(' ');
    try {
      const r = await performTextCuts({ items: [{ from, to, reason: `Cut by you: “${text.length > 60 ? text.slice(0, 57) + '…' : text}”` }], mode: 'apply', author: 'human' });
      logActivity({ tool: 'cut_text', args: { from_id: from, to_id: to }, result: r, summary: `You cut “${text.length > 50 ? text.slice(0, 47) + '…' : text}” · −${r.removed_s}s`, durationMs: 0, ok: true, source: 'ui', access: 'write' });
    } catch (e) {
      logActivity({ tool: 'cut_text', args: { from_id: from, to_id: to }, result: { error: String(e) }, summary: `Cut failed: ${(e as Error).message}`, durationMs: 0, ok: false, source: 'ui', access: 'write' });
    }
    setSelection(null);
  };

  const onRestore = async (opId: string) => {
    const m = await restoreCut(opId);
    logActivity({ tool: 'restore_cut', args: { id: opId }, result: { restored: !!m }, summary: `You restored “${m?.text ?? 'cut'}”`, durationMs: 0, ok: true, source: 'ui', access: 'write' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if ((e.key === 'Backspace' || e.key === 'Delete') && selRange && selectedCount > 0 && useStore.getState().bottomTab === 'transcript') {
        e.preventDefault();
        void cutSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRange, selectedCount, words, isRendering]);

  if (!hasAudio) return null;

  if (transcript.status === 'idle') {
    return (
      <Center>
        <div className="text-[13px] text-fg-2 mb-1">No transcript yet. Choose how to transcribe:</div>
        <TranscriptionSettings hasTranscript={false} />
        <div className="text-[11.5px] text-fg-4 mt-1">Your agent can also call <span className="mono text-fg-3">get_transcript</span> — it uses the engine selected here. The demo clip ships with a bundled transcript.</div>
      </Center>
    );
  }
  if (transcript.status === 'transcribing') {
    return (
      <Center>
        <Loader2 size={18} className="text-accent animate-spin" />
        <div className="text-[13px] text-fg-2">{transcript.note ?? 'Transcribing…'}</div>
        <div className="w-[300px] h-1 rounded-full bg-panel-3 overflow-hidden"><div className="h-full bg-accent transition-all duration-300" style={{ width: `${Math.round(transcript.progress * 100)}%` }} /></div>
        <div className="mono text-[11px] text-fg-4">{Math.round(transcript.progress * 100)}%</div>
      </Center>
    );
  }
  if (transcript.status === 'error') {
    return (
      <Center>
        <AlertCircle size={18} className="text-danger" />
        <div className="text-[13px] text-fg-2">Transcription failed</div>
        <div className="text-[12px] text-danger max-w-[520px] mb-2">{transcript.message}</div>
        <TranscriptionSettings hasTranscript={false} />
      </Center>
    );
  }

  const t = transcript.transcript;
  return (
    <div className="h-full flex flex-col">
      <div className="h-9 shrink-0 flex items-center gap-2.5 px-4 border-b border-line text-[11.5px] text-fg-3">
        <span className="whitespace-nowrap"><span className="text-fg-2 font-medium">{visible.length}</span> words</span>
        <span className="chip bg-panel-3 text-fg-2 normal-case tracking-normal font-medium whitespace-nowrap max-w-[220px] truncate">{engineLabel(t.engine, t.model)}</span>
        {removedCount > 0 && (
          <button className={cx('btn btn-ghost h-6 px-1.5 text-[11px] whitespace-nowrap', showRemoved ? 'text-fg-2' : 'text-fg-4')} onClick={toggleShowRemoved} title="Show removed words as strikethrough">
            {showRemoved ? <Eye size={11} /> : <EyeOff size={11} />} {removedCount} removed
          </button>
        )}
        <span className="text-fg-4 hidden 2xl:inline whitespace-nowrap">· click to seek · drag to select · <span className="kbd">⌫</span> cuts the selection</span>
        <div className="flex-1" />
        {selRange && selectedCount > 0 && (
          <button className="btn h-6 px-2 text-[11.5px] text-amber border-amber/40 bg-amber/10 hover:bg-amber/20 hover:text-amber hover:border-amber/60" onClick={() => void cutSelected()} disabled={isRendering} title="Remove these words and their audio (Backspace)">
            <Scissors size={12} /> Cut {selectedCount} word{selectedCount === 1 ? '' : 's'}
          </button>
        )}
        {activeIdx >= 0 && <span className="mono text-fg-4">{formatTime(words[activeIdx].start, { ms: true })}</span>}
        <button className="btn btn-ghost h-6 px-1.5 text-[11px] text-fg-3 whitespace-nowrap" title={`Ignore caches and transcribe again with ${engine === 'local' ? 'local Whisper' : 'OpenAI'}`} onClick={() => void ensureTranscript({ force: true })}><RefreshCw size={11} /> Re-transcribe</button>
        <button className={cx('btn btn-ghost h-6 px-1.5 text-[11px] text-fg-3', showSettings && 'text-fg bg-panel-3')} title="Transcription engine settings" aria-label="Transcription settings" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? <X size={12} /> : <Settings2 size={12} />}
        </button>
      </div>
      {showSettings ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex justify-center px-5 py-4">
          <TranscriptionSettings hasTranscript onDone={() => setShowSettings(false)} />
        </div>
      ) : (
        <div ref={activeRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-3 text-[14px] leading-[1.9] text-fg">
          {words.map((w, i) => {
            if (w.removed && !showRemoved) return null;
            return (
              <span key={w.id}>
                {w.para && <br />}
                <Word w={w} i={i} active={i === activeIdx} selected={!w.removed && !!selRange && i >= selRange.lo && i <= selRange.hi} onDown={onDown} onEnter={onEnter} onRestore={(op) => void onRestore(op)} />{' '}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto flex flex-col items-center justify-center text-center gap-2 px-8 py-4">{children}</div>;
}
