export function formatTime(seconds: number | null | undefined, opts: { ms?: boolean } = {}): string {
  if (seconds == null || !Number.isFinite(seconds)) return opts.ms ? '--:--.---' : '--:--';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return opts.ms ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return '-inf dB';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 2000) return 'just now';
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
