/**
 * Non-destructive renderer: source AudioBuffer + EDL -> working AudioBuffer.
 * Stage 1: gain/fade/normalize/filter ops on the source timeline via OfflineAudioContext.
 * Stage 2: cuts removed by pure sample splicing with 5ms fades (see edl.ts).
 */
import type { EDL, EditOp } from '../types';
import { cutsFromEdl, dbToLinear, spliceChannel, type Range } from './edl';

const XF = 0.01; // 10ms automation crossfade for region-limited ops

function rampRegion(param: AudioParam, start: number, end: number, inside: number, outside: number, duration: number) {
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(s, Math.min(end, duration));
  param.setValueAtTime(outside, 0);
  const a0 = Math.max(0, s - XF);
  param.setValueAtTime(outside, a0);
  param.linearRampToValueAtTime(inside, s);
  param.setValueAtTime(inside, e);
  param.linearRampToValueAtTime(outside, Math.min(duration, e + XF));
}

function attachOp(ctx: OfflineAudioContext, input: AudioNode, op: EditOp, duration: number): AudioNode {
  switch (op.type) {
    case 'cut':
      return input;
    case 'gain': {
      const g = ctx.createGain();
      rampRegion(g.gain, op.start, op.end, dbToLinear(op.gainDb), 1, duration);
      input.connect(g);
      return g;
    }
    case 'normalize': {
      const g = ctx.createGain();
      g.gain.value = dbToLinear(op.gainDb);
      input.connect(g);
      return g;
    }
    case 'fade_in': {
      const g = ctx.createGain();
      const s = Math.max(0, op.start);
      const e = Math.max(s + 0.001, op.end);
      g.gain.setValueAtTime(1, 0);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(1, e);
      input.connect(g);
      return g;
    }
    case 'fade_out': {
      const g = ctx.createGain();
      const s = Math.max(0, op.start);
      const e = Math.max(s + 0.001, op.end);
      g.gain.setValueAtTime(1, 0);
      g.gain.setValueAtTime(1, s);
      g.gain.linearRampToValueAtTime(0, e);
      if (e < duration - 0.001) g.gain.setValueAtTime(1, e + 1 / ctx.sampleRate);
      input.connect(g);
      return g;
    }
    case 'notch_filter':
    case 'highpass': {
      const f = ctx.createBiquadFilter();
      f.type = op.type === 'notch_filter' ? 'notch' : 'highpass';
      f.frequency.value = op.frequencyHz;
      f.Q.value = op.type === 'notch_filter' ? op.q : 0.707;
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const sum = ctx.createGain();
      rampRegion(dry.gain, op.start, op.end, 0, 1, duration);
      rampRegion(wet.gain, op.start, op.end, 1, 0, duration);
      input.connect(dry);
      input.connect(f);
      f.connect(wet);
      dry.connect(sum);
      wet.connect(sum);
      return sum;
    }
  }
}

async function processOps(source: AudioBuffer, ops: EditOp[]): Promise<AudioBuffer> {
  if (ops.length === 0) return source;
  const ctx = new OfflineAudioContext(source.numberOfChannels, source.length, source.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = source;
  let node: AudioNode = src;
  for (const op of ops) node = attachOp(ctx, node, op, source.duration);
  node.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

export function applyCuts(buffer: AudioBuffer, cuts: Range[]): AudioBuffer {
  if (cuts.length === 0) return buffer;
  const chans: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    chans.push(spliceChannel(buffer.getChannelData(ch), buffer.sampleRate, cuts));
  }
  const length = Math.max(1, chans[0].length);
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length, sampleRate: buffer.sampleRate });
  chans.forEach((d, i) => { if (d.length) out.copyToChannel(d as Float32Array<ArrayBuffer>, i); });
  return out;
}

export async function renderEdl(source: AudioBuffer, edl: EDL, onProgress?: (p: number) => void): Promise<AudioBuffer> {
  onProgress?.(0.05);
  const processed = await processOps(source, edl.filter((op) => op.type !== 'cut'));
  onProgress?.(0.7);
  const result = applyCuts(processed, cutsFromEdl(edl));
  onProgress?.(1);
  return result;
}
