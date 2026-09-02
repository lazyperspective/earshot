import { describe, expect, it } from 'vitest';
import { computeNormalizeGain, detectClipping, detectSilences, loudnessProfile, rmsDb } from './analysis';

function tone(seconds: number, sr: number, amp: number, freq = 440): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

describe('detectSilences', () => {
  const sr = 8000;
  // 1s tone, 1.5s silence, 1s tone, 0.3s silence, 1s tone
  const signal = concat([tone(1, sr, 0.5), new Float32Array(sr * 1.5), tone(1, sr, 0.5), new Float32Array(sr * 0.3), tone(1, sr, 0.5)]);

  it('finds gaps longer than min duration and ignores short ones', () => {
    const s = detectSilences(signal, sr, { thresholdDb: -40, minDurationS: 0.7 });
    expect(s).toHaveLength(1);
    expect(s[0].start).toBeCloseTo(1, 1);
    expect(s[0].end).toBeCloseTo(2.5, 1);
    expect(s[0].duration).toBeCloseTo(1.5, 1);
  });

  it('respects min duration', () => {
    const s = detectSilences(signal, sr, { thresholdDb: -40, minDurationS: 0.2 });
    expect(s).toHaveLength(2);
    expect(s[1].duration).toBeCloseTo(0.3, 1);
  });

  it('treats quiet-but-not-silent audio according to threshold', () => {
    const quiet = concat([tone(1, sr, 0.5), tone(1, sr, 0.005), tone(1, sr, 0.5)]); // -49 dBFS RMS
    expect(detectSilences(quiet, sr, { thresholdDb: -40, minDurationS: 0.5 })).toHaveLength(1);
    expect(detectSilences(quiet, sr, { thresholdDb: -55, minDurationS: 0.5 })).toHaveLength(0);
  });
});

describe('loudness + clipping + normalize', () => {
  it('measures RMS in dBFS', () => {
    const t = tone(1, 8000, 1);
    expect(rmsDb(t)).toBeCloseTo(-3.01, 1);
    const p = loudnessProfile(t, 8000, 0.5);
    expect(p.points).toHaveLength(2);
    expect(p.peak_db).toBeCloseTo(0, 0);
    expect(p.unit).toBe('dBFS RMS');
  });

  it('detects clipped runs', () => {
    const x = new Float32Array(1000);
    x.fill(1, 100, 110);
    x.fill(-1, 500, 503);
    x[700] = 1; // single sample: not a run
    const r = detectClipping([x], 1000, 0.99, 2);
    expect(r.regions).toHaveLength(2);
    expect(r.clippedSamples).toBe(13);
    expect(r.regions[0].start).toBeCloseTo(0.1, 3);
  });

  it('computes normalize gain with a peak ceiling', () => {
    const t = tone(1, 8000, 0.1); // peak -20 dB, rms -23 dB
    const g = computeNormalizeGain(t, -16, 'rms');
    expect(g.gainDb).toBeCloseTo(7, 0);
    expect(g.limitedByPeak).toBe(false);
    const g2 = computeNormalizeGain(t, 0, 'rms');
    expect(g2.limitedByPeak).toBe(true);
    expect(g2.gainDb).toBeCloseTo(19.9, 0);
  });
});
