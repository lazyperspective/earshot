import type { TranscriptSegment } from '../types';

function pad(n: number, w = 2) { return String(n).padStart(w, '0'); }

export function timecode(seconds: number, sep: ',' | '.' = ','): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)}${sep}${pad(ms, 3)}`;
}

export function toSrt(segments: TranscriptSegment[]): string {
  return segments.map((s, i) => `${i + 1}\n${timecode(s.start)} --> ${timecode(s.end)}\n${s.text}\n`).join('\n');
}

export function toVtt(segments: TranscriptSegment[]): string {
  return `WEBVTT\n\n${segments.map((s) => `${timecode(s.start, '.')} --> ${timecode(s.end, '.')}\n${s.text}\n`).join('\n')}`;
}

export function toPlainText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join('\n');
}

export function chaptersToYouTube(chapters: { time: number; title: string }[]): string {
  const sorted = [...chapters].sort((a, b) => a.time - b.time);
  if (!sorted.length || sorted[0].time > 0.5) sorted.unshift({ time: 0, title: 'Intro' });
  return sorted.map((c) => {
    const t = Math.floor(c.time);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return `${h ? `${h}:${pad(m)}` : `${pad(m)}`}:${pad(s)} ${c.title}`;
  }).join('\n');
}

export function downloadText(fileName: string, text: string, mime = 'text/plain'): number {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return blob.size;
}
