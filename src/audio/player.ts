import type WaveSurfer from 'wavesurfer.js';

/** Thin controller around the live WaveSurfer instance so UI buttons and WebMCP tools share one path. */
class Player {
  ws: WaveSurfer | null = null;

  attach(ws: WaveSurfer) { this.ws = ws; }
  detach() { this.ws = null; }

  get duration(): number { return this.ws?.getDuration() ?? 0; }
  get currentTime(): number { return this.ws?.getCurrentTime() ?? 0; }
  get isPlaying(): boolean { return this.ws?.isPlaying() ?? false; }

  async play(): Promise<void> {
    try { await this.ws?.play(); } catch (e) { if ((e as Error)?.name !== 'AbortError') console.warn('play failed', e); }
  }
  pause(): void { this.ws?.pause(); }
  async playPause(): Promise<void> {
    if (!this.ws) return;
    if (this.ws.isPlaying()) this.ws.pause();
    else await this.play();
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
}

export const player = new Player();
