import { create } from 'zustand';
import type {
  ActivityEntry,
  BottomTab,
  EDL,
  Marker,
  Selection,
  TranscriptState,
  WebMCPStatus,
} from '../types';

export interface EarshotState {
  // --- file / audio ---
  fileName: string | null;
  fileHash: string | null;
  sourceBuffer: AudioBuffer | null;
  workingBuffer: AudioBuffer | null;
  isLoading: boolean;
  loadError: string | null;

  // --- edit model ---
  edl: EDL;
  history: EDL[];
  future: EDL[];
  markers: Marker[];

  // --- transcript ---
  transcript: TranscriptState;

  // --- transport / UI ---
  selection: Selection | null;
  playhead: number;
  isPlaying: boolean;
  loopSelection: boolean;
  zoom: number;
  focusedMarkerId: string | null;
  bottomTab: BottomTab;
  exportProgress: number | null;

  // --- agent ---
  activityLog: ActivityEntry[];
  webmcp: WebMCPStatus;

  // --- UI actions (phase 1) ---
  setBottomTab: (tab: BottomTab) => void;
  setZoom: (zoom: number) => void;
  setFocusedMarker: (id: string | null) => void;
  setWebMCP: (patch: Partial<WebMCPStatus>) => void;
}

export const useStore = create<EarshotState>()((set) => ({
  fileName: null,
  fileHash: null,
  sourceBuffer: null,
  workingBuffer: null,
  isLoading: false,
  loadError: null,

  edl: [],
  history: [],
  future: [],
  markers: [],

  transcript: { status: 'idle' },

  selection: null,
  playhead: 0,
  isPlaying: false,
  loopSelection: false,
  zoom: 1,
  focusedMarkerId: null,
  bottomTab: 'transcript',
  exportProgress: null,

  activityLog: [],
  webmcp: {
    available: false,
    native: false,
    polyfill: false,
    toolCount: 0,
    readCount: 0,
    writeCount: 0,
    lastCallAt: null,
  },

  setBottomTab: (bottomTab) => set({ bottomTab }),
  setZoom: (zoom) => set({ zoom }),
  setFocusedMarker: (focusedMarkerId) => set({ focusedMarkerId }),
  setWebMCP: (patch) => set((s) => ({ webmcp: { ...s.webmcp, ...patch } })),
}));
