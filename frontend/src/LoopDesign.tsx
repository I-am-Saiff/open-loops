import { useEffect, useRef, useState } from "react";
import { decomposeNote } from "./api";
import type { Note, NoteRecurrence } from "./types";

interface Props {
  note: Note;
  onOpenLoop: (steps: string[], recurrence: NoteRecurrence) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

const REPEAT_OPTIONS: { value: NoteRecurrence; label: string }[] = [
  { value: "none", label: "Never" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// Auto-grow a step textarea to fit its wrapped text — a long step wraps
// and stays fully visible instead of clipping like a single-line input.
function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// Loop design (IA.md §Stage 2): the one moment full scope is visible.
// The strict step-proposer runs on open (and on demand); the list is
// fully editable, or type your own; "Open loop" commits it via
// crack-open, after which scope collapses.
//
// Presentation (DESIGN.md §6): this is the crack-open moment made
// visible, so the panel belongs to the ink world — the loop-mark
// unspools (draws itself) at the top, its thread runs down the margin
// connecting the steps, the title dries from wet ink, and the steps
// rise in with a small stagger. Function is unchanged: full steps for
// review/edit, Repeats, Open loop.
export function LoopDesign({ note, onOpenLoop, onClose, onError }: Props) {
  const [steps, setSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [repeats, setRepeats] = useState<NoteRecurrence>("none");
  // A skip proposal ("this is a single step") — shown as a plain note;
  // the list is pre-filled with the one action so Open loop still works.
  const [skipNote, setSkipNote] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  async function suggest() {
    setLoading(true);
    setSkipNote(null);
    try {
      const proposal = await decomposeNote(note.id);
      if (proposal.type === "steps") {
        setSteps(proposal.steps);
      } else {
        setSkipNote(proposal.suggestion);
        setSteps([note.text]);
      }
    } catch {
      // The stage never blocks on the proposer — fall back to manual
      // entry silently (IA.md). Start an empty line to type into.
      setSteps((prev) => (prev.length ? prev : [""]));
    } finally {
      setLoading(false);
    }
  }

  // Propose on open — "on entering design" (IA.md). Runs once per note.
  useEffect(() => {
    suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Size every step textarea to its content whenever the list content
  // changes. Depending on `steps` (not just its length) matters: a
  // multiline paste is cleaned to one line in state, and the re-measure
  // must run AFTER React applies the cleaned value, or the box keeps the
  // pasted multi-line height forever. Also on viewport resize/rotation:
  // a narrower box re-wraps its text, so heights must be re-measured.
  useEffect(() => {
    function sizeAll() {
      const list = listRef.current;
      if (!list) return;
      for (const el of list.querySelectorAll("textarea")) autosize(el);
    }
    sizeAll();
    window.addEventListener("resize", sizeAll);
    return () => window.removeEventListener("resize", sizeAll);
  }, [steps, loading]);

  function setStep(i: number, text: string) {
    // Steps are single actions — no newlines.
    const clean = text.replace(/\n/g, " ");
    setSteps((prev) => prev.map((s, j) => (j === i ? clean : s)));
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, j) => j !== i));
  }
  function addStep() {
    setSteps((prev) => [...prev, ""]);
  }

  function openLoop() {
    const cleaned = steps.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      onError("Add at least one step, or suggest steps.");
      return;
    }
    onOpenLoop(cleaned, repeats);
  }

  const hasStep = steps.some((s) => s.trim());

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Design loop">
      <div className="overlay__backdrop" onClick={onClose} />
      <div className="overlay__panel">
        <div className="overlay__head">
          {/* The loop-mark, unspooling: the stroke draws itself open as
              the panel rises — this is the crack, made visible once. */}
          <span className="overlay__mark" aria-hidden="true">
            <svg width="30" height="22" viewBox="0 0 30 22" fill="none">
              <path
                className="overlay__mark-path"
                d="M15 16.5c-4.2 0-6.5-2.2-6.5-5S11 6 14.5 6s6 2.2 6 4.8c0 3.2-3.4 5.4-8 5.4-3.1 0-5.5-1.1-5.5-1.1"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <p className="overlay__eyebrow">Design loop</p>
        </div>
        <h2 className="overlay__title">{note.text}</h2>

        {skipNote && <p className="overlay__skip">{skipNote}</p>}

        {/* The unspooled thread runs down the margin, tying the steps to
            the mark above — scope, laid out on one string, once. */}
        <ol className="steps" ref={listRef}>
          {steps.map((step, i) => (
            <li key={i} className="steps__row">
              <span className="steps__ord">{String(i + 1).padStart(2, "0")}</span>
              <textarea
                className="steps__input"
                value={step}
                rows={1}
                placeholder="Step"
                aria-label={`Step ${i + 1}`}
                onChange={(e) => {
                  setStep(i, e.target.value);
                  autosize(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
              <button
                type="button"
                className="steps__remove"
                aria-label={`Remove step ${i + 1}`}
                onClick={() => removeStep(i)}
              >
                ×
              </button>
            </li>
          ))}
          {steps.length === 0 && !loading && (
            <p className="page__empty page__empty--tight">
              No steps yet. Add the first, or suggest steps.
            </p>
          )}
        </ol>

        <div className="steps__tools">
          <button type="button" className="btn btn--text" onClick={addStep}>
            Add step
          </button>
          <button type="button" className="btn btn--text" onClick={suggest} disabled={loading}>
            {loading ? "Suggesting…" : "Suggest steps"}
          </button>
        </div>

        <div className="repeats">
          <span className="repeats__label">Repeats</span>
          <div className="repeats__options" role="radiogroup" aria-label="Repeats">
            {REPEAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={repeats === opt.value}
                className={`repeats__option${repeats === opt.value ? " repeats__option--on" : ""}`}
                onClick={() => setRepeats(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overlay__actions">
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn" onClick={openLoop} disabled={!hasStep}>
            Open loop
          </button>
        </div>
      </div>
    </div>
  );
}
