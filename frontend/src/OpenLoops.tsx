import { useState } from "react";
import type { Note } from "./types";

interface Props {
  loops: Note[];
  stepFor: (loopId: string) => Note | undefined;
  onComplete: (stepId: string) => void;
}

// Open loops (IA.md §Stage 3): a calm field of loop marks. Each loop
// hides its scope — you crack it open to reveal the one live step, then
// mark it done, and the next step is hidden again behind another crack.
//
// This is the FUNCTIONAL skeleton of the signature: cracking open here
// reveals the already-active step so the full pipeline works end to end.
// The tuned ink-develop interaction (rub / press-and-hold-to-develop
// with the blur-out/opacity-in curves and haptics from DESIGN.md §5–6)
// is deliberately deferred to the polish phase, not built here.
export function OpenLoops({ loops, stepFor, onComplete }: Props) {
  // Which steps are currently revealed, by step id. Because a completed
  // step is replaced by a new active child with a new id, the next step
  // is unrevealed by construction — no reset bookkeeping needed.
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  return (
    <div className="page__inner">
      <h2 className="page__title">Open loops</h2>

      {loops.length === 0 && (
        <p className="page__empty">Nothing open. Turn a brain-dump line into a loop.</p>
      )}

      <div className="loops">
        {loops.map((loop) => {
          const step = stepFor(loop.id);
          const isRevealed = step != null && revealed[step.id];
          return (
            <article key={loop.id} className="loop">
              <h3 className="loop__title">{loop.text}</h3>

              {step && !isRevealed && (
                <button
                  type="button"
                  className="loop__crack"
                  onClick={() => setRevealed((r) => ({ ...r, [step.id]: true }))}
                >
                  Crack open
                </button>
              )}

              {step && isRevealed && (
                <div className="loop__live">
                  <p className="loop__step">{step.text}</p>
                  <button
                    type="button"
                    className="btn btn--text loop__done"
                    onClick={() => onComplete(step.id)}
                  >
                    Done
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
