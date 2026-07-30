import { useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { Note } from "./types";

interface Props {
  // Only ever the raw plain top-level lines — never a loop or a loop's
  // steps. The caller guarantees this filter (App.tsx dumpLines). Brain
  // dump shows nothing loop-related except the per-line "make a loop".
  notes: Note[];
  onAdd: (text: string, x: number, y: number) => void;
  onMakeLoop: (note: Note) => void;
  onMove: (id: string, x: number, y: number) => void;
}

// Brain dump (IA.md §Stage 1): a freeform paper surface. Write anywhere,
// drag notes anywhere. Dragging a note moves the note (it stops the
// pointer from reaching the pager); a swipe on empty paper still changes
// surface. Zero structure, no AI — just raw lines the user placed.
const TAP_MOVE_PX = 8;
const TAP_MAX_MS = 500;

export function BrainDump({ notes, onAdd, onMakeLoop, onMove }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [draftText, setDraftText] = useState("");

  // The note currently being dragged, and its live position.
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Tap-to-write detection on empty paper (touch): distinguishes a tap
  // from a page-swipe so the two never conflict.
  const tapRef = useRef<{ x: number; y: number; t: number } | null>(null);

  function toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x: clientX, y: clientY };
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // ---- dragging a note ----
  function startDrag(e: ReactPointerEvent, note: Note) {
    e.stopPropagation(); // never let the pager read this as a swipe
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // A synthetic/ended pointer can't be captured — harmless.
    }
    const c = toCanvas(e.clientX, e.clientY);
    dragRef.current = { id: note.id, offX: c.x - note.x, offY: c.y - note.y };
    setDragId(note.id);
    setDragPos({ x: note.x, y: note.y });
  }
  function onDrag(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    const c = toCanvas(e.clientX, e.clientY);
    setDragPos({ x: c.x - d.offX, y: c.y - d.offY });
  }
  function endDrag(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    const c = toCanvas(e.clientX, e.clientY);
    const x = c.x - d.offX;
    const y = c.y - d.offY;
    dragRef.current = null;
    setDragId(null);
    onMove(d.id, x, y);
  }

  // ---- writing on empty paper ----
  function canvasPointerDown(e: ReactPointerEvent) {
    // Do NOT stop propagation — the pager needs empty-paper pointers to
    // drive the surface swipe.
    if (e.target !== canvasRef.current) return;
    tapRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }
  function canvasPointerUp(e: ReactPointerEvent) {
    const t = tapRef.current;
    tapRef.current = null;
    if (!t || e.pointerType !== "touch") return; // desktop uses double-click
    if (e.target !== canvasRef.current) return;
    const moved = Math.hypot(e.clientX - t.x, e.clientY - t.y);
    if (moved > TAP_MOVE_PX || Date.now() - t.t > TAP_MAX_MS) return; // a swipe/hold
    openDraft(e.clientX, e.clientY);
  }
  function canvasDoubleClick(e: ReactMouseEvent) {
    if (e.target !== canvasRef.current) return;
    openDraft(e.clientX, e.clientY);
  }
  function openDraft(clientX: number, clientY: number) {
    setDraftText("");
    setDraft(toCanvas(clientX, clientY));
  }
  function commitDraft() {
    const text = draftText.trim();
    if (draft && text) onAdd(text, draft.x, draft.y);
    setDraft(null);
    setDraftText("");
  }

  return (
    <div className="dump">
      <h2 className="page__title dump__title">Brain dump</h2>
      <div
        className="dump-canvas"
        ref={canvasRef}
        onPointerDown={canvasPointerDown}
        onPointerUp={canvasPointerUp}
        onDoubleClick={canvasDoubleClick}
      >
        {notes.length === 0 && !draft && (
          <p className="dump__empty">Empty page. Write what's on your mind.</p>
        )}

        {notes.map((note) => {
          const pos = dragId === note.id ? dragPos : { x: note.x, y: note.y };
          return (
            <div
              key={note.id}
              className={`dump-note${dragId === note.id ? " dump-note--dragging" : ""}`}
              style={{ left: pos.x, top: pos.y }}
              onPointerDown={(e) => startDrag(e, note)}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <span className="dump-note__text">{note.text}</span>
              <button
                type="button"
                className="dump-note__loop"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onMakeLoop(note)}
              >
                make a loop
              </button>
            </div>
          );
        })}

        {draft && (
          <input
            autoFocus
            className="dump-note__input"
            style={{ left: draft.x, top: draft.y }}
            value={draftText}
            placeholder="Write a line"
            aria-label="Write a line"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDraft();
              else if (e.key === "Escape") {
                setDraft(null);
                setDraftText("");
              }
            }}
            onBlur={commitDraft}
          />
        )}
      </div>
    </div>
  );
}
