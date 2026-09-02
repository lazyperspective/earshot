import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useStore, getCuts } from '../store/useStore';
import { sourceToWorking } from '../audio/edl';
import { ensureTranscript } from '../transcript/service';
import { isFillerToken } from '../transcript/text';
import { player } from '../audio/player';
import { cx, formatTime } from '../lib/format';

interface WWord { text: string; start: number; end: number; filler: boolean; para: boolean }

function indexAt(words: WWord[], t: number): number {
  let lo = 0, hi = words.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans >= 0 && t <= words[ans].end + 0.15) return ans;
  return -1;
}

const Word = memo(function Word({ w, i, active, selected, onDown, onEnter, onUp }: {
  w: WWord; i: number; active: boolean; selected: boolean;
  onDown: (i: number) => void; onEnter: (i: number) => void; onUp: (i: number) => void;
}) {
  return (
    <span
      data-i={i}
      onMouseDown={(e) => { e.preventDefault(); onDown(i); }}
      onMouseEnter={() => onEnter(i)}
      onMouseUp={() => onUp(i)}
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

export function TranscriptPanel() {
  const transcript = useStore((s) => s.transcript);
  const edl = useStore((s) => s.edl);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const hasAudio = useStore((s) => !!s.workingBuffer);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const dragRef = useRef<{ a: number; b: number } | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  const words: WWord[] = useMemo(() => {
    if (transcript.status !== 'ready') return [];
    const cuts = getCuts({ edl });
    const t = transcript.transcript;
    const segStarts = new Set(t.segments.map((s) => s.start));
    const out: WWord[] = [];
    for (const w of t.words) {
      const a = sourceToWorking(w.start, cuts), b = sourceToWorking(w.end, cuts);
      if (cuts.length && b - a < 0.001) continue;
      out.push({ text: w.text, start: a, end: b, filler: isFillerToken(w.text), para: segStarts.has(w.start) && out.length > 0 });
    }
    return out;
  }, [transcript, edl]);

  const activeIdx = useStore((s) => indexAt(words, s.playhead));

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = activeRef.current?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
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
  const onUp = () => { /* handled by window mouseup */ };

  const selRange = useMemo(() => {
    if (drag) return { lo: Math.min(drag.a, drag.b), hi: Math.max(drag.a, drag.b) };
    if (!selection) return null;
    let lo = -1, hi = -1;
    for (let i = 0; i < words.length; i++) {
      if (words[i].end > selection.start && words[i].start < selection.end) { if (lo < 0) lo = i; hi = i; }
    }
    return lo >= 0 ? { lo, hi } : null;
  }, [drag, selection, words]);

  if (!hasAudio) return null;

  if (transcript.status === 'idle') {
    return (
      <Center>
        <FileText size={18} className="text-fg-4" />
        <div className="text-[13px] text-fg-2">No transcript yet.</div>
        <div className="text-[12px] text-fg-4 max-w-[400px]">Transcribe with OpenAI Whisper (word timestamps) via the server, or let your agent call <span className="mono text-fg-3">get_transcript</span>. The demo clip ships with a bundled transcript.</div>
        <button className="btn btn-primary mt-1" onClick={() => void ensureTranscript()}><FileText size={14} /> Transcribe</button>
      </Center>
    );
  }
  if (transcript.status === 'transcribing') {
    return (
      <Center>
        <Loader2 size={18} className="text-accent animate-spin" />
        <div className="text-[13px] text-fg-2">{transcript.note ?? 'Transcribing…'}</div>
        <div className="w-[260px] h-1 rounded-full bg-panel-3 overflow-hidden"><div className="h-full bg-accent transition-all duration-300" style={{ width: `${Math.round(transcript.progress * 100)}%` }} /></div>
      </Center>
    );
  }
  if (transcript.status === 'error') {
    return (
      <Center>
        <AlertCircle size={18} className="text-danger" />
        <div className="text-[13px] text-fg-2">Transcription failed</div>
        <div className="text-[12px] text-danger max-w-[460px]">{transcript.message}</div>
        <button className="btn mt-1" onClick={() => void ensureTranscript({ force: true })}><RefreshCw size={13} /> Retry</button>
      </Center>
    );
  }

  const t = transcript.transcript;
  return (
    <div className="h-full flex flex-col">
      <div className="h-9 shrink-0 flex items-center gap-3 px-4 border-b border-line text-[11.5px] text-fg-3">
        <span><span className="text-fg-2 font-medium">{words.length}</span> words</span>
        <span>·</span>
        <span>{t.language?.toUpperCase() ?? 'EN'}</span>
        <span>·</span>
        <span>{transcript.cached ? 'cached' : 'transcribed just now'}</span>
        <span className="text-fg-4">· click a word to seek, drag to select · <span className="underline decoration-dotted decoration-amber/70">dotted</span> = filler</span>
        <div className="flex-1" />
        {activeIdx >= 0 && <span className="mono text-fg-4">{formatTime(words[activeIdx].start, { ms: true })}</span>}
        <button className="btn btn-ghost h-6 px-1.5 text-[11px] text-fg-3" title="Ignore caches and transcribe again with Whisper" onClick={() => void ensureTranscript({ force: true })}><RefreshCw size={11} /> Re-transcribe</button>
      </div>
      <div ref={activeRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-3 text-[14px] leading-[1.9] text-fg">
        {words.map((w, i) => (
          <span key={i}>
            {w.para && <br />}
            <Word w={w} i={i} active={i === activeIdx} selected={!!selRange && i >= selRange.lo && i <= selRange.hi} onDown={onDown} onEnter={onEnter} onUp={onUp} />{' '}
          </span>
        ))}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-8">{children}</div>;
}
