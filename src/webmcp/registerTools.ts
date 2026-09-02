/**
 * WebMCP registration — follows the current (Sept 2026) spec:
 *  - document.modelContext (never navigator.modelContext)
 *  - registerTool() returns a Promise; lifetime is owned by the AbortSignal passed in options
 *  - no provideContext / clearContext / unregisterTool
 *  - top-level document only (no iframes), tools registered once audio is loaded; a single get_status before
 * The @mcp-b/webmcp-polyfill is initialised ONLY when document.modelContext is absent.
 */
import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill';
import type { useStore as StoreHook } from '../store/useStore';
import { getIdleToolDefs, getToolDefs, invokeTool, toolCounts, type ToolDef } from './tools';

type Store = typeof StoreHook;

interface RegisterFn {
  (tool: unknown, options?: { signal?: AbortSignal }): Promise<void>;
}

function hasNativeContext(): boolean {
  return typeof document.modelContext?.registerTool === 'function';
}

export interface ModelContextInfo {
  available: boolean;
  native: boolean;
  polyfill: boolean;
}

let cachedInfo: ModelContextInfo | null = null;

/** Feature-detect native WebMCP once (before any polyfill install); fall back to the polyfill so the app is testable in plain Chrome. */
export function ensureModelContext(): ModelContextInfo {
  if (cachedInfo) return cachedInfo;
  if (hasNativeContext()) return (cachedInfo = { available: true, native: true, polyfill: false });
  try {
    initializeWebMCPPolyfill();
  } catch (e) {
    console.warn('[webmcp] polyfill init failed', e);
  }
  const ok = hasNativeContext();
  return (cachedInfo = { available: ok, native: false, polyfill: ok });
}

function toDescriptor(def: ToolDef, defs: ToolDef[]) {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: {
      readOnlyHint: def.readOnly,
      destructiveHint: !def.readOnly && def.destructive,
      ...(def.untrusted ? { untrustedContentHint: true } : {}),
    },
    execute: async (input: unknown) => invokeTool(def.name, input, 'webmcp', defs),
  };
}

/**
 * Register the appropriate tool set for the current store state. Returns the AbortController that owns
 * the registrations — abort it on unmount or when the project is closed.
 */
export function registerAllTools(store: Store): AbortController {
  const controller = new AbortController();
  const ctx = document.modelContext;
  if (!ctx || typeof ctx.registerTool !== 'function') {
    store.getState().setWebMCP({ available: false, toolCount: 0, readCount: 0, writeCount: 0 });
    return controller;
  }
  const register = ctx.registerTool.bind(ctx) as unknown as RegisterFn;
  const loaded = !!store.getState().workingBuffer;
  const defs = loaded ? getToolDefs() : getIdleToolDefs();

  // Register in parallel: the polyfill (and throttled background tabs) settle each registration on a timer tick,
  // so sequential awaits could take seconds in a hidden tab. Tools are visible to getTools() immediately.
  void (async () => {
    const results = await Promise.allSettled(defs.map((def) => register(toDescriptor(def, defs), { signal: controller.signal })));
    let registered = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') registered++;
      else if (!controller.signal.aborted) console.warn(`[webmcp] failed to register ${defs[i].name}`, r.reason);
    });
    if (controller.signal.aborted) return;
    const counts = toolCounts(defs);
    store.getState().setWebMCP({ available: true, toolCount: registered, readCount: counts.read, writeCount: counts.total - counts.read });
    if (import.meta.env.DEV) console.info(`[webmcp] ${registered} tools registered (${loaded ? 'full' : 'idle'} set)`);
  })();

  controller.signal.addEventListener('abort', () => {
    const s = store.getState();
    if (s.webmcp.toolCount) s.setWebMCP({ toolCount: 0, readCount: 0, writeCount: 0 });
  }, { once: true });

  return controller;
}
