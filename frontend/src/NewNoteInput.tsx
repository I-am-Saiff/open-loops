import { useEffect, useRef, useState } from "react";

interface Props {
  x: number;
  y: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

// Writing, not form-filling: a multi-line textarea that wraps at
// roughly a note card's width and grows downward to fit — everything
// you've written stays visible, like ink on paper. Enter starts a new
// line; the note commits when you click elsewhere (blur) or press
// Cmd/Ctrl+Enter. See docs/DECISIONS.md ("Multi-line note writing").
export function NewNoteInput({ x, y, onSubmit, onCancel }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-grow: collapse then measure, so the box also shrinks back
  // when lines are deleted. No inner scrollbar, ever.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function commit() {
    const trimmed = text.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  }

  return (
    <textarea
      ref={inputRef}
      className="new-note-input"
      style={{ left: x, top: y }}
      value={text}
      rows={1}
      placeholder="write anything…"
      onChange={(e) => setText(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={commit}
    />
  );
}
