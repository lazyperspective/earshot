/**
 * Earshot domain types. Time is ALWAYS seconds (float) in public APIs.
 * Samples never leak past the audio/ layer.
 */

export type EditOp =
  | { id: string; type: 'cut'; start: number; end: number }
  | { id: string; type: 'gain'; start: number; end: number; gainDb: number }
  | { id: string; type: 'fade_in'; start: number; end: number }
  | { id: string; type: 'fade_out'; start: number; end: number }
  | { id: string; type: 'normalize'; targetDb: number; gainDb: number; mode: 'rms' | 'peak' }
  | { id: string; type: 'notch_filter'; start: number; end: number; frequencyHz: number; q: number }
  | { id: string; type: 'highpass'; start: number; end: number; frequencyHz: number };

export type EditOpType = EditOp['type'];

/** All op times in the EDL are on the SOURCE timeline (never mutated). */
export type EDL = EditOp[];

export type MarkerKind = 'cut' | 'gain' | 'fade' | 'filter' | 'comment';
export type MarkerStatus = 'pending' | 'approved' | 'rejected' | 'applied';
export type Author = 'agent' | 'human';

export interface MarkerEdit {
  gainDb?: number;
  direction?: 'in' | 'out';
  filterType?: 'notch' | 'highpass';
  frequencyHz?: number;
}

/** Markers are stored on the SOURCE timeline; the UI maps them to working time. */
export interface Marker {
  id: string;
  kind: MarkerKind;
  start: number;
  end: number;
  note: string;
  author: Author;
  status: MarkerStatus;
  createdAt: number;
  edit?: MarkerEdit;
  appliedOpId?: string;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: number;
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  language?: string;
  /** Which engine produced it: 'openai' | 'local' | 'bundled'. */
  engine?: string;
  model?: string;
}

export type TranscriptState =
  | { status: 'idle' }
  | { status: 'transcribing'; startedAt: number; progress: number; note?: string }
  | { status: 'ready'; transcript: Transcript; cached: boolean }
  | { status: 'error'; message: string };

export interface ActivityEntry {
  id: string;
  tool: string;
  args: unknown;
  result: unknown;
  summary: string;
  durationMs: number;
  timestamp: number;
  ok: boolean;
  source: 'webmcp' | 'console' | 'ui' | 'replay';
  access: 'read' | 'write';
}

export interface SilenceRegion {
  start: number;
  end: number;
  duration: number;
}

export interface LoudnessPoint {
  t: number;
  rms_db: number;
  peak_db: number;
}

export interface LoudnessProfile {
  window_s: number;
  points: LoudnessPoint[];
  integrated_db: number;
  peak_db: number;
  dynamic_range_db: number;
  unit: 'dBFS RMS';
}

export interface ClipRegion {
  start: number;
  end: number;
  samples: number;
}

export interface WebMCPStatus {
  available: boolean;
  native: boolean;
  polyfill: boolean;
  toolCount: number;
  readCount: number;
  writeCount: number;
  lastCallAt: number | null;
}

export interface Selection {
  start: number;
  end: number;
}

export type BottomTab = 'transcript' | 'activity' | 'console';

export type TranscriptionEngine = 'openai' | 'local';
export type LocalModelKey = 'tiny.en' | 'base.en' | 'small.en' | 'base';
export type LocalDevice = 'webgpu' | 'wasm';

export interface TranscriptionSettings {
  engine: TranscriptionEngine;
  model: LocalModelKey;
}

export interface LocalWhisperState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  note?: string;
  device: LocalDevice | null;
  modelId: string | null;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  destructive: boolean;
  /** Output may contain content from the audio (transcript text) that the agent should treat as untrusted. */
  untrusted?: boolean;
  example: Record<string, unknown>;
}
