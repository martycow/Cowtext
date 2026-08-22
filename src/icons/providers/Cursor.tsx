// Cursor — a pointer arrow, the one shape the name always reads as.

export function CursorIcon({ size = 16, className }: { size?: number; className?: string }) {
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
      <path d="M3.2 1.4 12.9 8.9l-4.2.55 2.35 4.3-1.9 1.02-2.33-4.3-3.62 2.5V1.4z" />
    </svg>
  );
}
