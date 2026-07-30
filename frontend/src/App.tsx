import { useCallback, useEffect, useState } from "react";
import { createNote, listNotes, subscribeBusy } from "./api";
import type { Note } from "./types";
import "./App.css";

// Surface the "working" indicator only if a request stays in flight past
// this — a warm request returns well under it, so fast actions stay
// silent. See docs/DECISIONS.md ("Loading indicator").
const BUSY_INDICATOR_DELAY_MS = 300;

// NOTE (Phase 2, commit 1): this is the reduced post-removal state — the
// dice/fade/companion mechanics and their canvas are gone. The three
// paged surfaces (Brain dump / Open loops / Closed loops) and the Loop
// design overlay are stood up in the next commit. See docs/IA.md.
export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showBusy, setShowBusy] = useState(false);

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

  async function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      await createNote({ text });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const lines = notes.filter((n) => n.parent_id === null);

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Open Loops</h1>
      </header>

      {error && (
        <div className="app__error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <main className="surface">
        <ul className="dump__list">
          {lines.map((n) => (
            <li key={n.id} className="dump__line">
              {n.text}
            </li>
          ))}
        </ul>

        {lines.length === 0 && <p className="surface__empty">Empty page. Write what's on your mind.</p>}

        <div className="dump__compose">
          <input
            className="dump__input"
            value={draft}
            placeholder="Write a line"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
        </div>
      </main>

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
