import { useState } from "react";
import type { Note } from "./types";

interface Props {
  lines: Note[];
  onAdd: (text: string) => void;
  onMakeLoop: (note: Note) => void;
}

// Brain dump (IA.md §Stage 1): get what's on your mind onto the page,
// one raw line at a time, with zero friction. A flat, unstructured list
// — no status, no ranking, no AI. The one quiet affordance per line,
// "Make a loop", surfaces on hover/focus only.
export function BrainDump({ lines, onAdd, onMakeLoop }: Props) {
  const [draft, setDraft] = useState("");

  function commit() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onAdd(text);
  }

  return (
    <div className="page__inner">
      <h2 className="page__title">Brain dump</h2>

      {lines.length === 0 && (
        <p className="page__empty">Empty page. Write what's on your mind.</p>
      )}

      <ul className="dump__list">
        {lines.map((n) => (
          <li key={n.id} className="dump__line">
            <span className="dump__text">{n.text}</span>
            <button
              type="button"
              className="dump__make-loop"
              onClick={() => onMakeLoop(n)}
            >
              Make a loop
            </button>
          </li>
        ))}
      </ul>

      <div className="dump__compose">
        <input
          className="dump__input"
          value={draft}
          placeholder="Write a line"
          aria-label="Write a line"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}
