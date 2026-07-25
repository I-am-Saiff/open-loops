import { useState } from "react";
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
  // Consent: turns a plain note into a loop (whisper tap or the note
  // menu's "crack this"). See docs/DECISIONS.md ("Notebook first").
  onCrack: (note: Note) => void;
  onSaveText: (id: string, text: string) => void;
  children?: ReactNode;
}

// How long the "looks like a loop" whisper lingers before the page
// stops offering (don't nag). Demo-compressed like v4's fade window;
// the CSS fade-out is aligned to note age via a negative
// animation-delay so a re-render mid-lifetime doesn't restart it.
const WHISPER_TTL_MS = 10 * 60_000;
const WHISPER_FADE_START_MS = 8 * 60_000;

function parseUtc(iso: string): number {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`).getTime();
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

// Top-level notes only. A 'plain' note renders as ink on paper — no
// status styling, no thread, silent — with at most a quiet crack
// affordance. A 'loop' note renders the existing folded/in-progress/
// done/thread-open machinery. See docs/DECISIONS.md ("Notebook first").
export function NoteCard({
  note,
  x,
  y,
  isOpen,
  isDissolving,
  onDragStart,
  onOpen,
  onCrack,
  onSaveText,
  children,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editText, setEditText] = useState<string | null>(null);

  const tilt = tiltForId(note.id, isOpen ? 0.4 : 2.2);
  const isPlain = note.kind === "plain";

  const classNames = [
    "note-card",
    isPlain && "note-card--plain",
    !isPlain && note.status === "folded" && "note-card--folded",
    !isPlain && note.status === "done" && "note-card--done",
    !isPlain && note.status === "active" && !isOpen && "note-card--in-progress",
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

  function commitEdit() {
    if (editText === null) return;
    const trimmed = editText.trim();
    if (trimmed && trimmed !== note.text) onSaveText(note.id, trimmed);
    setEditText(null);
  }

  const ageMs = Date.now() - parseUtc(note.created_at);
  const showWhisper = isPlain && note.task_like === true && ageMs < WHISPER_TTL_MS;

  return (
    <div
      className={classNames}
      style={{ left: x, top: y, "--tilt": `${tilt}deg` } as React.CSSProperties}
      onPointerDown={(e) => onDragStart(note.id, e)}
    >
      {isPlain && editText !== null ? (
        <input
          autoFocus
          className="note-card__edit"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            else if (e.key === "Escape") setEditText(null);
          }}
          onBlur={commitEdit}
        />
      ) : (
        <div
          className="note-card__text"
          onDoubleClick={
            isPlain
              ? (e) => {
                  e.stopPropagation();
                  setEditText(note.text);
                }
              : undefined
          }
        >
          {note.text}
        </div>
      )}

      {showWhisper && (
        <button
          type="button"
          className="note-card__whisper"
          style={{ animationDelay: `${(WHISPER_FADE_START_MS - ageMs) / 1000}s` }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onCrack(note)}
        >
          looks like a loop — crack it?
        </button>
      )}

      {isPlain && (
        <>
          <button
            type="button"
            className="note-card__menu-btn"
            aria-label="note menu"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="note-card__menu" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onCrack(note);
                }}
              >
                crack this
              </button>
            </div>
          )}
        </>
      )}

      {!isPlain && note.status !== "done" && (
        <button
          type="button"
          className="note-card__action"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onOpen(note)}
        >
          {note.status === "folded" ? "open" : "continue"}
        </button>
      )}
      {!isPlain && note.status === "done" && (
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
