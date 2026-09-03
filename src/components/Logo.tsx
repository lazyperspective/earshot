export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" fill="#13171C" />
      <g fill="none" stroke="#2EE6C5" strokeWidth="5" strokeLinecap="round">
        <path d="M14 32v0.01" />
        <path d="M23 24v16" />
        <path d="M32 16v32" />
        <path d="M41 22v20" />
        <path d="M50 28v8" />
      </g>
    </svg>
  );
}
