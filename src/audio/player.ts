import type WaveSurfer from 'wavesurfer.js';

/** Thin controller around the live WaveSurfer instance so UI buttons and WebMCP tools share one path. */
class Player {
  ws: WaveSurfer | null = null;
  /** When set, playback pauses once the playhead passes this time (working seconds). */
  stopAt: number | null = null;
  /** Set by WaveformPanel: (start, end) => zoom the view so the range fills ~80% of the width. */
  zoomToRange: ((start: number, end: number) => void) | null = null;

  attach(ws: WaveSurfer) { this.ws = ws; }
  detach() { this.ws = null; this.zoomToRange = null; }

  get duration(): number { return this.ws?.getDuration() ?? 0; }
  get currentTime(): number { return this.ws?.getCurrentTime() ?? 0; }
  get isPlaying(): boolean { return this.ws?.isPlaying() ?? false; }

  async play(): Promise<void> {
    try { await this.ws?.play(); } catch (e) { if ((e as Error)?.name !== 'AbortError') console.warn('play failed', e); }
  }
  pause(): void { this.stopAt = null; this.ws?.pause(); }
  async playPause(): Promise<void> {
    if (!this.ws) return;
    if (this.ws.isPlaying()) this.pause();
    else await this.play();
  }
  /** Play a working-time range and stop at its end. */
  async playRange(start: number, end?: number): Promise<void> {
    this.seek(start);
    this.stopAt = end != null && end > start ? Math.min(end, this.duration) : null;
    await this.play();
  }
  seek(t: number): number {
    if (!this.ws) return 0;
    const clamped = Math.max(0, Math.min(this.duration, t));
    this.ws.setTime(clamped);
    return clamped;
  }
  skip(dt: number): number { return this.seek(this.currentTime + dt); }
  scrollTo(t: number): void {
    try { this.ws?.setScrollTime(Math.max(0, t)); } catch { /* not ready */ }
  }
  zoomTo(start: number, end: number): void {
    this.zoomToRange?.(start, end);
  }
}

export const player = new Player();
