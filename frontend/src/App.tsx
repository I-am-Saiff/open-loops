import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  completeNote,
  crackOpen,
  createNote,
  decompose,
  dissolveNote,
  keepNote,
  linkNotes,
  listNotes,
  peekNote,
} from "./api";
import { MergeThread } from "./MergeThread";
import { NewNoteInput } from "./NewNoteInput";
import { NoteCard } from "./NoteCard";
import type { CrackOpenResponse, DecomposeProposal, Note } from "./types";
import "./App.css";

interface Point {
  x: number;
  y: number;
}

interface Draft extends Point {
  kind: "new-note";
}

// Feature C: a merge suggestion the user hasn't decided on yet. Only ever
// set once both ends are real, fog-of-war-visible notes — see
// docs/DECISIONS.md ("Feature C frontend").
interface PendingMergeLink {
  newId: string;
  existingId: string;
  existingStepText: string;
  otherLoopTitle: string;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  // Drag position overrides, keyed by note id. Local/session-only — there
  // is no endpoint yet to persist x/y after a drag. See docs/DECISIONS.md.
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Feature A: decompose proposals in flight or ready for a just-created
  // note, keyed by note id. Never persisted/refetched — this is purely a
  // client-side preview step before crack-open actually runs.
  const [proposals, setProposals] = useState<Record<string, DecomposeProposal | "loading">>({});
  const [mergeLink, setMergeLink] = useState<PendingMergeLink | null>(null);

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
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      void requestDecompose(note.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // LLM-proposed decomposition is the primary flow for a freshly created
  // loop; manual crack-open stays available as a fallback the whole time
  // (see NoteCard) and this never blocks note creation itself — a failed
  // decompose call just leaves no proposal, which silently falls back to
  // the manual "open" flow. See docs/DECISIONS.md ("Feature A").
  async function requestDecompose(id: string) {
    setProposals((prev) => ({ ...prev, [id]: "loading" }));
    try {
      const proposal = await decompose(id);
      setProposals((prev) => ({ ...prev, [id]: proposal }));
    } catch {
      dismissProposal(id);
    }
  }

  function dismissProposal(id: string) {
    setProposals((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleCrackOpen(id: string, steps: string[]): Promise<CrackOpenResponse | null> {
    try {
      const result = await crackOpen(id, steps);
      await refresh();
      return result;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }

  async function handleConfirmProposal(id: string, steps: string[]) {
    const proposal = proposals[id];
    const mergeSuggestion =
      proposal !== undefined && proposal !== "loading" && proposal.type === "steps"
        ? proposal.merge_suggestion
        : null;
    dismissProposal(id);

    const result = await handleCrackOpen(id, steps);
    if (!result || !mergeSuggestion) return;
    // Only the case where the matched new step happens to be the first
    // (front-facing) one is handled — if the user reordered/edited/
    // deleted that exact step, or the matched existing step isn't
    // currently fog-of-war-visible, we silently drop the suggestion
    // rather than draw a thread to something that isn't really there.
    // See docs/DECISIONS.md ("Feature C frontend").
    if (result.active_child.text !== mergeSuggestion.new_step) return;

    const fresh = await listNotes();
    const existingNote = fresh.find((n) => n.id === mergeSuggestion.existing_note_id);
    if (!existingNote) return;
    const otherLoop = fresh.find((n) => n.id === existingNote.parent_id);

    setMergeLink({
      newId: result.active_child.id,
      existingId: existingNote.id,
      existingStepText: mergeSuggestion.existing_step,
      otherLoopTitle: otherLoop?.text ?? "another loop",
    });
  }

  async function handleAcceptMerge() {
    if (!mergeLink) return;
    try {
      await linkNotes(mergeLink.newId, mergeLink.existingId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMergeLink(null);
    }
  }

  async function handleComplete(id: string) {
    try {
      await completeNote(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAcceptDissolve(id: string) {
    dismissProposal(id);
    await handleComplete(id);
  }

  // Feature B: avoidance memory.
  async function handlePeek(id: string) {
    try {
      await peekNote(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleKeep(id: string) {
    try {
      await keepNote(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Called only after NoteCard's crumple animation finishes playing —
  // this is the actual, irreversible delete. See docs/DECISIONS.md.
  async function handleDissolve(id: string) {
    try {
      await dissolveNote(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>Open Loops</h1>
        <p className="app__hint">Double-click empty canvas to add a loop.</p>
      </header>

      {error && (
        <div className="app__error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="canvas" ref={canvasRef} onDoubleClick={handleCanvasDoubleClick}>
        {notes.map((note) => {
          const pos = positions[note.id] ?? { x: note.x, y: note.y };
          return (
            <NoteCard
              key={note.id}
              note={note}
              x={pos.x}
              y={pos.y}
              onDragStart={handleDragStart}
              onCrackOpen={handleCrackOpen}
              onComplete={handleComplete}
              proposal={proposals[note.id]}
              onConfirmProposal={handleConfirmProposal}
              onDismissProposal={dismissProposal}
              onAcceptDissolve={handleAcceptDissolve}
              onPeek={handlePeek}
              onKeep={handleKeep}
              onDissolve={handleDissolve}
            />
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

        {mergeLink && (
          <MergeThread
            fromPos={positions[mergeLink.newId] ?? { x: 0, y: 0 }}
            toPos={positions[mergeLink.existingId] ?? { x: 0, y: 0 }}
            otherLoopTitle={mergeLink.otherLoopTitle}
            existingStepText={mergeLink.existingStepText}
            onAccept={handleAcceptMerge}
            onDismiss={() => setMergeLink(null)}
          />
        )}
      </div>
    </div>
  );
}
