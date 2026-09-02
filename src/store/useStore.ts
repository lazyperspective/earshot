import { create } from 'zustand';
import type {
  ActivityEntry, Author, BottomTab, EDL, EditOp, Marker, MarkerEdit, MarkerKind, MarkerStatus,
  Selection, TranscriptState, WebMCPStatus,
} from '../types';
import { decodeAudio } from '../audio/decode';
import { renderEdl } from '../audio/render';
import { cutsFromEdl, sourceRangeToWorking, sourceToWorking, workingToSource, type Range } from '../audio/edl';
import { audioBufferToWav } from '../audio/wav';
import { player } from '../audio/player';
import { uid } from '../lib/format';

interface Snapshot { edl: EDL; markers: Marker[] }

export interface NewMarkerInput {
  kind: MarkerKind;
  /** WORKING-timeline seconds (what the user sees). Converted to source time internally. */
  start: number;
  end: number;
  note: string;
  author: Author;
  edit?: MarkerEdit;
  status?: MarkerStatus;
}

export interface ApplyResult {
  applied: Marker[];
  skipped: { id: string; reason: string }[];
  newDuration: number;
}

export interface EarshotState {
  fileName: string | null;
  fileHash: string | null;
  sourceBlob: Blob | null;
  sourceBuffer: AudioBuffer | null;
  workingBuffer: AudioBuffer | null;
  isLoading: boolean;
  loadError: string | null;
  isRendering: boolean;
  renderVersion: number;

  edl: EDL;
  history: Snapshot[];
  future: Snapshot[];
  markers: Marker[];

  transcript: TranscriptState;

  selection: Selection | null;
  playhead: number;
  isPlaying: boolean;
  loopSelection: boolean;
  zoom: number;
  focusedMarkerId: string | null;
  previewingId: string | null;
  bottomTab: BottomTab;
  exportProgress: number | null;
  lastProposalAt: number | null;

  activityLog: ActivityEntry[];
  webmcp: WebMCPStatus;

  // file
  loadFile: (file: File) => Promise<void>;
  loadDemo: () => Promise<void>;
  closeProject: () => void;

  // edit model
  commitEdl: (edl: EDL, markers?: Marker[]) => Promise<void>;
  appendOps: (ops: EditOp[]) => Promise<void>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;

  // markers (proposals)
  addMarker: (input: NewMarkerInput) => Marker;
  setMarkerStatus: (id: string, status: MarkerStatus) => Marker | null;
  removeMarker: (id: string) => void;
  clearProposals: () => number;
  applyMarkers: (ids?: string[], force?: boolean) => Promise<ApplyResult>;

  // transport / ui
  setSelection: (sel: Selection | null) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (b: boolean) => void;
  toggleLoop: () => void;
  setZoom: (zoom: number) => void;
  setBottomTab: (tab: BottomTab) => void;
  setFocusedMarker: (id: string | null) => void;
  setPreviewing: (id: string | null) => void;
  setTranscript: (t: TranscriptState) => void;

  // export / agent
  exportWav: () => Promise<{ fileName: string; bytes: number; duration: number }>;
  logActivity: (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => void;
  setWebMCP: (patch: Partial<WebMCPStatus>) => void;
}

export const getCuts = (s: Pick<EarshotState, 'edl'>): Range[] => cutsFromEdl(s.edl);

/** Marker range on the working timeline, or null when it lies entirely inside an applied cut. */
export function markerWorkingRange(m: Marker, cuts: Range[]): Range | null {
  if (m.kind === 'comment' || m.end - m.start <= 1e-6) {
    const t = sourceToWorking(m.start, cuts);
    return { start: t, end: t };
  }
  return sourceRangeToWorking({ start: m.start, end: m.end }, cuts);
}

export function markerToOp(m: Marker): EditOp | null {
  const id = uid('op');
  switch (m.kind) {
    case 'cut':
      return { id, type: 'cut', start: m.start, end: m.end };
    case 'gain':
      return { id, type: 'gain', start: m.start, end: m.end, gainDb: m.edit?.gainDb ?? 0 };
    case 'fade':
      return m.edit?.direction === 'out'
        ? { id, type: 'fade_out', start: m.start, end: m.end }
        : { id, type: 'fade_in', start: m.start, end: m.end };
    case 'filter':
      return m.edit?.filterType === 'highpass'
        ? { id, type: 'highpass', start: m.start, end: m.end, frequencyHz: m.edit?.frequencyHz ?? 80 }
        : { id, type: 'notch_filter', start: m.start, end: m.end, frequencyHz: m.edit?.frequencyHz ?? 60, q: 30 };
    case 'comment':
      return null;
  }
}

const initialProject = {
  fileName: null,
  fileHash: null,
  sourceBlob: null,
  sourceBuffer: null,
  workingBuffer: null,
  isLoading: false,
  loadError: null,
  isRendering: false,
  edl: [] as EDL,
  history: [] as Snapshot[],
  future: [] as Snapshot[],
  markers: [] as Marker[],
  transcript: { status: 'idle' } as TranscriptState,
  selection: null,
  playhead: 0,
  isPlaying: false,
  loopSelection: false,
  zoom: 1,
  focusedMarkerId: null,
  previewingId: null,
  exportProgress: null,
  lastProposalAt: null,
};

let renderChain: Promise<void> = Promise.resolve();

export const useStore = create<EarshotState>()((set, get) => ({
  ...initialProject,
  renderVersion: 0,
  bottomTab: 'transcript',
  activityLog: [],
  webmcp: { available: false, native: false, polyfill: false, toolCount: 0, readCount: 0, writeCount: 0, lastCallAt: null },

  // ---------- file ----------
  loadFile: async (file) => {
    set({ isLoading: true, loadError: null });
    try {
      const { buffer, hash } = await decodeAudio(file);
      set({
        ...initialProject,
        fileName: file.name,
        fileHash: hash,
        sourceBlob: file,
        sourceBuffer: buffer,
        workingBuffer: buffer,
        isLoading: false,
        renderVersion: get().renderVersion + 1,
        activityLog: get().activityLog,
      });
    } catch (e) {
      set({ isLoading: false, loadError: `Could not decode "${file.name}": ${(e as Error).message ?? e}` });
    }
  },

  loadDemo: async () => {
    set({ isLoading: true, loadError: null });
    try {
      const res = await fetch('/demo.mp3');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await get().loadFile(new File([blob], 'signal-and-noise-ep12.mp3', { type: 'audio/mpeg' }));
    } catch (e) {
      set({ isLoading: false, loadError: `Could not load demo clip: ${(e as Error).message ?? e}` });
    }
  },

  closeProject: () => {
    player.pause();
    set({ ...initialProject, renderVersion: get().renderVersion + 1 });
  },

  // ---------- edit model ----------
  commitEdl: async (edl, markers) => {
    const s = get();
    if (!s.sourceBuffer) return;
    set({
      history: [...s.history, { edl: s.edl, markers: s.markers }].slice(-100),
      future: [],
      edl,
      markers: markers ?? s.markers,
    });
    await rerender();
  },

  appendOps: async (ops) => {
    await get().commitEdl([...get().edl, ...ops]);
  },

  undo: async () => {
    const s = get();
    const prev = s.history[s.history.length - 1];
    if (!prev) return false;
    set({
      history: s.history.slice(0, -1),
      future: [{ edl: s.edl, markers: s.markers }, ...s.future],
      edl: prev.edl,
      markers: prev.markers,
    });
    await rerender();
    return true;
  },

  redo: async () => {
    const s = get();
    const next = s.future[0];
    if (!next) return false;
    set({
      future: s.future.slice(1),
      history: [...s.history, { edl: s.edl, markers: s.markers }],
      edl: next.edl,
      markers: next.markers,
    });
    await rerender();
    return true;
  },

  // ---------- markers ----------
  addMarker: (input) => {
    const cuts = getCuts(get());
    const start = workingToSource(Math.min(input.start, input.end), cuts);
    const end = input.kind === 'comment' ? start : workingToSource(Math.max(input.start, input.end), cuts);
    const marker: Marker = {
      id: uid('m'),
      kind: input.kind,
      start,
      end,
      note: input.note,
      author: input.author,
      status: input.status ?? (input.kind === 'comment' ? 'applied' : 'pending'),
      createdAt: Date.now(),
      edit: input.edit,
    };
    set((s) => ({ markers: [...s.markers, marker], lastProposalAt: input.author === 'agent' ? Date.now() : s.lastProposalAt }));
    return marker;
  },

  setMarkerStatus: (id, status) => {
    let out: Marker | null = null;
    set((s) => ({
      markers: s.markers.map((m) => {
        if (m.id !== id || m.status === 'applied') return m;
        out = { ...m, status };
        return out;
      }),
    }));
    return out;
  },

  removeMarker: (id) => set((s) => ({ markers: s.markers.filter((m) => m.id !== id), focusedMarkerId: s.focusedMarkerId === id ? null : s.focusedMarkerId })),

  clearProposals: () => {
    const before = get().markers;
    const keep = before.filter((m) => !(m.author === 'agent' && m.status !== 'applied'));
    set({ markers: keep, focusedMarkerId: null });
    return before.length - keep.length;
  },

  applyMarkers: async (ids, force = false) => {
    const s = get();
    const targets = ids
      ? s.markers.filter((m) => ids.includes(m.id))
      : s.markers.filter((m) => m.kind !== 'comment' && (m.status === 'approved' || (force && m.status === 'pending')));
    const skipped: ApplyResult['skipped'] = [];
    if (ids) for (const id of ids) if (!s.markers.some((m) => m.id === id)) skipped.push({ id, reason: 'not found' });
    const applied: Marker[] = [];
    const ops: EditOp[] = [];
    const updated = new Map<string, Marker>();
    for (const m of targets) {
      if (m.status === 'applied') { skipped.push({ id: m.id, reason: 'already applied' }); continue; }
      if (m.status === 'rejected') { skipped.push({ id: m.id, reason: 'rejected by human' }); continue; }
      if (m.status === 'pending' && !force) { skipped.push({ id: m.id, reason: 'pending — not approved by human (pass force: true to override)' }); continue; }
      const op = markerToOp(m);
      if (!op) { skipped.push({ id: m.id, reason: 'comment markers have no edit' }); continue; }
      ops.push(op);
      const done: Marker = { ...m, status: 'applied', appliedOpId: op.id };
      updated.set(m.id, done);
      applied.push(done);
    }
    if (ops.length) {
      await get().commitEdl([...s.edl, ...ops], s.markers.map((m) => updated.get(m.id) ?? m));
    }
    return { applied, skipped, newDuration: get().workingBuffer?.duration ?? 0 };
  },

  // ---------- transport / ui ----------
  setSelection: (sel) => {
    if (!sel) { set({ selection: null }); return; }
    const d = get().workingBuffer?.duration ?? Infinity;
    const start = Math.max(0, Math.min(sel.start, sel.end, d));
    const end = Math.min(d, Math.max(sel.start, sel.end, 0));
    set({ selection: end - start > 1e-4 ? { start, end } : null });
  },
  setPlayhead: (playhead) => set({ playhead }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  toggleLoop: () => set((s) => ({ loopSelection: !s.loopSelection })),
  setZoom: (zoom) => set({ zoom: Math.max(1, Math.min(40, zoom)) }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setFocusedMarker: (focusedMarkerId) => set({ focusedMarkerId }),
  setPreviewing: (previewingId) => set({ previewingId }),
  setTranscript: (transcript) => set({ transcript }),

  // ---------- export / agent ----------
  exportWav: async () => {
    const s = get();
    if (!s.workingBuffer) throw new Error('No audio loaded');
    set({ exportProgress: 0.1 });
    await tick();
    const blob = audioBufferToWav(s.workingBuffer);
    set({ exportProgress: 0.9 });
    await tick();
    const base = (s.fileName ?? 'earshot').replace(/\.[^.]+$/, '');
    const fileName = `${base}-earshot.wav`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    set({ exportProgress: 1 });
    setTimeout(() => set({ exportProgress: null }), 1200);
    return { fileName, bytes: blob.size, duration: s.workingBuffer.duration };
  },

  logActivity: (entry) => set((s) => ({
    activityLog: [{ ...entry, id: uid('act'), timestamp: Date.now() }, ...s.activityLog].slice(0, 300),
    webmcp: { ...s.webmcp, lastCallAt: Date.now() },
  })),

  setWebMCP: (patch) => set((s) => ({ webmcp: { ...s.webmcp, ...patch } })),
}));

function tick() { return new Promise((r) => setTimeout(r, 0)); }

/** Serialize renders so rapid undo/redo never interleave. */
function rerender(): Promise<void> {
  const run = async () => {
    const s = useStore.getState();
    if (!s.sourceBuffer) return;
    useStore.setState({ isRendering: true });
    try {
      const working = await renderEdl(s.sourceBuffer, s.edl);
      const cur = useStore.getState();
      const d = working.duration;
      const sel = cur.selection && cur.selection.end <= d ? cur.selection : null;
      useStore.setState({
        workingBuffer: working,
        renderVersion: cur.renderVersion + 1,
        isRendering: false,
        selection: sel,
        playhead: Math.min(cur.playhead, d),
      });
    } catch (e) {
      console.error('render failed', e);
      useStore.setState({ isRendering: false });
    }
  };
  renderChain = renderChain.then(run, run);
  return renderChain;
}
