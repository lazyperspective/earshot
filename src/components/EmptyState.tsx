import { useState } from 'react';
import { Ear, Loader2, Sparkles, Upload, Waves } from 'lucide-react';
import { Logo } from './Logo';
import { cx } from '../lib/format';

export function EmptyState({ onFile, onDemo, loading, error }: {
  onFile: (file: File) => void;
  onDemo: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [drag, setDrag] = useState(false);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={cx(
          'relative w-full max-w-[680px] rounded-2xl border border-dashed p-10 text-center transition-all duration-150 glass',
          drag ? 'border-accent bg-accent/[0.06]' : 'border-line-2',
        )}
      >
        <div className="flex justify-center mb-5"><Logo size={44} className="logo-breathe" /></div>
        <h1 className="text-[22px] font-semibold tracking-tight">Your agent can hear now.</h1>
        <p className="mt-2 text-[13.5px] text-fg-3 leading-relaxed max-w-[460px] mx-auto">
          Open a recording. Your AI agent listens through Earshot, proposes cuts and level fixes on the timeline,
          and you approve them with your ears.
        </p>

        <div className="mt-7 flex items-center justify-center gap-3">
          <label className={cx('btn btn-primary h-10 px-5 text-[13.5px]', loading && 'opacity-50 pointer-events-none')}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {loading ? 'Opening…' : 'Open audio file'}
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.webm"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }}
            />
          </label>
        </div>
        <div className="mt-3 text-[12px] text-fg-4">
          Drop MP3, WAV, M4A or FLAC here · processed on your device ·{' '}
          <button className="text-fg-3 underline decoration-dotted underline-offset-[3px] hover:text-accent transition-colors" onClick={onDemo} disabled={loading}>
            or try a sample episode
          </button>
        </div>
        {error && <div className="mt-3 text-[12px] text-danger">{error}</div>}

        <div className="mt-8 grid grid-cols-3 gap-3 text-left">
          <Step icon={<Waves size={14} />} n="1" title="Open" text="Any recording, any length. Long episodes open at a readable zoom." />
          <Step icon={<Ear size={14} />} n="2" title="Ask your agent" text="It hears silences, levels and every word, then proposes surgical edits." />
          <Step icon={<Sparkles size={14} />} n="3" title="Approve" text="Preview each change, approve or reject, undo anything. Export when it sounds right." />
        </div>
      </div>
    </div>
  );
}

function Step({ icon, n, title, text }: { icon: React.ReactNode; n: string; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/60 p-3">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
        <span className="w-6 h-6 rounded-md bg-accent/10 text-accent flex items-center justify-center">{icon}</span>
        <span className="text-fg-4 mono text-[11px]">{n}</span> {title}
      </div>
      <p className="mt-1.5 text-[12px] text-fg-3 leading-snug">{text}</p>
    </div>
  );
}
