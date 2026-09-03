import { useStore } from '../store/useStore';
import { uid } from './format';

const resolvers = new Map<string, (allowed: boolean) => void>();

/** Ask the human to allow an agent action. Resolves false on deny or timeout. */
export function requestConfirm(title: string, detail: string, timeoutMs = 60_000): Promise<boolean> {
  const id = uid('confirm');
  return new Promise<boolean>((resolve) => {
    const done = (allowed: boolean) => {
      if (!resolvers.has(id)) return;
      resolvers.delete(id);
      if (useStore.getState().confirm?.id === id) useStore.getState().setConfirm(null);
      resolve(allowed);
    };
    resolvers.set(id, done);
    useStore.getState().setConfirm({ id, title, detail, createdAt: Date.now() });
    setTimeout(() => done(false), timeoutMs);
  });
}

export function resolveConfirm(id: string, allowed: boolean): void {
  resolvers.get(id)?.(allowed);
}
