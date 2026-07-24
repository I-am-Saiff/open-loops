import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  advanceThread,
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
} from "./api";
import { ChatThread } from "./ChatThread";
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

  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

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

  function toCanvasCoords(clientX: number, clientY: number): Point {
    const el = canvasRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left + el.scrollLeft, y: clientY - rect.top + el.scrollTop };
  }

  function handleCanvasDoubleClick(e: React.MouseEvent) {
    if (e.target !== canvasRef.current) return; // ignore double-clicks on a card
    setDraft({ kind: "new-note", ...toCanvasCoords(e.clientX, e.clientY) });
  }

  function handleDragStart(id: string, e: ReactPointerEvent) {
    e.stopPropagation();
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

  async function handleCreateNote(text: string) {
    if (!draft) return;
    try {
      const note = await createNote({ text, x: draft.x, y: draft.y });
      setDraft(null);
      await refresh();
      await handleOpenLoop(note);
    } catch (err) {
      setError((err as Error).message);
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
        {page === "v1" && <p className="app__hint">Double-click empty canvas to add a loop.</p>}
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

      {(page === "v3" || page === "v4") && (
        <div className="page-placeholder">
          <p>this page hasn’t been written yet…</p>
        </div>
      )}

      {page === "v1" && (
      <div className="canvas" ref={canvasRef} onDoubleClick={handleCanvasDoubleClick}>
        {notes
          .filter((note) => note.parent_id === null)
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
                onDragStart={handleDragStart}
                onOpen={handleOpenLoop}
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
      </div>
      )}
    </div>
  );
}
