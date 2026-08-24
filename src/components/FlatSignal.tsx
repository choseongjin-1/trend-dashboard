// Empty-state glyph: a signal trace gone quiet, the flip side of SpikeLine's
// live hero trace. Replaces a generic 🔍 "no results" emoji with something
// drawn from SPIKE's own visual vocabulary — flat + fading, not searching.
export function FlatSignal() {
  return (
    <svg
      width="64"
      height="22"
      viewBox="0 0 64 22"
      className="text-text-dim"
      aria-hidden="true"
    >
      <path d="M0 11 H26" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" fill="none" />
      <path
        d="M34 11 H64"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray="0.5 5"
        fill="none"
      />
    </svg>
  );
}
