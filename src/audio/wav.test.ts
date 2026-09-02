import { describe, expect, it } from 'vitest';
import { encodeWav, readWavHeader } from './wav';

describe('encodeWav', () => {
  it('writes a valid 16-bit PCM header', () => {
    const l = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const r = new Float32Array([0, 0.25, -0.25, 1, -1]);
    const ab = encodeWav([l, r], 44100);
    const h = readWavHeader(ab);
    expect(h.riff).toBe('RIFF');
    expect(h.wave).toBe('WAVE');
    expect(h.format).toBe(1);
    expect(h.channels).toBe(2);
    expect(h.sampleRate).toBe(44100);
    expect(h.bitsPerSample).toBe(16);
    expect(h.dataSize).toBe(5 * 2 * 2);
    expect(ab.byteLength).toBe(44 + h.dataSize);
  });

  it('interleaves and clamps samples', () => {
    const l = new Float32Array([0.5, 2]);
    const r = new Float32Array([-0.5, -2]);
    const v = new DataView(encodeWav([l, r], 8000));
    expect(v.getInt16(44, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(v.getInt16(46, true)).toBe(Math.round(-0.5 * 0x8000));
    expect(v.getInt16(48, true)).toBe(0x7fff);
    expect(v.getInt16(50, true)).toBe(-0x8000);
  });
});
