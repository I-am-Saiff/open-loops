interface Point {
  x: number;
  y: number;
}

interface Props {
  fromPos: Point;
  toPos: Point;
  otherLoopTitle: string;
  existingStepText: string;
  onAccept: () => void;
  onDismiss: () => void;
}

// Rough offset from a card's top-left (x, y) to its visual center, so the
// thread starts/ends inside the cards rather than at their corners. Not
// exact per-card (cards vary in size), close enough for a "subtle
// connecting thread" at demo scale.
const CARD_CENTER = { x: 90, y: 28 };

// Feature C: rendered only once both ends are notes the frontend actually
// has (fog-of-war visible) — see docs/DECISIONS.md ("Feature C frontend").
export function MergeThread({
  fromPos,
  toPos,
  otherLoopTitle,
  existingStepText,
  onAccept,
  onDismiss,
}: Props) {
  const x1 = fromPos.x + CARD_CENTER.x;
  const y1 = fromPos.y + CARD_CENTER.y;
  const x2 = toPos.x + CARD_CENTER.x;
  const y2 = toPos.y + CARD_CENTER.y;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <>
      <svg className="merge-thread-svg">
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="merge-thread-line" />
      </svg>
      <div
        className="merge-prompt"
        style={{ left: midX, top: midY }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="merge-prompt__text">
          &ldquo;{existingStepText}&rdquo; is already pending for &ldquo;{otherLoopTitle}&rdquo; —
          link them?
        </p>
        <div className="merge-prompt__actions">
          <button type="button" onClick={onAccept}>
            link them
          </button>
          <button type="button" className="note-card__action--quiet" onClick={onDismiss}>
            no thanks
          </button>
        </div>
      </div>
    </>
  );
}
