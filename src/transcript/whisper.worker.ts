/// <reference lib="webworker" />
/**
 * Local Whisper worker: runs transformers.js (ONNX Runtime Web) on WebGPU, falling back to WASM.
 * Keeps one pipeline alive so repeated transcriptions are instant. Audio in, word chunks out.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from '@huggingface/transformers';
import type { WhisperWorkerRequest, WhisperWorkerResponse } from './whisperClient';

env.allowLocalModels = false;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey = '';

const post = (msg: WhisperWorkerResponse) => self.postMessage(msg);

self.onmessage = async (ev: MessageEvent<WhisperWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    const key = `${msg.modelId}|${msg.device}`;
    if (asr && loadedKey === key) { post({ type: 'ready', modelId: msg.modelId, device: msg.device }); return; }
    try {
      if (asr) { await asr.dispose(); asr = null; loadedKey = ''; }
      asr = await pipeline('automatic-speech-recognition', msg.modelId, {
        device: msg.device,
        dtype: msg.device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
        progress_callback: (info: ProgressInfo) => post({ type: 'progress', info }),
      });
      loadedKey = key;
      post({ type: 'ready', modelId: msg.modelId, device: msg.device });
    } catch (e) {
      asr = null;
      loadedKey = '';
      post({ type: 'error', message: (e as Error)?.message ?? String(e) });
    }
    return;
  }
  if (msg.type === 'transcribe') {
    if (!asr) { post({ type: 'error', id: msg.id, message: 'Model not loaded' }); return; }
    try {
      const out = (await asr(msg.audio, {
        return_timestamps: 'word',
        ...(msg.language ? { language: msg.language, task: 'transcribe' } : {}),
      })) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
      post({ type: 'result', id: msg.id, text: out.text ?? '', chunks: out.chunks ?? [] });
    } catch (e) {
      post({ type: 'error', id: msg.id, message: (e as Error)?.message ?? String(e) });
    }
    return;
  }
  if (msg.type === 'dispose') {
    if (asr) { await asr.dispose(); asr = null; loadedKey = ''; }
    post({ type: 'disposed' });
  }
};
