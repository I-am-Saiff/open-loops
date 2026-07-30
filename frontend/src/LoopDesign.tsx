import { useEffect, useState } from "react";
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

// Loop design (IA.md §Stage 2): the one moment full scope is visible.
// The strict step-proposer runs on open (and on demand); the list is
// fully editable, or type your own; "Open loop" commits it via
// crack-open, after which scope collapses. No conversation, no persona.
export function LoopDesign({ note, onOpenLoop, onClose, onError }: Props) {
  const [steps, setSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [repeats, setRepeats] = useState<NoteRecurrence>("none");
  // A skip proposal ("this is a single step") — shown as a plain note;
  // the list is pre-filled with the one action so Open loop still works.
  const [skipNote, setSkipNote] = useState<string | null>(null);

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

  function setStep(i: number, text: string) {
    setSteps((prev) => prev.map((s, j) => (j === i ? text : s)));
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
        <p className="overlay__eyebrow">Design loop</p>
        <h2 className="overlay__title">{note.text}</h2>

        {skipNote && <p className="overlay__skip">{skipNote}</p>}

        <ol className="steps">
          {steps.map((step, i) => (
            <li key={i} className="steps__row">
              <span className="steps__ord">{String(i + 1).padStart(2, "0")}</span>
              <input
                className="steps__input"
                value={step}
                placeholder="Step"
                aria-label={`Step ${i + 1}`}
                onChange={(e) => setStep(i, e.target.value)}
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
            <p className="page__empty page__empty--tight">No steps yet. Add the first, or suggest steps.</p>
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
