import { useStore } from '../store/useStore';
import type { BottomTab } from '../types';

const TABS: { id: BottomTab; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'activity', label: 'Activity' },
  { id: 'console', label: 'Tool Console' },
];

export function BottomTabs() {
  const tab = useStore((s) => s.bottomTab);
  const setTab = useStore((s) => s.setBottomTab);
  const activityCount = useStore((s) => s.activityLog.length);

  return (
    <section className="h-[300px] shrink-0 flex flex-col bg-panel">
      <div className="h-9 shrink-0 flex items-center px-2 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} className="tab" data-active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'activity' && activityCount > 0 && (
              <span className="ml-1.5 chip bg-accent/10 text-accent">{activityCount}</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'transcript' && <Placeholder text="Transcript will appear here once audio is loaded." />}
        {tab === 'activity' && <Placeholder text="Every WebMCP tool call will stream here." />}
        {tab === 'console' && <Placeholder text="Manually call any registered tool from here." />}
      </div>
    </section>
  );
}

function Placeholder({ text }: { text: string }) {
  return <div className="h-full flex items-center justify-center text-[13px] text-fg-4">{text}</div>;
}
