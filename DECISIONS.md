# Decisions

Running log of product and engineering decisions made while building Earshot. Newest at the bottom.

## Phase 1 — Scaffold

- **Tailwind v4 (CSS-first config)** instead of v3 `tailwind.config.js`. Design tokens live in `src/index.css` under `@theme`, which keeps colors/fonts/animations in one place and works with the `@tailwindcss/vite` plugin with zero PostCSS setup.
- **React 18.3** pinned (stack is fixed). Vite 7, TypeScript 5.9 (not the TS 7 native preview) for toolchain stability.
- **Fonts via Google Fonts** (`Inter`, `JetBrains Mono`) with system fallbacks. Vercel target is online-only, so no self-hosting.
- **Layout**: right-hand Proposals panel spans full height (Descript-style), bottom tabs sit under the waveform + transport. 1280px+ is the design target; below 1024px a "best on desktop" overlay is shown.
- **Design tokens**: `#0B0D10` background, teal `#2EE6C5` = agent, amber `#F5B942` = human selection. Region parts in wavesurfer are styled through `::part()` selectors so the proposal/selection visuals are pure CSS.
- **`lucide-react`** for icons (tree-shakable, consistent stroke weight).

## Phase 2 — Audio engine

- **Source-time canonical model.** Every EDL op and every marker stores times on the *source* timeline. The UI, transport, and all WebMCP tools speak *working* time (post-cut, what you hear). `src/audio/edl.ts` has the exact bijection (`sourceToWorking` / `workingToSource`). Markers that fall entirely inside an applied cut simply disappear from the timeline but stay in the list.
- **Two-stage render.** Gain/fade/normalize/filter ops render through `OfflineAudioContext` on the source timeline (10ms automation crossfades around every region; filters use a dry/wet pair so the effect is region-limited). Cuts are then removed by pure sample splicing with a 5ms fade-out/fade-in at each splice. Fade-in/out instead of an overlapping crossfade keeps the working length *exactly* the sum of kept segments, so the time mapping stays exact and unit-testable.
- **Fades use Audacity semantics**: `fade_in` ramps 0→1 across the region and leaves audio outside it untouched.
- **Playback = wavesurfer MediaElement over a WAV blob** of the working buffer, with raw channel data passed as pre-computed peaks so nothing is re-decoded. Simple and robust; memory-heavy for very long files (>20 min) — acceptable for the podcast-clip use case, a WebAudio backend is the obvious upgrade.
- **Export re-uses the working buffer** (it *is* the OfflineAudioContext render of the EDL) and encodes 16-bit PCM WAV on the main thread. Progress is shown in the Export button.
- **History snapshots include markers** (not just the EDL) so undoing an "apply" also returns proposals to *approved*.
- **Region styling is inline.** wavesurfer renders regions inside a shadow root and only exposes `part="region <id>"`, so proposal/selection styling and the mount animation (Web Animations API) are applied directly to `region.element`.
- **Demo clip** is generated locally with macOS `say` (two voices, deliberate "um"/"uh"/"like", a 2.8s dead-air pause, and a guest at −11 dB) and encoded to MP3 with ffmpeg. 80s, mono, 1.1 MB.
