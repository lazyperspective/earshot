import { describe, expect, it } from 'vitest';
import { chaptersToYouTube, timecode, toSrt, toVtt } from './exports';

describe('exports', () => {
  it('formats timecodes and SRT/VTT', () => {
    expect(timecode(3661.5)).toBe('01:01:01,500');
    const segs = [{ id: 0, text: 'Hello there.', start: 0.5, end: 1.25 }, { id: 1, text: 'Bye.', start: 2, end: 2.8 }];
    expect(toSrt(segs)).toBe('1\n00:00:00,500 --> 00:00:01,250\nHello there.\n\n2\n00:00:02,000 --> 00:00:02,800\nBye.\n');
    expect(toVtt(segs).startsWith('WEBVTT\n\n00:00:00.500 --> 00:00:01.250\nHello there.')).toBe(true);
  });
  it('writes YouTube chapters with an implicit intro', () => {
    expect(chaptersToYouTube([{ time: 95, title: 'Topic' }])).toBe('00:00 Intro\n01:35 Topic');
  });
});
