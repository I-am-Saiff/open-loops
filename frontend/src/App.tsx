import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { completeNote, crackOpen, createNote, listNotes } from "./api";
import { NewNoteInput } from "./NewNoteInput";
import { NoteCard } from "./NoteCard";
import type { Note } from "./types";
import "./App.css";

interface Point {
  x: number;
  y: number;
}

interface Draft extends Point {
  kind: "new-note";
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  // Drag position overrides, keyed by note id. Local/session-only — there
  // is no endpoint yet to persist x/y after a drag. See docs/DECISIONS.md.
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      await createNote({ text, x: draft.x, y: draft.y });
      setDraft(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCrackOpen(id: string, steps: string[]) {
    try {
      await crackOpen(id, steps);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
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
      </div>
    </div>
  );
}
