import type WaveSurfer from 'wavesurfer.js';

export interface ViewInfo { start: number; end: number; seconds_visible: number; px_per_sec: number; fit: boolean }
export interface ViewRequest { start?: number; secondsVisible?: number; factor?: number; around?: number; fit?: boolean }

/** Thin controller around the live WaveSurfer instance so UI buttons and WebMCP tools share one path. */
class Player {
  ws: WaveSurfer | null = null;
  /** When set, playback pauses once the playhead passes this time (working seconds). */
  stopAt: number | null = null;
  /** Installed by WaveformPanel: applies zoom/scroll requests. */
  viewHandler: ((req: ViewRequest) => void) | null = null;
  viewportWidth = 0;

  attach(ws: WaveSurfer) { this.ws = ws; }
  detach() { this.ws = null; this.viewHandler = null; }

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

  /** Current viewport in working seconds. */
  getView(): ViewInfo {
    const ws = this.ws;
    const d = this.duration;
    if (!ws || !d) return { start: 0, end: d, seconds_visible: d, px_per_sec: 0, fit: true };
    const pps = ws.options.minPxPerSec || 1;
    const width = this.viewportWidth || ws.getWrapper().parentElement?.clientWidth || 0;
    const start = Math.max(0, ws.getScroll() / pps);
    const visible = width / pps;
    const fit = visible >= d - 0.01;
    return { start: r3(fit ? 0 : start), end: r3(fit ? d : Math.min(d, start + visible)), seconds_visible: r3(Math.min(d, visible)), px_per_sec: r3(pps), fit };
  }
  /** Zoom so `secondsVisible` fill the view, starting at `start` (or centred on the playhead). */
  setView(start?: number, secondsVisible?: number): void { this.viewHandler?.({ start, secondsVisible }); }
  zoomTo(start: number, end: number): void {
    const span = Math.max(0.5, end - start);
    this.viewHandler?.({ start: Math.max(0, start - span * 0.1), secondsVisible: span * 1.2 });
  }
  zoomBy(factor: number, around?: number): void { this.viewHandler?.({ factor, around }); }
  fit(): void { this.viewHandler?.({ fit: true }); }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const player = new Player();
