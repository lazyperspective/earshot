import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { WaveformPanel } from './components/WaveformPanel';
import { Transport } from './components/Transport';
import { ProposalsPanel } from './components/ProposalsPanel';
import { BottomTabs } from './components/BottomTabs';
import { EmptyState } from './components/EmptyState';
import { useStore } from './store/useStore';
import { useKeyboard } from './hooks/useKeyboard';
import { useWebMCP } from './hooks/useWebMCP';
import { runSampleSession } from './lib/sampleSession';
import { ConfirmModal } from './components/ConfirmModal';

let demoParamHandled = false;

export default function App() {
  const hasAudio = useStore((s) => !!s.workingBuffer);
  const isLoading = useStore((s) => s.isLoading);
  const loadError = useStore((s) => s.loadError);
  const loadFile = useStore((s) => s.loadFile);
  const loadDemo = useStore((s) => s.loadDemo);
  useKeyboard();
  useWebMCP();

  // ?demo=1 loads the clip; ?demo=agent also replays the sample agent session (screenshots, quick judging).
  useEffect(() => {
    if (demoParamHandled) return;
    demoParamHandled = true;
    const mode = new URLSearchParams(window.location.search).get('demo');
    if (!mode) return;
    void loadDemo().then(() => { if (mode === 'agent') return runSampleSession(); });
  }, [loadDemo]);

  return (
    <div className="h-full flex flex-col bg-bg text-fg">
      <TopBar />
      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 flex flex-col">
          {hasAudio ? (
            <>
              <WaveformPanel />
              <Transport />
              <BottomTabs />
            </>
          ) : (
            <EmptyState onFile={(f) => void loadFile(f)} onDemo={() => void loadDemo()} loading={isLoading} error={loadError} />
          )}
        </main>
        <ProposalsPanel />
      </div>
      <ConfirmModal />
      <div className="hidden max-[1023px]:flex fixed inset-0 z-50 items-center justify-center bg-bg/95 p-8 text-center">
        <div className="max-w-sm">
          <div className="text-[15px] font-semibold">Earshot is best on desktop</div>
          <div className="mt-2 text-[13px] text-fg-3">Open this on a screen at least 1024px wide to edit audio with your agent.</div>
        </div>
      </div>
    </div>
  );
}
