import { useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { Note } from "./types";

interface Props {
  // Only ever the raw plain top-level lines — never a loop or a loop's
  // steps. The caller guarantees this filter (App.tsx dumpLines). Brain
  // dump shows nothing loop-related except the per-line "crack this open".
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

  // REAL-iOS scroll lock while dragging a note: same failure mode as the
  // ink develop — CSS touch-action alone isn't reliably honored by iOS
  // Safari, and React's touch listeners are passive. One native
  // non-passive document listener, active only while a drag is live, so
  // the page can't scroll/rubber-band under a dragged note. Swipes on
  // empty paper never enter dragRef, so they're untouched.
  useEffect(() => {
    function onNativeTouchMove(e: TouchEvent) {
      if (dragRef.current && e.cancelable) e.preventDefault();
    }
    document.addEventListener("touchmove", onNativeTouchMove, { passive: false });
    return () => document.removeEventListener("touchmove", onNativeTouchMove);
  }, []);

  function toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x: clientX, y: clientY };
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // Keep a note fully on the paper — it can't be dragged off an edge or
  // squeezed into an awkward wrap. Clamps left/top so the note's whole box
  // stays inside the canvas.
  function clamp(x: number, y: number, w: number, h: number): { x: number; y: number } {
    const c = canvasRef.current;
    // A canvas with no measured size (mid-layout, hidden pane) can't
    // clamp meaningfully — leave the position untouched rather than
    // collapsing everything to 0,0.
    if (!c || c.clientWidth === 0 || c.clientHeight === 0) return { x, y };
    return {
      x: Math.min(Math.max(0, x), Math.max(0, c.clientWidth - w)),
      y: Math.min(Math.max(0, y), Math.max(0, c.clientHeight - h)),
    };
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
    // Anchor to the RENDERED position (offsetLeft/Top), not the stored
    // x/y — a note stored off a wide screen renders clamped on a narrow
    // one, and anchoring to the stale stored x would freeze it against
    // the edge. offsetParent is the canvas, so these are canvas-relative.
    const el = e.currentTarget as HTMLElement;
    dragRef.current = { id: note.id, offX: c.x - el.offsetLeft, offY: c.y - el.offsetTop };
    setDragId(note.id);
    setDragPos({ x: el.offsetLeft, y: el.offsetTop });
  }
  function onDrag(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const c = toCanvas(e.clientX, e.clientY);
    setDragPos(clamp(c.x - d.offX, c.y - d.offY, el.offsetWidth, el.offsetHeight));
  }
  function endDrag(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const c = toCanvas(e.clientX, e.clientY);
    const p = clamp(c.x - d.offX, c.y - d.offY, el.offsetWidth, el.offsetHeight);
    dragRef.current = null;
    setDragId(null);
    onMove(d.id, p.x, p.y);
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
    const c = toCanvas(clientX, clientY);
    const canvas = canvasRef.current;
    const noteW = canvas ? Math.min(220, canvas.clientWidth - 24) : 220;
    setDraft(clamp(c.x, c.y, noteW, 56));
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
              // The CSS min() keeps a note on-paper at render time too: a
              // position stored on a wide screen must not clip on a
              // narrow one (the JS clamp only runs on create/drag).
              style={{ left: `min(${pos.x}px, calc(100% - var(--note-w)))`, top: pos.y }}
              onPointerDown={(e) => startDrag(e, note)}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <span className="dump-note__text">{note.text}</span>
              <button
                type="button"
                className="dump-note__crack"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onMakeLoop(note)}
              >
                <span className="dump-note__crack-mark" aria-hidden="true">
                  <svg width="22" height="16" viewBox="0 0 30 22" fill="none">
                    <path
                      d="M15 16.5c-4.2 0-6.5-2.2-6.5-5S11 6 14.5 6s6 2.2 6 4.8c0 3.2-3.4 5.4-8 5.4-3.1 0-5.5-1.1-5.5-1.1"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                crack this open
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
