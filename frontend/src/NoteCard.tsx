import type { PointerEvent as ReactPointerEvent } from "react";
import type { Note } from "./types";

interface Props {
  note: Note;
  x: number;
  y: number;
  onDragStart: (id: string, e: ReactPointerEvent) => void;
}

// Deterministic small tilt per note so cards don't line up in a grid —
// part of the "handwriting on paper" feel from docs/SPEC.md.
function tiltForId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((hash % 7) - 3) * 0.6;
}

export function NoteCard({ note, x, y, onDragStart }: Props) {
  const isChild = note.parent_id !== null;

  const classNames = [
    "note-card",
    note.status === "folded" && "note-card--folded",
    note.status === "done" && "note-card--done",
    isChild && note.status === "active" && "note-card--front",
    !isChild && note.status === "active" && "note-card--in-progress",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classNames}
      style={{ left: x, top: y, "--tilt": `${tiltForId(note.id)}deg` } as React.CSSProperties}
      onPointerDown={(e) => onDragStart(note.id, e)}
    >
      <div className="note-card__text">{note.text}</div>
    </div>
  );
}
