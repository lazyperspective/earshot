/// <reference lib="webworker" />
import { detectClipping, detectSilences, loudnessProfile, segmentLoudness } from './analysis';
import type { AnalysisRequest, AnalysisResponse } from './analyze';

self.onmessage = (ev: MessageEvent<AnalysisRequest>) => {
  const req = ev.data;
  let result: unknown;
  try {
    switch (req.kind) {
      case 'silences':
        result = detectSilences(req.mono, req.sampleRate, req.opts);
        break;
      case 'loudness':
        result = loudnessProfile(req.mono, req.sampleRate, req.windowS);
        break;
      case 'clipping':
        result = detectClipping(req.channels, req.sampleRate, req.threshold);
        break;
      case 'segments':
        result = segmentLoudness(req.mono, req.sampleRate, req.segments);
        break;
    }
    const res: AnalysisResponse = { id: req.id, ok: true, result };
    self.postMessage(res);
  } catch (e) {
    const res: AnalysisResponse = { id: req.id, ok: false, error: (e as Error).message ?? String(e) };
    self.postMessage(res);
  }
};
