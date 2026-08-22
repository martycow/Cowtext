// OpenAI — a hexagonal ring (a nod to the knot mark, reduced to one
// evenodd path at 16px, where anything finer turns to mush).

export function OpenAIIcon({ size = 16, className }: { size?: number; className?: string }) {
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
        d="M8 1 1.94 4.5v7L8 15l6.06-3.5v-7L8 1zm0 3 3.46 2v4L8 12l-3.46-2V6L8 4z"
      />
    </svg>
  );
}
