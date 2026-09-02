import { AlertCircle, Cloud, Cpu, Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';
import { LOCAL_MODELS, detectLocalDevice, loadLocalModel } from '../transcript/whisperClient';
import { ensureTranscript } from '../transcript/service';
import { cx } from '../lib/format';
import type { LocalModelKey } from '../types';

/**
 * Engine picker: OpenAI Whisper API (server key) or Whisper running locally on WebGPU (one-time download).
 * Used in the Transcript tab's empty state and behind its settings gear.
 */
export function TranscriptionSettings({ hasTranscript, onDone }: { hasTranscript: boolean; onDone?: () => void }) {
  const { engine, model } = useStore((s) => s.transcription);
  const setEngine = useStore((s) => s.setTranscriptionEngine);
  const setModel = useStore((s) => s.setLocalModel);
  const local = useStore((s) => s.localWhisper);
  const device = detectLocalDevice();
  const info = LOCAL_MODELS[model];
  const ready = local.status === 'ready' && local.modelId === info.id && local.device === device;
  const loading = local.status === 'loading';

  const run = (force: boolean) => { onDone?.(); void ensureTranscript({ force }); };
  const downloadAndRun = () => {
    onDone?.();
    void loadLocalModel(model).then(() => ensureTranscript({ force: true })).catch(() => { /* surfaced via store */ });
  };

  return (
    <div className="w-full max-w-[560px] text-left">
      <div className="text-[10.5px] uppercase tracking-wider text-fg-4 font-semibold mb-2">Transcription engine</div>
      <div className="grid grid-cols-2 gap-2">
        <EngineCard active={engine === 'openai'} onClick={() => setEngine('openai')} icon={<Cloud size={15} />} title="OpenAI Whisper API" sub="Server key · whisper-1 · word timestamps" />
        <EngineCard active={engine === 'local'} onClick={() => setEngine('local')} icon={<Cpu size={15} />} title="Local · WebGPU" sub="Runs in your browser · nothing uploaded" />
      </div>

      {engine === 'openai' ? (
        <div className="mt-3 rounded-lg border border-line bg-panel-2 p-3">
          <p className="text-[12.5px] text-fg-3 leading-relaxed">
            Audio is resampled to 16 kHz mono and sent in ≤ 2-minute chunks to <span className="mono text-fg-2">/api/transcribe</span>, which calls OpenAI with the server's <span className="mono text-fg-2">OPENAI_API_KEY</span>. Nothing is stored server-side.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button className="btn btn-primary" onClick={() => run(hasTranscript)}>
              {hasTranscript ? <RefreshCw size={14} /> : <FileText size={14} />} {hasTranscript ? 'Re-transcribe with OpenAI' : 'Transcribe'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-line bg-panel-2 p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <select className="select" value={model} onChange={(e) => setModel(e.target.value as LocalModelKey)} disabled={loading} aria-label="Local Whisper model">
              {(Object.keys(LOCAL_MODELS) as LocalModelKey[]).map((k) => (
                <option key={k} value={k}>{LOCAL_MODELS[k].label} · {LOCAL_MODELS[k].sizeMb[device]} MB · {LOCAL_MODELS[k].hint}</option>
              ))}
            </select>
            <span className={cx('chip', device === 'webgpu' ? 'bg-accent/12 text-accent' : 'bg-amber/12 text-amber')} title={device === 'webgpu' ? 'navigator.gpu detected' : 'No WebGPU in this browser — falls back to WebAssembly (slower)'}>
              {device === 'webgpu' ? 'WebGPU' : 'WASM fallback'}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] text-fg-3 leading-relaxed">
            Whisper runs entirely in a Web Worker on your GPU via transformers.js. The model downloads once (from Hugging Face) and is cached by your browser; audio never leaves your device.
          </p>

          {local.status === 'error' && (
            <div className="mt-2 flex items-start gap-2 text-[12px] text-danger"><AlertCircle size={13} className="mt-0.5 shrink-0" /> <span>{local.note}</span></div>
          )}

          <div className="mt-3 flex items-center gap-3">
            {loading ? (
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[12px] text-fg-2"><Loader2 size={13} className="animate-spin text-accent" /> {local.note ?? 'Loading model'} <span className="mono text-fg-4 ml-auto">{Math.round(local.progress * 100)}%</span></div>
                <div className="mt-1.5 h-1 rounded-full bg-panel-3 overflow-hidden"><div className="h-full bg-accent transition-all duration-300" style={{ width: `${Math.round(local.progress * 100)}%` }} /></div>
              </div>
            ) : ready ? (
              <>
                <span className="chip bg-ok/10 text-ok">Ready · {info.label}</span>
                <button className="btn btn-primary" onClick={() => run(true)}>
                  <Cpu size={14} /> {hasTranscript ? 'Re-transcribe locally' : 'Transcribe locally'}
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={downloadAndRun}>
                <Download size={14} /> Download {info.sizeMb[device]} MB &amp; transcribe
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EngineCard({ active, onClick, icon, title, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all duration-150',
        active ? 'border-accent/60 bg-accent/[0.06] ring-1 ring-accent/40' : 'border-line-2 bg-panel-2 hover:border-fg-4',
      )}
    >
      <span className={cx('w-7 h-7 shrink-0 rounded-md flex items-center justify-center', active ? 'bg-accent/15 text-accent' : 'bg-panel-3 text-fg-3')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-fg">{title}</span>
        <span className="block text-[11.5px] text-fg-3 mt-0.5">{sub}</span>
      </span>
    </button>
  );
}
