import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { ensureModelContext, registerAllTools } from '../webmcp/registerTools';

/** Installs the polyfill if needed and (re)registers tools whenever audio is loaded or closed. */
export function useWebMCP() {
  const hasAudio = useStore((s) => !!s.workingBuffer);

  useEffect(() => {
    const info = ensureModelContext();
    useStore.getState().setWebMCP(info);
  }, []);

  useEffect(() => {
    const controller = registerAllTools(useStore);
    return () => controller.abort();
  }, [hasAudio]);
}
