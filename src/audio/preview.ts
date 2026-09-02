/**
 * Proposal preview: renders the current EDL + the proposal's op into a temporary buffer and plays
 * 1 s before → through → 1 s after the affected range with plain Web Audio. Never touches the EDL.
 */
import { getAudioContext } from './decode';
import { renderEdl } from './render';
import { cutsFromEdl, sourceToWorking } from './edl';
import { player } from './player';
import { markerToOp, useStore } from '../store/useStore';
import type { Marker } from '../types';

let active: { src: AudioBufferSourceNode; id: string } | null = null;
const cache = new Map<string, AudioBuffer>();

export function stopPreview(): void {
  if (active) {
    try { active.src.stop(); } catch { /* already stopped */ }
    active = null;
  }
  if (useStore.getState().previewingId) useStore.getState().setPreviewing(null);
}

export async function previewMarker(marker: Marker, padS = 1): Promise<void> {
  const s = useStore.getState();
  if (!s.sourceBuffer) return;
  stopPreview();
  player.pause();
  s.setPreviewing(marker.id);

  const op = marker.status === 'applied' ? null : markerToOp(marker);
  const tempEdl = op ? [...s.edl, op] : s.edl;
  const key = `${marker.id}:${s.edl.length}:${JSON.stringify(marker.edit ?? null)}:${marker.start}:${marker.end}`;
  let rendered = cache.get(key);
  if (!rendered) {
    rendered = await renderEdl(s.sourceBuffer, tempEdl);
    cache.set(key, rendered);
    if (cache.size > 4) cache.delete(cache.keys().next().value as string);
  }
  if (useStore.getState().previewingId !== marker.id) return; // cancelled while rendering

  const cuts = cutsFromEdl(tempEdl);
  const a = sourceToWorking(marker.start, cuts);
  const b = sourceToWorking(marker.end, cuts);
  const start = Math.max(0, a - padS);
  const end = Math.min(rendered.duration, b + padS);

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = rendered;
  src.connect(ctx.destination);
  src.onended = () => {
    if (active?.src === src) {
      active = null;
      if (useStore.getState().previewingId === marker.id) useStore.getState().setPreviewing(null);
    }
  };
  src.start(0, start, Math.max(0.05, end - start));
  active = { src, id: marker.id };
  player.seek(Math.max(0, sourceToWorking(marker.start, cutsFromEdl(s.edl)) - padS));
}
