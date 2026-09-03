import { useState } from 'react';
import { FileAudio, Upload } from 'lucide-react';
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
          'relative w-full max-w-[640px] rounded-2xl border border-dashed p-10 text-center transition-all duration-150 glass',
          drag ? 'border-accent bg-accent/[0.06]' : 'border-line-2',
        )}
      >
        <div className="flex justify-center mb-5"><Logo size={44} className="logo-breathe" /></div>
        <h1 className="text-[22px] font-semibold tracking-tight">Your agent can hear now.</h1>
        <p className="mt-2 text-[13.5px] text-fg-3 leading-relaxed max-w-[440px] mx-auto">
          Load a recording. Earshot exposes its ears to your AI agent over <span className="text-fg-2">WebMCP</span> —
          it listens, proposes cuts and levels on the timeline, and you approve them with yours.
        </p>

        <div className="mt-7 flex items-center justify-center gap-3">
          <label className={cx('btn h-9 px-4', loading && 'opacity-50 pointer-events-none')}>
            <Upload size={15} /> Choose audio
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.webm"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }}
            />
          </label>
          <button className="btn btn-primary h-9 px-4" onClick={onDemo} disabled={loading}>
            <FileAudio size={15} /> Load demo podcast clip
          </button>
        </div>

        <div className="mt-4 text-[11.5px] text-fg-4">
          {loading ? 'Decoding audio…' : 'Drag & drop MP3, WAV, M4A · processed locally in your browser'}
        </div>
        {error && <div className="mt-3 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
