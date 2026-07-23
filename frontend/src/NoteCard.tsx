import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { Note } from "./types";

interface Props {
  note: Note;
  x: number;
  y: number;
  isOpen: boolean;
  // True for the DISSOLVE_ANIMATION_MS window between "let it go" and
  // the note actually being deleted — see App.tsx and docs/DECISIONS.md
  // ("Feature B, in-thread").
  isDissolving: boolean;
  onDragStart: (id: string, e: ReactPointerEvent) => void;
  onOpen: (note: Note) => void;
  children?: ReactNode;
}

// Deterministic small tilt per note so cards don't line up in a grid —
// part of the "handwriting on paper" feel from docs/SPEC.md. An open
// thread sits nearly flat (it's the one thing in front of you); closed
// cards scatter more.
function tiltForId(id: string, spreadDeg: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((hash % 7) - 3) * (spreadDeg / 3);
}

// Only ever rendered for top-level loops now — a step's "card" no longer
// exists on the canvas at all, it only exists as a message inside its
// loop's thread. See docs/DECISIONS.md ("Major redesign: chat thread
// replaces the step-list UI").
export function NoteCard({ note, x, y, isOpen, isDissolving, onDragStart, onOpen, children }: Props) {
  const tilt = tiltForId(note.id, isOpen ? 0.4 : 2.2);

  const classNames = [
    "note-card",
    note.status === "folded" && "note-card--folded",
    note.status === "done" && "note-card--done",
    note.status === "active" && !isOpen && "note-card--in-progress",
    isOpen && "note-card--thread-open",
    isDissolving && "note-card--dissolving",
  ]
    .filter(Boolean)
    .join(" ");

  if (isOpen) {
    return (
      <div className={classNames} style={{ left: x, top: y } as React.CSSProperties}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={classNames}
      style={{ left: x, top: y, "--tilt": `${tilt}deg` } as React.CSSProperties}
      onPointerDown={(e) => onDragStart(note.id, e)}
    >
      <div className="note-card__text">{note.text}</div>
      {note.status !== "done" && (
        <button
          type="button"
          className="note-card__action"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onOpen(note)}
        >
          {note.status === "folded" ? "open" : "continue"}
        </button>
      )}
      {note.status === "done" && (
        <button
          type="button"
          className="note-card__action--quiet"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onOpen(note)}
        >
          view thread
        </button>
      )}
    </div>
  );
}
