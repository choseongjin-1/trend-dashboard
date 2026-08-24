// Empty-state glyph: blank flap cells, nothing has settled into place yet.
// Replaces the old seismograph-derived FlatSignal now that the product's
// visual language is a split-flap board, not a monitoring console.
export function EmptyFlaps() {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-9 w-7 rounded-sm border border-ink-dim/25 bg-casing" />
      ))}
    </div>
  );
}
