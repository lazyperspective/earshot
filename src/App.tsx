import { TopBar } from './components/TopBar';
import { WaveformPanel } from './components/WaveformPanel';
import { Transport } from './components/Transport';
import { ProposalsPanel } from './components/ProposalsPanel';
import { BottomTabs } from './components/BottomTabs';
import { EmptyState } from './components/EmptyState';
import { useStore } from './store/useStore';

export default function App() {
  const hasAudio = useStore((s) => !!s.workingBuffer);
  const isLoading = useStore((s) => s.isLoading);
  const loadError = useStore((s) => s.loadError);

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
            <EmptyState onFile={() => {}} onDemo={() => {}} loading={isLoading} error={loadError} />
          )}
        </main>
        <ProposalsPanel />
      </div>
      <div className="hidden max-[1023px]:flex fixed inset-0 z-50 items-center justify-center bg-bg/95 p-8 text-center">
        <div className="max-w-sm">
          <div className="text-[15px] font-semibold">Earshot is best on desktop</div>
          <div className="mt-2 text-[13px] text-fg-3">Open this on a screen at least 1024px wide to edit audio with your agent.</div>
        </div>
      </div>
    </div>
  );
}
