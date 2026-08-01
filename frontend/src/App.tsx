import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  completeNote,
  crackOpen,
  createNote,
  listNotes,
  subscribeBusy,
  updatePosition,
} from "./api";
import { BrainDump } from "./BrainDump";
import { ClosedLoops } from "./ClosedLoops";
import { LoopDesign } from "./LoopDesign";
import { OpenLoops } from "./OpenLoops";
import type { Note, NoteRecurrence } from "./types";
import "./App.css";

const BUSY_INDICATOR_DELAY_MS = 300;

// The three surfaces, in flow order. Open loops is home (index 1): Brain
// dump one swipe left, Closed loops one swipe right. See docs/IA.md
// ("Screens vs. states").
const PAGES = ["Brain dump", "Open loops", "Closed loops"];
const HOME_PAGE = 1;

// Horizontal travel (px) past which a swipe commits to the next page,
// and the movement needed before we lock the gesture to an axis (so a
// vertical scroll inside a surface is never hijacked as a page swipe).
const SWIPE_COMMIT_PX = 60;
const AXIS_LOCK_PX = 10;

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [page, setPage] = useState(HOME_PAGE);
  const [designingId, setDesigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBusy, setShowBusy] = useState(false);

  // Live horizontal drag offset while swiping between pages.
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // First-run guidance: a new user lands on the empty home surface with
  // no reason to know the other surfaces are a swipe away. We show a
  // directional cue toward Brain dump until they navigate once, then
  // remember that forever. See docs/IA.md ("First-run").
  const [hasNavigated, setHasNavigated] = useState(
    () => localStorage.getItem("ol.navigated") === "1"
  );
  const firstRunRef = useRef(localStorage.getItem("ol.navigated") !== "1");
  const gestureRef = useRef<{ startX: number; startY: number; axis: "" | "x" | "y" } | null>(null);
  // Mirror of dragDx in a ref, so the swipe-commit decision at pointerup is
  // synchronous and never depends on a state re-render landing first.
  const dragDxRef = useRef(0);
  // Set true while a step is being developed (InkReveal): a rub can move
  // hundreds of px horizontally, which must never be read as a page swipe.
  const developLockRef = useRef(false);
  const lockPager = useCallback((locked: boolean) => {
    developLockRef.current = locked;
  }, []);

  const refresh = useCallback(async () => {
    try {
      setNotes(await listNotes());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = subscribeBusy((busy) => {
      window.clearTimeout(timer);
      if (busy) timer = window.setTimeout(() => setShowBusy(true), BUSY_INDICATOR_DELAY_MS);
      else setShowBusy(false);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(PAGES.length - 1, next));
      setPage(clamped);
      if (clamped !== page && !hasNavigated) {
        setHasNavigated(true);
        localStorage.setItem("ol.navigated", "1");
      }
    },
    [page, hasNavigated]
  );

  // Desktop: arrow keys move between surfaces — but only when the overlay
  // is closed and focus isn't in a text field (so arrows still move the
  // caret while writing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (designingId) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") goTo(page + 1);
      else if (e.key === "ArrowLeft") goTo(page - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, designingId, goTo]);

  // Touch/drag paging with an axis lock. Undecided until the pointer
  // moves past AXIS_LOCK_PX, then commits to horizontal (page swipe) or
  // vertical (let the surface scroll, we bow out).
  //
  // Always record the start point, even while the develop lock is on:
  // a touch on a folded ink mark locks the pager immediately (InkReveal),
  // and if it turns out to be a swipe the lock releases mid-gesture — the
  // pager must be able to take over from the ORIGINAL start point, or
  // swipes that start on a mark die. Movement is gated in onPointerMove.
  function onPointerDown(e: ReactPointerEvent) {
    if (designingId) return;
    if (e.pointerType === "mouse") return; // mouse uses arrows / the marker
    gestureRef.current = { startX: e.clientX, startY: e.clientY, axis: "" };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const g = gestureRef.current;
    if (!g || developLockRef.current) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.axis === "") {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.axis === "x") setDragging(true);
    }
    if (g.axis === "x") {
      // Resist dragging past the first/last surface.
      const atEdge = (page === 0 && dx > 0) || (page === PAGES.length - 1 && dx < 0);
      const val = atEdge ? dx / 3 : dx;
      dragDxRef.current = val;
      setDragDx(val);
    }
  }

  function endGesture() {
    const g = gestureRef.current;
    gestureRef.current = null;
    const dx = dragDxRef.current;
    dragDxRef.current = 0;
    if (g?.axis === "x") {
      if (dx <= -SWIPE_COMMIT_PX) goTo(page + 1);
      else if (dx >= SWIPE_COMMIT_PX) goTo(page - 1);
    }
    setDragging(false);
    setDragDx(0);
  }

  async function handleAdd(text: string, x: number, y: number) {
    try {
      await createNote({ text, x, y });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Persist a Brain dump line's new position after a drag. Optimistic:
  // update local state immediately so the note doesn't snap back, then
  // save.
  async function handleMove(id: string, x: number, y: number) {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
    try {
      await updatePosition(id, x, y);
    } catch (err) {
      // A failed position save is minor — the note has already moved
      // locally. Don't throw a full error bar over the whole page for it.
      console.warn("could not persist note position", err);
    }
  }

  // Commit the Loop design overlay: the raw line becomes a loop and moves
  // to Open loops with its first step live. Scope collapses; we follow
  // the item to its new surface so the transition is legible.
  async function handleOpenLoop(noteId: string, steps: string[], recurrence: NoteRecurrence) {
    try {
      await crackOpen(noteId, steps, recurrence);
      setDesigningId(null);
      await refresh();
      goTo(1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Mark the live step done — the loop advances (next step) or closes
  // (moves to Closed loops).
  async function handleComplete(stepId: string) {
    try {
      await completeNote(stepId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const dumpLines = notes.filter((n) => n.parent_id === null && n.kind === "plain");
  const openLoops = notes.filter(
    (n) => n.parent_id === null && n.kind === "loop" && n.status !== "done"
  );
  const closedLoops = notes.filter(
    (n) => n.parent_id === null && n.kind === "loop" && n.status === "done"
  );
  const stepFor = (loopId: string) =>
    notes.find((n) => n.parent_id === loopId && n.status === "active");

  const designing = designingId ? notes.find((n) => n.id === designingId) ?? null : null;

  const trackStyle = {
    transform: `translateX(calc(${-page * (100 / PAGES.length)}% + ${dragDx}px))`,
  };

  return (
    <div className="app">
      {/* The notebook's constant chrome — the binding, not a navbar. Page
          markers in the middle; the neighboring pages named quietly at
          either side, so the structure (and the swipe) is legible at a
          glance. It never moves while the pages slide beneath it. */}
      <header className="chrome">
        {page > 0 ? (
          <button
            type="button"
            className="chrome__adjacent chrome__adjacent--prev"
            onClick={() => goTo(page - 1)}
          >
            ‹ {PAGES[page - 1]}
          </button>
        ) : (
          <span />
        )}
        <nav className="marker" aria-label="Surfaces">
          {PAGES.map((label, i) => (
            <button
              key={label}
              type="button"
              className={`marker__dot${i === page ? " marker__dot--current" : ""}`}
              aria-label={label}
              aria-current={i === page}
              onClick={() => goTo(i)}
            />
          ))}
        </nav>
        {page < PAGES.length - 1 ? (
          <button
            type="button"
            className="chrome__adjacent chrome__adjacent--next"
            onClick={() => goTo(page + 1)}
          >
            {PAGES[page + 1]} ›
          </button>
        ) : (
          <span />
        )}
      </header>

      {error && (
        <div className="app__error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div
        className="pager"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <div
          className={`pager__track${dragging ? " pager__track--dragging" : ""}`}
          style={trackStyle}
        >
          <section className="page" aria-hidden={page !== 0}>
            <BrainDump
              notes={dumpLines}
              onAdd={handleAdd}
              onMakeLoop={(n) => setDesigningId(n.id)}
              onMove={handleMove}
            />
          </section>
          <section className="page" aria-hidden={page !== 1}>
            <OpenLoops
              loops={openLoops}
              stepFor={stepFor}
              onComplete={handleComplete}
              lockPager={lockPager}
            />
          </section>
          <section className="page" aria-hidden={page !== 2}>
            <ClosedLoops loops={closedLoops} />
          </section>
        </div>
      </div>

      {/* First-run cue: points a new user toward Brain dump (one surface
          left). Rendered only on the home surface until they navigate
          once, then it fades and never returns. */}
      {firstRunRef.current && page === HOME_PAGE && openLoops.length === 0 && (
        <button
          type="button"
          className={`firstrun-cue${hasNavigated ? " firstrun-cue--gone" : ""}`}
          onClick={() => goTo(0)}
        >
          <span className="firstrun-cue__chevron" aria-hidden="true">
            ‹
          </span>
          <span className="firstrun-cue__label">Brain dump</span>
        </button>
      )}

      {designing && (
        <LoopDesign
          note={designing}
          onOpenLoop={(steps, recurrence) => handleOpenLoop(designing.id, steps, recurrence)}
          onClose={() => setDesigningId(null)}
          onError={setError}
        />
      )}

      {showBusy && (
        <div className="busy" role="status" aria-live="polite">
          <span className="busy__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          One moment
        </div>
      )}
    </div>
  );
}
