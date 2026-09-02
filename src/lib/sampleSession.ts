/**
 * "Replay a sample agent session": runs the same tools an agent would, through the same invokeTool path,
 * with short pauses so the Activity feed and timeline animate. No model is involved — it is a scripted
 * demonstration of the loop for people without an agent browser.
 */
import { useStore } from '../store/useStore';
import { invokeTool } from '../webmcp/tools';

let running = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function isSampleRunning() { return running; }

export async function runSampleSession(): Promise<void> {
  if (running || !useStore.getState().workingBuffer) return;
  running = true;
  useStore.getState().setBottomTab('activity');
  const call = async (name: string, args: Any = {}) => { const r = (await invokeTool(name, args, 'replay')) as Any; await sleep(350); return r; };
  try {
    const status = await call('get_status');
    const silences = await call('detect_silences', { threshold_db: -40, min_duration_s: 1.0 });
    const fillers = await call('find_filler_words');
    await call('get_loudness_profile', { window_s: 5 });
    const speakers = await call('compare_speakers');

    for (const s of (silences.silences ?? []).slice(0, 3)) {
      await call('propose_cut', { start: s.start + 0.3, end: s.end - 0.3, reason: `${s.duration.toFixed(1)} s of dead air — tighten to ~0.6 s` });
    }
    for (const f of (fillers.fillers ?? []).filter((x: Any) => x.confidence === 'high').slice(0, 4)) {
      await call('propose_cut', { start: f.start - 0.03, end: f.end + 0.03, reason: `Filler word “${String(f.word).replace(/[,.]$/, '')}”` });
    }
    const quiet = (speakers.segments ?? []).filter((x: Any) => x.quiet);
    if (quiet.length) {
      const gain = Math.max(1, Math.min(12, Math.round(speakers.integrated_db - Math.min(...quiet.map((q: Any) => q.mean_rms_db)))));
      await call('propose_gain', { start: quiet[0].start, end: quiet[quiet.length - 1].end, gain_db: gain, reason: `Guest sits ~${gain} dB below the host — level the quiet section` });
    }
    const dur = Number(status.duration_s ?? 0);
    if (dur > 3) await call('propose_fade', { start: Math.max(0, dur - 1.5), end: dur, direction: 'out', reason: 'Clean ending' });
    await call('add_marker', { time: Math.min(dur, 30.5), note: 'Host loses their place here — consider a retake or a hard cut' });
    await call('list_markers');
  } finally {
    running = false;
  }
}
