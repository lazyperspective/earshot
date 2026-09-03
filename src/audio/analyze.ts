/**
 * Envelope cache + async analysis. The envelope is computed once per AudioBuffer in ~10 s slices with
 * yields between them, so a 2-hour file never blocks the UI and never gets copied.
 */
import type { ClipRegion, LoudnessProfile, SilenceRegion } from '../types';
import type { Range } from './edl';
import {
  accumulateEnvelope, detectClippingEnv, detectSilencesEnv, loudnessProfileEnv, newEnvelope, normalizeGainEnv, segmentLoudnessEnv,
  type Envelope, type SilenceOptions, type SpeakerSegment,
} from './analysis';

const cache = new WeakMap<AudioBuffer, Promise<Envelope>>();
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

export async function computeEnvelopeAsync(buffer: AudioBuffer, clipThreshold = 0.99, onProgress?: (p: number) => void): Promise<Envelope> {
  const env = newEnvelope(buffer.length, buffer.sampleRate, 0.01, clipThreshold);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const batch = 1000; // 10 s of windows per slice
  for (let w = 0; w < env.frames; w += batch) {
    accumulateEnvelope(env, channels, w, Math.min(env.frames, w + batch));
    onProgress?.(Math.min(1, (w + batch) / env.frames));
    if (w + batch < env.frames) await yieldToUI();
  }
  return env;
}

/** Cached per buffer. */
export function envelopeOf(buffer: AudioBuffer): Promise<Envelope> {
  let p = cache.get(buffer);
  if (!p) { p = computeEnvelopeAsync(buffer); cache.set(buffer, p); }
  return p;
}

export async function analyzeSilences(buffer: AudioBuffer, opts: SilenceOptions): Promise<SilenceRegion[]> {
  return detectSilencesEnv(await envelopeOf(buffer), opts);
}
export async function analyzeLoudness(buffer: AudioBuffer, windowS: number): Promise<LoudnessProfile> {
  return loudnessProfileEnv(await envelopeOf(buffer), windowS);
}
export async function analyzeClipping(buffer: AudioBuffer, threshold: number): Promise<{ regions: ClipRegion[]; clippedSamples: number }> {
  const env = Math.abs(threshold - 0.99) < 1e-6 ? await envelopeOf(buffer) : await computeEnvelopeAsync(buffer, threshold);
  return detectClippingEnv(env);
}
export async function analyzeSegments(buffer: AudioBuffer, segments?: Range[]): Promise<{ segments: SpeakerSegment[]; integrated_db: number }> {
  return segmentLoudnessEnv(await envelopeOf(buffer), segments);
}
export async function normalizeGainOf(buffer: AudioBuffer, targetDb: number, mode: 'rms' | 'peak') {
  return normalizeGainEnv(await envelopeOf(buffer), targetDb, mode);
}
