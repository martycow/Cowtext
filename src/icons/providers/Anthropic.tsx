// Anthropic — a filled "A" with a triangular counter. Hand-authored, one
// path, `currentColor` only: these glyphs sit in a chip row where the chip's
// own state (selected / dimmed) owns the colour, so an icon that carried its
// own brand fill would fight the accent law and the "not found" dimming.
// No icon library (WO15: the dependency budget is lucide-react + three
// fontsource packages, nothing else).

export function AnthropicIcon({ size = 16, className }: { size?: number; className?: string }) {
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
        d="M9.05 1.6h-2.1L1.6 14.4h2.72l1.1-2.72h5.16l1.1 2.72h2.72L9.05 1.6zM6.28 9.44 8 5.17l1.72 4.27H6.28z"
      />
    </svg>
  );
}
