import { InkReveal } from "./InkReveal";
import type { Note } from "./types";

interface Props {
  loops: Note[];
  stepFor: (loopId: string) => Note | undefined;
  onComplete: (stepId: string) => void;
  lockPager: (locked: boolean) => void;
}

// Open loops (IA.md §Stage 3): a calm field of loop marks. Each loop
// hides its scope; you crack it open (InkReveal — the signature) to
// develop its one live step, mark it done, and the next step is hidden
// again behind another crack. Everything here stays quiet so the develop
// is the only bold moment.
export function OpenLoops({ loops, stepFor, onComplete, lockPager }: Props) {
  return (
    <div className="page__inner">
      <h2 className="page__title">Open loops</h2>

      {loops.length === 0 && (
        <p className="page__empty">Nothing open. Turn a brain-dump line into a loop.</p>
      )}

      <div className="loops">
        {loops.map((loop) => {
          const step = stepFor(loop.id);
          return (
            <article key={loop.id} className="loop">
              <h3 className="loop__title">{loop.text}</h3>
              {step && (
                <InkReveal
                  key={step.id}
                  step={step}
                  onDone={() => onComplete(step.id)}
                  lockPager={lockPager}
                />
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
