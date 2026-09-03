let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export async function sha256Hex(ab: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compressed files over this size (≈ 20+ minutes of MP3) are decoded in large-file mode. */
const LARGE_COMPRESSED_BYTES = 20 * 1024 * 1024;
const LARGE_RAW_BYTES = 400 * 1024 * 1024;
export const LARGE_FILE_SAMPLE_RATE = 24000;

export interface DecodeResult { buffer: AudioBuffer; hash: string; largeFileMode: boolean }

/**
 * Decode audio. Long files are decoded straight to mono 24 kHz (speech quality) so a 2-hour episode
 * takes ~700 MB instead of ~3 GB of Float32 samples, and everything downstream stays responsive.
 */
export async function decodeAudio(blob: Blob): Promise<DecodeResult> {
  const ab = await blob.arrayBuffer();
  const hash = await sha256Hex(ab.slice(0));
  const raw = /wav|aiff|x-aiff|flac|pcm/i.test(blob.type) || /\.(wav|aiff?|flac)$/i.test((blob as File).name ?? '');
  const large = blob.size > (raw ? LARGE_RAW_BYTES : LARGE_COMPRESSED_BYTES);
  if (!large) {
    const buffer = await getAudioContext().decodeAudioData(ab);
    return { buffer, hash, largeFileMode: false };
  }
  const off = new OfflineAudioContext(1, 1, LARGE_FILE_SAMPLE_RATE);
  const decoded = await off.decodeAudioData(ab);
  if (decoded.numberOfChannels === 1) return { buffer: decoded, hash, largeFileMode: true };
  const mono = new AudioBuffer({ numberOfChannels: 1, length: decoded.length, sampleRate: decoded.sampleRate });
  const out = mono.getChannelData(0);
  const n = decoded.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
  }
  return { buffer: mono, hash, largeFileMode: true };
}

/** Average all channels into a mono Float32Array. Only for SHORT buffers (previews/tests). */
export function toMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.numberOfChannels;
  if (n === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let ch = 0; ch < n; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
  }
  return out;
}
