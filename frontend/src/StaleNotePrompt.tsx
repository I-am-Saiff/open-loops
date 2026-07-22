interface Props {
  onKeep: () => void;
  onLetGo: () => void;
}

// A separate sticky note attached to a card flagged stale by the
// backend (peek_count >= 3, 3+ days old, no child ever completed) — see
// docs/DECISIONS.md ("Feature B"). Styled distinctly (different paper
// color, offset/rotated) so it reads as something stuck onto the note,
// not part of it.
export function StaleNotePrompt({ onKeep, onLetGo }: Props) {
  return (
    <div className="stale-prompt" onPointerDown={(e) => e.stopPropagation()}>
      <p className="stale-prompt__text">
        you&rsquo;ve looked at this a few times and nothing&rsquo;s moved — still worth
        keeping?
      </p>
      <div className="stale-prompt__actions">
        <button type="button" onClick={onKeep}>
          keep it
        </button>
        <button type="button" className="stale-prompt__let-go" onClick={onLetGo}>
          let it go
        </button>
      </div>
    </div>
  );
}
