// Signature hero element: a live seismograph-style trace, referencing the
// product's job (catching a keyword the moment it spikes) rather than
// decorating for its own sake. Scrolls continuously to read as "live";
// respects prefers-reduced-motion by holding still.

// One repeating unit's (x, y) offsets, y=20 is the flat baseline.
const UNIT_POINTS: [number, number][] = [
  [0, 20],
  [14, 20],
  [18, 6],
  [22, 34],
  [26, 12],
  [30, 20],
  [44, 20],
  [48, 2],
  [52, 38],
  [56, 20],
  [70, 20],
];
const UNIT_WIDTH = 70;
const REPEATS = 20;

const PATH = Array.from({ length: REPEATS }, (_, i) =>
  UNIT_POINTS.map(([x, y], j) => `${j === 0 ? "M" : "L"}${x + i * UNIT_WIDTH} ${y}`).join(" "),
).join(" ");

export function SpikeLine() {
  return (
    <div
      className="spike-line pointer-events-none h-10 w-full overflow-hidden text-signal/70"
      aria-hidden="true"
    >
      <svg
        width={UNIT_WIDTH * REPEATS}
        height="40"
        viewBox={`0 0 ${UNIT_WIDTH * REPEATS} 40`}
        preserveAspectRatio="none"
        className="spike-line-track h-10"
      >
        <path
          d={PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
