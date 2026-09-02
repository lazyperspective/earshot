let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export async function sha256Hex(ab: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function decodeAudio(blob: Blob): Promise<{ buffer: AudioBuffer; hash: string }> {
  const ab = await blob.arrayBuffer();
  const hash = await sha256Hex(ab.slice(0));
  const buffer = await getAudioContext().decodeAudioData(ab);
  return { buffer, hash };
}

/** Average all channels into a mono Float32Array (for analysis only). */
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
