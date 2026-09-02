# Decisions

Running log of product and engineering decisions made while building Earshot. Newest at the bottom.

## Phase 1 — Scaffold

- **Tailwind v4 (CSS-first config)** instead of v3 `tailwind.config.js`. Design tokens live in `src/index.css` under `@theme`, which keeps colors/fonts/animations in one place and works with the `@tailwindcss/vite` plugin with zero PostCSS setup.
- **React 18.3** pinned (stack is fixed). Vite 7, TypeScript 5.9 (not the TS 7 native preview) for toolchain stability.
- **Fonts via Google Fonts** (`Inter`, `JetBrains Mono`) with system fallbacks. Vercel target is online-only, so no self-hosting.
- **Layout**: right-hand Proposals panel spans full height (Descript-style), bottom tabs sit under the waveform + transport. 1280px+ is the design target; below 1024px a "best on desktop" overlay is shown.
- **Design tokens**: `#0B0D10` background, teal `#2EE6C5` = agent, amber `#F5B942` = human selection. Region parts in wavesurfer are styled through `::part()` selectors so the proposal/selection visuals are pure CSS.
- **`lucide-react`** for icons (tree-shakable, consistent stroke weight).
