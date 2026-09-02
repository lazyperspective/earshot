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

## Phase 3 — Analysis, tool catalog, console

- **Analysis is pure + worker-wrapped.** `src/audio/analysis.ts` has no DOM/Web Audio dependencies so it runs in Vitest and in `analysis.worker.ts`. `analyze.ts` copies channel data before transferring it so the AudioBuffer is never detached, and falls back to inline execution if Workers are unavailable.
- **Loudness is labelled dBFS RMS**, never LUFS (no K-weighting). `dynamic_range_db` = p95 − p10 of 1s-window RMS over windows above −60 dBFS.
- **Normalize is a gain op** with a −0.1 dBFS peak ceiling (`limited_by_peak` tells the agent when the target could not be reached without clipping).
- **One tool catalog, two consumers.** `src/webmcp/tools.ts` defines every tool once (name, LLM-facing description, JSON Schema, annotations, `execute`, `summarize`). The Tool Console and the WebMCP registration both call `invokeTool()`, which validates required args, catches errors into `{ error }`, times the call and writes the Activity feed. UI buttons and tools share the same store actions.
- **Filler heuristics.** "um/uh"-type disfluencies are always high confidence. "like", "so", "you know" are only flagged when set off by punctuation (how Whisper renders spoken fillers), with a `context` string so the agent can judge.
- **Transcript tools wait ≤ 25 s** for a transcript, then return `{ status: "transcribing", progress }` so an agent never hangs on a long file.
- **Transcription uploads 16 kHz mono WAV chunks ≤ 120 s** split at the quietest window near the boundary; each chunk stays under Vercel's 4.5 MB body limit and results are merged with offsets. Whisper is prompted with filler words so it keeps "um"/"uh".
- **Bundled demo transcript.** No local Whisper was available, so the demo clip is synthesized phrase-by-phrase and `public/demo-transcript.json` (hash-keyed) carries phrase-accurate word timings. It is used only when the loaded file's SHA-256 matches; a "Re-transcribe" action bypasses every cache.
- **Local dev API.** A tiny Vite middleware serves `/api/transcribe` from the same `api/_lib/transcribe-core.ts` the Vercel function uses, reading `OPENAI_API_KEY` from `.env`.

## Phase 4 — WebMCP

- **`document.modelContext` only**, feature-detected once at startup *before* the polyfill is installed (StrictMode's double effect run would otherwise see the polyfill and report "native"). `@mcp-b/webmcp-polyfill` v5 is initialised only when the native context is absent.
- **Tools are registered in parallel** (`Promise.allSettled`). The polyfill settles each `registerTool()` on a timer tick, and background tabs throttle timers to ~1/s, so sequential awaits could take 20+ s in a hidden tab. Parallel registration makes every tool visible to `getTools()` immediately.
- **Lifetime = AbortController.** One controller per registration set; it is aborted on unmount and whenever the loaded/unloaded state flips (idle set: just `get_status`; full set: 23 tools).
- **Annotations:** `readOnlyHint` on all 10 read tools; `destructiveHint: true` on tools that mutate audio (apply_proposals, normalize, undo, redo); `untrustedContentHint: true` on the four transcript-derived tools because spoken audio can contain prompt-injection text. Native browsers ignore hints they do not know.
- **Status pill:** green "N tools live · R read · W write" only with native WebMCP; grey "WebMCP not detected — polyfill active · N tools" otherwise, so a viewer can tell whether an agent browser is actually connected.
- **Debug handle:** `window.earshot = { store, invokeTool, tools }` is exposed for console testing; it is not a security surface (same-origin page code already has everything).

## Phase 5 — Proposals

- **Preview renders a temporary EDL** (current ops + the proposal's op) through the same renderer, then plays 1 s before → through → 1 s after with a plain `AudioBufferSourceNode`; the last four renders are cached. Nothing is written to the EDL.
- **Cards are ordered pending → approved → rejected → applied**, then by time, so the human's queue is always at the top. Focus (click, `j`/`k`) syncs with the waveform region; `A`/`R`/`P` approve/reject/preview the focused card.
- **Human review is logged** to the Activity feed as "You" entries (approve/reject/restore/apply), so the video shows the full human-agent loop in one place.
