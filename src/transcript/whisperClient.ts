/**
 * Main-thread client for the local Whisper worker. Owns the worker lifecycle, publishes download/load
 * progress to the store, and exposes chunk transcription. Model files are cached by transformers.js in
 * the browser Cache API, so the download is a one-time click.
 */
import type { ProgressInfo } from '@huggingface/transformers';
import { useStore } from '../store/useStore';
import type { LocalDevice, LocalModelKey } from '../types';

export interface LocalModelInfo {
  id: string;
  label: string;
  hint: string;
  /** Approximate download in MB per device (fp32+q4 on WebGPU, q8 on WASM). */
  sizeMb: Record<LocalDevice, number>;
  multilingual: boolean;
}

export const LOCAL_MODELS: Record<LocalModelKey, LocalModelInfo> = {
  'tiny.en': { id: 'onnx-community/whisper-tiny.en_timestamped', label: 'Tiny · English', hint: 'Fastest, rough on names', sizeMb: { webgpu: 120, wasm: 41 }, multilingual: false },
  'base.en': { id: 'onnx-community/whisper-base.en_timestamped', label: 'Base · English', hint: 'Recommended', sizeMb: { webgpu: 206, wasm: 77 }, multilingual: false },
  'small.en': { id: 'onnx-community/whisper-small.en_timestamped', label: 'Small · English', hint: 'Best accuracy, slower', sizeMb: { webgpu: 586, wasm: 249 }, multilingual: false },
  base: { id: 'onnx-community/whisper-base_timestamped', label: 'Base · Multilingual', hint: '99 languages', sizeMb: { webgpu: 206, wasm: 77 }, multilingual: true },
};

export type WhisperWorkerRequest =
  | { type: 'load'; modelId: string; device: LocalDevice }
  | { type: 'transcribe'; id: number; audio: Float32Array; language?: string }
  | { type: 'dispose' };

export type WhisperWorkerResponse =
  | { type: 'progress'; info: ProgressInfo }
  | { type: 'ready'; modelId: string; device: LocalDevice }
  | { type: 'result'; id: number; text: string; chunks: { text: string; timestamp: [number, number | null] }[] }
  | { type: 'error'; id?: number; message: string }
  | { type: 'disposed' };

export function detectLocalDevice(): LocalDevice {
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: { text: string; chunks: { text: string; timestamp: [number, number | null] }[] }) => void; reject: (e: Error) => void }>();
let loadWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
let loading = false;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<WhisperWorkerResponse>) => {
    const m = ev.data;
    const s = useStore.getState();
    if (m.type === 'progress') {
      const info = m.info;
      if (info.status === 'progress_total') {
        const mb = (n: number) => (n / 1e6).toFixed(0);
        s.setLocalWhisper({ status: 'loading', progress: info.progress / 100, note: `Downloading ${mb(info.loaded)} / ${mb(info.total)} MB` });
      } else if (info.status === 'progress' && s.localWhisper.status === 'loading' && !s.localWhisper.note?.startsWith('Downloading')) {
        s.setLocalWhisper({ status: 'loading', progress: info.progress / 100, note: `Fetching ${info.file}` });
      } else if (info.status === 'ready') {
        s.setLocalWhisper({ status: 'loading', progress: 0.99, note: 'Warming up' });
      }
      return;
    }
    if (m.type === 'ready') {
      loading = false;
      s.setLocalWhisper({ status: 'ready', progress: 1, note: undefined, device: m.device, modelId: m.modelId });
      loadWaiters.forEach((w) => w.resolve());
      loadWaiters = [];
      return;
    }
    if (m.type === 'result') {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); p.resolve({ text: m.text, chunks: m.chunks }); }
      return;
    }
    if (m.type === 'error') {
      if (m.id != null) {
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); p.reject(new Error(m.message)); }
      } else {
        loading = false;
        s.setLocalWhisper({ status: 'error', progress: 0, note: m.message });
        loadWaiters.forEach((w) => w.reject(new Error(m.message)));
        loadWaiters = [];
      }
      return;
    }
    if (m.type === 'disposed') {
      s.setLocalWhisper({ status: 'idle', progress: 0, note: undefined, modelId: null });
    }
  };
  worker.onerror = (e) => {
    const msg = e.message || 'Local Whisper worker crashed';
    useStore.getState().setLocalWhisper({ status: 'error', progress: 0, note: msg });
    loadWaiters.forEach((w) => w.reject(new Error(msg)));
    loadWaiters = [];
    for (const p of pending.values()) p.reject(new Error(msg));
    pending.clear();
    loading = false;
  };
  return worker;
}

/** Download (once) and load the selected model into the worker. Resolves when ready. */
export function loadLocalModel(key: LocalModelKey): Promise<void> {
  const s = useStore.getState();
  const info = LOCAL_MODELS[key];
  const device = detectLocalDevice();
  if (s.localWhisper.status === 'ready' && s.localWhisper.modelId === info.id && s.localWhisper.device === device) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    loadWaiters.push({ resolve, reject });
    if (loading) return;
    loading = true;
    s.setLocalWhisper({ status: 'loading', progress: 0, note: 'Starting download', device, modelId: info.id });
    getWorker().postMessage({ type: 'load', modelId: info.id, device } satisfies WhisperWorkerRequest);
  });
}

export function transcribeLocalChunk(audio: Float32Array<ArrayBuffer>, language?: string) {
  const id = ++seq;
  return new Promise<{ text: string; chunks: { text: string; timestamp: [number, number | null] }[] }>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'transcribe', id, audio, language } satisfies WhisperWorkerRequest, [audio.buffer]);
  });
}

export function disposeLocalModel(): void {
  if (!worker) return;
  worker.postMessage({ type: 'dispose' } satisfies WhisperWorkerRequest);
}
