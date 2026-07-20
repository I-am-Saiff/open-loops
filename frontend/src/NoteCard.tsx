import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Note } from "./types";

interface Props {
  note: Note;
  x: number;
  y: number;
  onDragStart: (id: string, e: ReactPointerEvent) => void;
  onCrackOpen: (id: string, steps: string[]) => void;
  onComplete: (id: string) => void;
}

// Deterministic small tilt per note so cards don't line up in a grid —
// part of the "handwriting on paper" feel from docs/SPEC.md. The active
// front-facing card gets a much narrower spread than folded/done ones —
// it reads as the one piece of paper you just set down carefully in
// front of you, versus everything else scattered around it.
function tiltForId(id: string, spreadDeg: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((hash % 7) - 3) * (spreadDeg / 3);
}

export function NoteCard({ note, x, y, onDragStart, onCrackOpen, onComplete }: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [stepsText, setStepsText] = useState("");

  const isTopLevel = note.parent_id === null;
  const isChild = !isTopLevel;
  const isFrontFacingChild = isChild && note.status === "active";

  const classNames = [
    "note-card",
    note.status === "folded" && "note-card--folded",
    note.status === "done" && "note-card--done",
    isFrontFacingChild && "note-card--front",
    isTopLevel && note.status === "active" && "note-card--in-progress",
  ]
    .filter(Boolean)
    .join(" ");

  const tilt = tiltForId(note.id, isFrontFacingChild ? 0.6 : 2.4);

  function submitCrackOpen() {
    const steps = stepsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (steps.length === 0) return;
    onCrackOpen(note.id, steps);
    setPanelOpen(false);
    setStepsText("");
  }

  return (
    <div
      className={classNames}
      style={{ left: x, top: y, "--tilt": `${tilt}deg` } as React.CSSProperties}
      onPointerDown={(e) => onDragStart(note.id, e)}
    >
      <div className="note-card__text">{note.text}</div>

      {isTopLevel && note.status === "folded" && (
        <button
          type="button"
          className="note-card__action"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPanelOpen((open) => !open)}
        >
          {panelOpen ? "cancel" : "open"}
        </button>
      )}

      {panelOpen && (
        <div className="crack-open-panel" onPointerDown={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            className="crack-open-panel__textarea"
            placeholder={"one sub-step per line…"}
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
          />
          <div className="crack-open-panel__actions">
            <button type="button" onClick={submitCrackOpen}>
              Crack open
            </button>
            <button
              type="button"
              className="note-card__action--quiet"
              onClick={() => {
                onComplete(note.id);
                setPanelOpen(false);
              }}
            >
              No sub-steps, mark done
            </button>
          </div>
        </div>
      )}

      {isFrontFacingChild && (
        <button
          type="button"
          className="note-card__done-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onComplete(note.id)}
        >
          Done
        </button>
      )}
    </div>
  );
}
