import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  advanceThread,
  classifyNote,
  completeNote,
  createNote,
  dismissMessage,
  dissolveNote,
  keepNote,
  linkNotes,
  listMessages,
  listNotes,
  manualFirstStep,
  peekNote,
  sendThreadMessage,
  startThread,
  subscribeBusy,
  updateNoteText,
} from "./api";
import { ChatThread } from "./ChatThread";
import { DicePage } from "./DicePage";
import { FadePage } from "./FadePage";
import { InkPage } from "./InkPage";
import { NewNoteInput } from "./NewNoteInput";
import { NoteCard } from "./NoteCard";
import { PageTabs } from "./PageTabs";
import type { PageId } from "./PageTabs";
import type { Message, Note } from "./types";
import "./App.css";

interface Point {
  x: number;
  y: number;
}

interface Draft extends Point {
  kind: "new-note";
}

// Matches App.css's @keyframes dissolve duration — the actual DELETE is
// deferred until the crumple animation finishes playing. See
// docs/DECISIONS.md ("Feature B, in-thread").
const DISSOLVE_ANIMATION_MS = 450;

// Eraser timings. The rub-out matches App.css's @keyframes rub-out;
// the undo window is how long the "rubbed out — undo?" whisper lingers
// before the DELETE actually fires — until then nothing has left the
// backend, so undo is just un-hiding the card. See docs/DECISIONS.md
// ("Eraser").
const RUB_OUT_ANIMATION_MS = 650;
const ERASE_UNDO_WINDOW_MS = 5000;

// A note mid-undo-window: hidden from the canvas, whisper showing at
// its old spot, real DELETE armed on a timer.
interface PendingErase {
  x: number;
  y: number;
  timer: number;
}

// The sheet of paper is bigger than the window: a fixed large surface
// inside the scroll container, origin at the top-left so every stored
// x/y renders exactly where it always did. Scrolling (trackpad both
// axes, or dragging empty paper) slides the sheet around. See
// docs/DECISIONS.md ("Scrollable canvas").
const SURFACE_WIDTH = 3000;
const SURFACE_HEIGHT = 2000;

// Only surface the "working" indicator once a request has been
// out for this long — a warm request returns well under this, so the
// indicator never flickers on fast actions; a cold backend or a Groq
// decompose crosses it and shows the notebook is thinking. See
// docs/DECISIONS.md ("Loading indicator").
const BUSY_INDICATOR_DELAY_MS = 300;

export default function App() {
  // Which notebook page is showing — four renderings of the same loops
  // data, one per anti-avoidance mechanic. See docs/DECISIONS.md
  // ("Version gallery").
  const [page, setPage] = useState<PageId>("v1");
  const [notes, setNotes] = useState<Note[]>([]);
  // Drag position overrides, keyed by note id. Local/session-only — there
  // is no endpoint yet to persist x/y after a drag. See docs/DECISIONS.md.
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which loop's thread is currently expanded on the canvas — only one at
  // a time, matching "the one piece of paper in front of you."
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  // Message history per loop, keyed by the loop's (top-level) note id.
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  // The loop currently mid-crumple after "let it go" — see
  // handleDropStale. Only one can dissolve at a time in practice (you
  // can only have one thread open), but keyed by id for clarity.
  const [dissolvingId, setDissolvingId] = useState<string | null>(null);
  // Eraser mode: picked up from the corner of the page, put down with
  // Esc or a second click. See docs/DECISIONS.md ("Eraser").
  const [eraserMode, setEraserMode] = useState(false);
  // Notes currently playing the rub-out animation, keyed by id.
  const [rubbing, setRubbing] = useState<Record<string, boolean>>({});
  // Notes in the undo window: hidden, whisper up, DELETE on a timer.
  const [pendingErase, setPendingErase] = useState<Record<string, PendingErase>>({});
  // Whether the subtle "working" indicator is showing — driven by the
  // API busy tracker, gated behind BUSY_INDICATOR_DELAY_MS.
  const [showBusy, setShowBusy] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  // Drag-to-pan on empty paper: initial pointer + scroll positions.
  const panningRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const fetched = await listNotes();
      setNotes(fetched);
      setPositions((prev) => {
        const next = { ...prev };
        for (const note of fetched) {
          if (!(note.id in next)) next[note.id] = { x: note.x, y: note.y };
        }
        return next;
      });
      return fetched;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  // Re-fetch on every page flip, not just on mount — all four pages
  // render the same loops, so a loop created on one page must show up
  // when flipping to another.
  useEffect(() => {
    refresh();
  }, [refresh, page]);

  // Show the "working" indicator only if a request stays in flight past
  // the delay — clearing the timer on a quick finish keeps warm actions
  // silent while a cold/slow one surfaces it.
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = subscribeBusy((busy) => {
      window.clearTimeout(timer);
      if (busy) {
        timer = window.setTimeout(() => setShowBusy(true), BUSY_INDICATOR_DELAY_MS);
      } else {
        setShowBusy(false);
      }
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // Coordinates are relative to the paper surface, not the scroll
  // viewport — the surface's bounding rect already moves with scroll,
  // so this is scroll-position-proof by construction.
  function toCanvasCoords(clientX: number, clientY: number): Point {
    const el = surfaceRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function handleCanvasDoubleClick(e: React.MouseEvent) {
    if (eraserMode) return; // you write with a pen, not an eraser
    if (e.target !== surfaceRef.current) return; // ignore double-clicks on a card
    setDraft({ kind: "new-note", ...toCanvasCoords(e.clientX, e.clientY) });
  }

  // Dragging empty paper slides the sheet (scrolls the container);
  // dragging a card moves the card — the two can't conflict because a
  // card's pointerdown never reaches the surface (stopPropagation in
  // handleDragStart), and this only engages when the press landed on
  // bare paper.
  function handlePanStart(e: ReactPointerEvent) {
    if (e.target !== surfaceRef.current || e.button !== 0) return;
    const el = canvasRef.current;
    if (!el) return;
    panningRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    window.addEventListener("pointermove", handlePanMove);
    window.addEventListener("pointerup", handlePanEnd);
  }

  const handlePanMove = useCallback((e: PointerEvent) => {
    const pan = panningRef.current;
    const el = canvasRef.current;
    if (!pan || !el) return;
    el.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX);
    el.scrollTop = pan.scrollTop - (e.clientY - pan.startY);
  }, []);

  const handlePanEnd = useCallback(() => {
    panningRef.current = null;
    window.removeEventListener("pointermove", handlePanMove);
    window.removeEventListener("pointerup", handlePanEnd);
  }, [handlePanMove]);

  // Picking up / putting down the eraser. Picking it up closes any open
  // thread — you can't rub out a page you're mid-conversation with.
  function toggleEraser() {
    setEraserMode((on) => {
      if (!on) setOpenThreadId(null);
      return !on;
    });
  }

  // Esc puts the eraser back.
  useEffect(() => {
    if (!eraserMode) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setEraserMode(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [eraserMode]);

  // The rub: plays the ink-smear animation, then hides the card and
  // opens the undo window. The actual DELETE (existing dissolve
  // endpoint — cascades children + thread messages) fires only when the
  // whisper expires, so undo is purely local. See docs/DECISIONS.md.
  function handleErase(note: Note) {
    if (rubbing[note.id] || pendingErase[note.id]) return;
    setRubbing((prev) => ({ ...prev, [note.id]: true }));

    window.setTimeout(() => {
      setRubbing((prev) => {
        const next = { ...prev };
        delete next[note.id];
        return next;
      });
      const pos = positions[note.id] ?? { x: note.x, y: note.y };
      const timer = window.setTimeout(async () => {
        setPendingErase((prev) => {
          const next = { ...prev };
          delete next[note.id];
          return next;
        });
        try {
          await dissolveNote(note.id);
          await refresh();
        } catch (err) {
          setError((err as Error).message);
          await refresh();
        }
      }, ERASE_UNDO_WINDOW_MS);
      setPendingErase((prev) => ({ ...prev, [note.id]: { x: pos.x, y: pos.y, timer } }));
    }, RUB_OUT_ANIMATION_MS);
  }

  // "undo?" — cancel the armed DELETE and un-hide the card. Nothing was
  // ever sent to the backend, so this is a pure local revert.
  function handleUndoErase(noteId: string) {
    setPendingErase((prev) => {
      const entry = prev[noteId];
      if (entry) window.clearTimeout(entry.timer);
      const next = { ...prev };
      delete next[noteId];
      return next;
    });
  }

  function handleDragStart(id: string, e: ReactPointerEvent) {
    e.stopPropagation();
    if (eraserMode) {
      const note = notes.find((n) => n.id === id);
      if (note) handleErase(note);
      return;
    }
    const start = toCanvasCoords(e.clientX, e.clientY);
    const pos = positions[id] ?? { x: 0, y: 0 };
    draggingRef.current = { id, offsetX: start.x - pos.x, offsetY: start.y - pos.y };
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  }

  // canvasRef is a stable ref object, so toCanvasCoords reading
  // canvasRef.current fresh on each call is safe even though these
  // callbacks are memoized once.
  const handleDragMove = useCallback((e: PointerEvent) => {
    const dragging = draggingRef.current;
    if (!dragging) return;
    const cur = toCanvasCoords(e.clientX, e.clientY);
    setPositions((prev) => ({
      ...prev,
      [dragging.id]: { x: cur.x - dragging.offsetX, y: cur.y - dragging.offsetY },
    }));
  }, []);

  const handleDragEnd = useCallback(() => {
    draggingRef.current = null;
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
  }, [handleDragMove]);

  // Notebook first: writing saves a plain note and that's ALL that
  // happens — no thread, no companion, no status. Classification runs
  // quietly afterward (never blocking the save); its only possible
  // outcome is the whisper affordance appearing on the card. Silence —
  // including a failed classify — is correct behavior. See
  // docs/DECISIONS.md ("Notebook first").
  async function handleCreateNote(text: string) {
    if (!draft) return;
    try {
      const note = await createNote({ text, x: draft.x, y: draft.y });
      setDraft(null);
      await refresh();
      classifyNote(note.id)
        .then(() => refresh())
        .catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSaveText(noteId: string, text: string) {
    try {
      await updateNoteText(noteId, text);
      await refresh();
      // Edited ink gets re-read: the backend reset task_like on the
      // text change, so re-classify quietly for the new text.
      classifyNote(noteId)
        .then(() => refresh())
        .catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Consent: the whisper tap or the note menu's "crack this". The only
  // path from plain ink into the loop machinery.
  async function handleCrackNote(note: Note) {
    setOpenThreadId(note.id);
    try {
      await peekNote(note.id);
      const msgs = await startThread(note.id);
      setThreads((prev) => ({ ...prev, [note.id]: msgs }));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setOpenThreadId((cur) => (cur === note.id ? null : cur));
    }
  }

  // Opening a loop (folded or already in progress) is "looking at it" for
  // Feature B's purposes — peek fires here, same trigger point as the old
  // "open" click, just now covering an in-progress loop's thread too, not
  // only a never-started one. Always re-fetches messages rather than
  // trusting a local cache, so a cascade-created message from another
  // thread (Feature C) is picked up on open. See docs/DECISIONS.md.
  async function handleOpenLoop(note: Note) {
    setOpenThreadId(note.id);

    if (note.status !== "done") {
      try {
        await peekNote(note.id);
      } catch (err) {
        setError((err as Error).message);
      }
    }

    try {
      let msgs = await listMessages(note.id);
      if (msgs.length === 0 && note.status === "folded") {
        msgs = await startThread(note.id);
      }
      setThreads((prev) => ({ ...prev, [note.id]: msgs }));
    } catch (err) {
      setError((err as Error).message);
    }

    if (note.status !== "done") {
      await refresh();
    }
  }

  function handleCloseThread() {
    setOpenThreadId(null);
  }

  function appendMessages(noteId: string, newMessages: Message[]) {
    setThreads((prev) => ({ ...prev, [noteId]: [...(prev[noteId] ?? []), ...newMessages] }));
  }

  async function handleAdvance(noteId: string) {
    try {
      const newMsgs = await advanceThread(noteId);
      appendMessages(noteId, newMsgs);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSendMessage(noteId: string, text: string) {
    try {
      const newMsgs = await sendThreadMessage(noteId, text);
      appendMessages(noteId, newMsgs);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Skip proposals ("this seems trivial, want to just close it out?") are
  // dissolved via the existing complete endpoint — a skip'd loop has no
  // children yet, so this is the same direct folded -> done path leaf
  // notes have always had.
  async function handleAcceptSkip(noteId: string) {
    try {
      await completeNote(noteId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeclineSkip(noteId: string, manualStepText: string) {
    try {
      const newMsgs = await manualFirstStep(noteId, manualStepText);
      appendMessages(noteId, newMsgs);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Refetches a single thread's messages — used after actions (keep,
  // link, decline) whose effect is "some earlier message's resolved flag
  // flipped," which isn't something appendMessages (built for brand-new
  // messages) can express as a local patch.
  async function refetchThread(noteId: string) {
    try {
      const msgs = await listMessages(noteId);
      setThreads((prev) => ({ ...prev, [noteId]: msgs }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Feature B, in-thread: "keep it" on a stale nudge.
  async function handleKeepStale(noteId: string) {
    try {
      await keepNote(noteId);
      await refetchThread(noteId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Feature B, in-thread: "let it go" — plays the crumple animation
  // (NoteCard's isDissolving prop) and only calls the actual, permanent
  // DELETE once it finishes, same pattern the original card-based
  // dissolve used.
  function handleDropStale(noteId: string) {
    setDissolvingId(noteId);
    window.setTimeout(async () => {
      try {
        await dissolveNote(noteId);
        setOpenThreadId((cur) => (cur === noteId ? null : cur));
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDissolvingId(null);
      }
    }, DISSOLVE_ANIMATION_MS);
  }

  // Feature C, in-thread: "link them" on a merge nudge.
  async function handleAcceptMerge(noteId: string, newNoteId: string, existingNoteId: string) {
    try {
      await linkNotes(newNoteId, existingNoteId);
      await refetchThread(noteId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Feature C, in-thread: "no thanks" on a merge nudge — nothing to
  // undo (accepting is the only action that changes anything), just
  // mark the prompt resolved so its buttons don't reoffer on reload.
  async function handleDeclineMerge(noteId: string, messageId: string) {
    try {
      await dismissMessage(messageId);
      await refetchThread(noteId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Open Loops</h1>
        {page === "v1" && <p className="app__hint">Double-click anywhere to write a note.</p>}
      </header>

      <PageTabs current={page} onChange={setPage} />

      {error && (
        <div className="app__error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {page === "v2" && (
        <InkPage notes={notes} refresh={refresh} onError={setError} />
      )}

      {page === "v3" && (
        <DicePage notes={notes} refresh={refresh} onError={setError} />
      )}

      {page === "v4" && (
        <FadePage notes={notes} refresh={refresh} onError={setError} />
      )}

      {page === "v1" && (
      <div
        className={`canvas${eraserMode ? " canvas--erasing" : ""}`}
        ref={canvasRef}
      >
        {notes.filter((n) => n.parent_id === null && !pendingErase[n.id]).length === 0 &&
          !draft && <p className="canvas__empty">a blank page — double-click and write</p>}

        <div
          className="canvas__surface"
          ref={surfaceRef}
          style={{ width: SURFACE_WIDTH, height: SURFACE_HEIGHT }}
          onDoubleClick={handleCanvasDoubleClick}
          onPointerDown={handlePanStart}
        >
        {notes
          .filter((note) => note.parent_id === null && !pendingErase[note.id])
          .map((note) => {
            const pos = positions[note.id] ?? { x: note.x, y: note.y };
            const isOpen = openThreadId === note.id;
            return (
              <NoteCard
                key={note.id}
                note={note}
                x={pos.x}
                y={pos.y}
                isOpen={isOpen}
                isDissolving={dissolvingId === note.id}
                isRubbing={rubbing[note.id] === true}
                onDragStart={handleDragStart}
                onOpen={handleOpenLoop}
                onCrack={handleCrackNote}
                onSaveText={handleSaveText}
              >
                {isOpen && (
                  <ChatThread
                    loop={note}
                    messages={threads[note.id] ?? []}
                    notes={notes}
                    readOnly={note.status === "done"}
                    onAdvance={() => handleAdvance(note.id)}
                    onSendMessage={(text) => handleSendMessage(note.id, text)}
                    onAcceptSkip={() => handleAcceptSkip(note.id)}
                    onDeclineSkip={(text) => handleDeclineSkip(note.id, text)}
                    onKeepStale={() => handleKeepStale(note.id)}
                    onDropStale={() => handleDropStale(note.id)}
                    onAcceptMerge={(newId, existingId) =>
                      handleAcceptMerge(note.id, newId, existingId)
                    }
                    onDeclineMerge={(msgId) => handleDeclineMerge(note.id, msgId)}
                    onClose={handleCloseThread}
                  />
                )}
              </NoteCard>
            );
          })}

        {draft && (
          <NewNoteInput
            x={draft.x}
            y={draft.y}
            onSubmit={handleCreateNote}
            onCancel={() => setDraft(null)}
          />
        )}

        {/* The undo whisper: sits where the erased note was, in the
            notebook's own handwriting — no dialog, just a fading
            second chance. */}
        {Object.entries(pendingErase).map(([id, entry]) => (
          <div key={id} className="erase-whisper" style={{ left: entry.x, top: entry.y }}>
            rubbed out —{" "}
            <button type="button" onClick={() => handleUndoErase(id)}>
              undo?
            </button>
          </div>
        ))}
        </div>
      </div>
      )}

      {/* The notebook, thinking. A quiet handwritten aside with a pen
          tapping ink — shows any slow in-flight action is working, so
          a cold backend or a Groq call never reads as frozen. See
          docs/DECISIONS.md ("Loading indicator"). */}
      {showBusy && (
        <div className="busy-indicator" role="status" aria-live="polite">
          <span className="busy-indicator__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>one moment…</span>
        </div>
      )}

      {/* The eraser: a physical object resting in the corner of the
          page, not a toolbar button. Click to pick it up, Esc or a
          second click to put it back. */}
      {page === "v1" && (
        <button
          type="button"
          className={`eraser-tool${eraserMode ? " eraser-tool--held" : ""}`}
          aria-label={eraserMode ? "put the eraser down" : "pick up the eraser"}
          aria-pressed={eraserMode}
          title={eraserMode ? "put it back (Esc)" : "eraser"}
          onClick={toggleEraser}
        />
      )}
    </div>
  );
}
