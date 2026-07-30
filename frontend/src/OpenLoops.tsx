import type { Note } from "./types";

interface Props {
  loops: Note[];
  stepFor: (loopId: string) => Note | undefined;
}

// Open loops (IA.md §Stage 3): the working surface. Each loop is a mark;
// its single live step is the only thing with weight. The crack-open
// ink-reveal interaction (rub / hold-to-develop) is the signature and
// lands in the next commit — this shell renders the loops and their
// current step so the structure and navigation are in place first.
export function OpenLoops({ loops, stepFor }: Props) {
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
              {step && <p className="loop__step">{step.text}</p>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
