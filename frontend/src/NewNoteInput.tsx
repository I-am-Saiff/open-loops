import { useEffect, useRef, useState } from "react";

interface Props {
  x: number;
  y: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function NewNoteInput({ x, y, onSubmit, onCancel }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit() {
    const trimmed = text.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  }

  return (
    <input
      ref={inputRef}
      className="new-note-input"
      style={{ left: x, top: y }}
      value={text}
      placeholder="New loop…"
      onChange={(e) => setText(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={commit}
    />
  );
}
