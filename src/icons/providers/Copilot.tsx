// GitHub Copilot — the goggled head, two eyes cut out of one body path.

export function CopilotIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M2.1 8.6C2.1 5.3 4.74 2.6 8 2.6s5.9 2.7 5.9 6v1.9c0 1.93-1.55 3.5-3.46 3.5H5.56A3.48 3.48 0 0 1 2.1 10.5V8.6zm3.5.3a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9zm4.8 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9z"
      />
    </svg>
  );
}
