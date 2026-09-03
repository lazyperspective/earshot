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

## Phase 6 — Transcript

- **Transcript words are re-mapped to working time on every EDL change** (memoized), and words that fall inside an applied cut disappear from the tab and from every transcript tool. The bundled demo transcript is treated exactly like a Whisper result.
- **Playhead → word highlighting uses a derived Zustand selector** (binary search for the current word index), so the 60 Hz playhead updates only re-render when the active word changes; `Word` is memoized.
- **Drag-to-select across words** sets the amber timeline selection to the first word's start and the last word's end; a plain click seeks.

## Phase 7 — Polish

- **Replay a sample agent session** (Activity tab empty state, or `?demo=agent`) runs a scripted sequence through the *same* `invokeTool` path with a distinct "Replay" source badge. It is clearly labelled as scripted — it exists so judges without an agent browser can watch the loop, not to fake an agent.
- **First real WebMCP call flips the bottom panel to Activity** so the human sees the agent working without hunting for the tab.
- **OG image and hero screenshot are rendered with headless Chrome** (DevTools protocol script in the scratchpad) from the real app at `?demo=agent`, so the README shows the actual product.
- **Region labels are clipped** to their region box (`overflow: hidden`) so narrow filler-word cuts do not spill text over neighbours.
- **Keyboard**: Space, ←/→ (⇧ ×5), `[` `]`, Esc, L, J/K, A/R, P, ⌘Z/⇧⌘Z — listed in the ⌨ popover next to the zoom slider.
- **Console hygiene**: verified in a fresh tab with the demo + replay — only Vite/React info lines, no warnings or errors.

## Phase 8 — Shipping

- `vercel.json` gives `api/transcribe.ts` 120 s and 1 GB, and marks the demo assets immutable. Framework preset is Vite; `npm run build` runs `tsc -b` first so a type error fails the deploy.
- The project is linked to Vercel as `earshot` (production domain `https://earshot-beige.vercel.app`); `OPENAI_API_KEY` must be added in the Vercel project settings for transcription of non-demo files.
- **The transcription core lives inside `api/transcribe.ts`** (no `api/_lib` helper): Vercel's Node runtime loads functions as ESM and refused the extension-less relative import at runtime (`ERR_MODULE_NOT_FOUND`), found via `get_runtime_logs`. The Vite dev middleware imports the same named export.
- **Deployed** as project `earshot` (production domain `https://earshot-beige.vercel.app`, Deployment Protection left at Vercel's default so per-deployment URLs redirect to SSO while the production domain is public).

## Post-submission — Local Whisper on WebGPU

- **Engine choice is the human's**, persisted in `localStorage` and shown in the Transcript tab; every transcript tool follows it. OpenAI stays the default because it needs no download, but the local path is one click ("Download & transcribe").
- **transformers.js in a Web Worker** with `device: 'webgpu'` (fp32 encoder + q4 decoder, the combination the upstream WebGPU demo ships) and a WASM fallback (q8) when `navigator.gpu` is absent. The main thread only ever sees progress messages and results.
- **`_timestamped` model variants** (`onnx-community/whisper-*_timestamped`) are required: the plain exports lack the cross-attention outputs/alignment heads that `return_timestamps: 'word'` needs.
- **Own chunking at ≤ 28 s** (split at the quietest window) so each call fits Whisper's 30 s context and transformers.js never has to stitch internal chunks; word timestamps are offset and clamped to the audio length (DTW can overshoot the end).
- **Model files are cached by the browser Cache API** through transformers.js, so a second load is instant; the picker shows download size per device. `optimizeDeps.exclude` keeps Vite from pre-bundling the library, whose ONNX runtime assets resolve via `import.meta.url`.
- **Measured on an Apple-silicon Mac in Chrome:** Tiny · English downloads in ~8 s and transcribes the 80 s demo in ~6 s on WebGPU; fillers are kept, timings match the bundled transcript within ~0.1 s.

## Post-submission — Text-addressed editing, macros, review handshake

- **Word ids are source indices.** They never change when cuts are applied, so an agent can read `get_transcript(format:"indexed")` once and keep addressing words while it edits. Words inside applied cuts disappear from tool output but stay visible as strikethrough in the UI.
- **`cut_text` applies immediately** (the user asked for surgical cuts that "directly cut the audio"); `propose_cut_text` and every macro's `mode: "propose"` keep the approval loop for people who want it. Both paths share one function (`performTextCuts`) with the human select-and-Backspace UI.
- **Cut geometry**: absorb up to 0.4 s of the pause *before* the words (a hesitation belongs to the filler), keep the pause after so the sentence still breathes, leave a 30 ms guard to the neighbouring word, then snap each edge to the quietest 20 ms window within ±25 ms.
- **Candidates are heuristic and explainable**: fillers via the existing punctuation-aware detector, stutters (adjacent equal words < 1 s apart), false starts (repeated bigram), flubs by phrase list with a strong/weak split, retakes by Jaccard ≥ 0.6 between nearby sentences. `suggest_cuts` reports them with reasons and confidence and never edits.
- **Review handshake**: `request_review` flips the panel into Review mode (auto-preview, A/R, 1–4 reasons), `wait_for_decisions` subscribes to the store and resolves when the scoped proposals are settled, counting only decisions stamped after the review started. `get_review_feedback` aggregates rejections by kind and by word so the agent adapts.
- **Force-apply is gated**: `apply_proposals { force: true }` shows an Allow/Deny dialog and returns `denied` if the human refuses or does not answer in 60 s.
- **Preferences** (keep_fillers, max_pause_s, filler_confidence, style_notes) live in localStorage and are echoed by `get_status` so a new session's agent starts with the human's taste.

## Post-submission — Agent presence layer

- **Every tool call is visible motion.** `invokeTool` emits `tool-start` / `tool-end` and, from the result, "where the agent looked / what it touched" events on a tiny pub/sub bus (`src/lib/fx.ts`). No store churn: the animation layers subscribe directly.
- **Vocabulary**: a teal scanline sweeps the waveform while a read tool runs (amber for writes); found ranges flash where the agent looked (grey silence, amber fillers, teal matches, red clipping); cuts collapse with a red slice; an "AI · …" cursor flies to the last acted position; the status pill emits sonar rings, shows an equalizer and says *listening* / *editing*; a laser runs under the top bar while any call is active; HUD toasts narrate each call with its result and timing; the transcript sweeps on read and flashes words on hit/cut; new Activity rows and proposal cards slide in.
- **Minimum visible durations** (1 s sweep, 1.7 s toast) so 5 ms calls still register, and `prefers-reduced-motion` disables all of it.
