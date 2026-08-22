// Google Gemini — the four-point sparkle, four concave quarter arcs.

export function GeminiIcon({ size = 16, className }: { size?: number; className?: string }) {
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
      <path d="M8 .8c0 3.98-3.22 7.2-7.2 7.2 3.98 0 7.2 3.22 7.2 7.2 0-3.98 3.22-7.2 7.2-7.2C11.22 8 8 4.78 8 .8z" />
    </svg>
  );
}
