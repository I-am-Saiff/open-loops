import type { Note } from "./types";

interface Props {
  loops: Note[];
}

function shortDate(iso: string): string {
  const d = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

// Closed loops (IA.md §Stage 4): a quiet, low-contrast record of what
// you finished — reachable, never in the way. No metrics, no re-open.
export function ClosedLoops({ loops }: Props) {
  return (
    <div className="page__inner">
      <h2 className="page__title">Closed loops</h2>

      {loops.length === 0 && (
        <p className="page__empty">Nothing closed yet. Finished loops collect here.</p>
      )}

      <ul className="closed__list">
        {loops.map((loop) => (
          <li key={loop.id} className="closed__row">
            <span className="closed__text">
              {loop.text}
              {loop.recurrence !== "none" && (
                <span className="closed__recurs" title={`Repeats ${loop.recurrence}`}>
                  {" ↻ "}
                  {loop.recurrence}
                </span>
              )}
            </span>
            <span className="closed__date">{shortDate(loop.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
