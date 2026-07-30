import { useEffect } from "react";
import type { Note } from "./types";

interface Props {
  note: Note;
  onClose: () => void;
}

// Loop design (IA.md §Stage 2): a transient focused overlay — the single
// moment full scope is visible — where a raw line becomes a titled loop
// with steps. This commit stands up the overlay shell (open/close, dimmed
// backdrop, focus trap basics); the step-proposer, manual entry, and the
// crack-open commit are wired in the next commit.
export function LoopDesign({ note, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Design loop">
      <div className="overlay__backdrop" onClick={onClose} />
      <div className="overlay__panel">
        <p className="overlay__eyebrow">Design loop</p>
        <h2 className="overlay__title">{note.text}</h2>
        <div className="overlay__steps" />
        <div className="overlay__actions">
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
