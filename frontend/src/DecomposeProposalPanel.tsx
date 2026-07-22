import { useEffect, useState } from "react";
import type { DecomposeProposal } from "./types";

interface Props {
  proposal: DecomposeProposal | "loading";
  onConfirmSteps: (steps: string[]) => void;
  onAcceptDissolve: () => void;
  onUseManualEntry: () => void;
}

// The LLM-proposed step list is editable before it's ever sent to
// crack-open — the user can rewrite, delete, reorder, or add steps.
// Confirming just calls the same crack-open the manual panel calls; this
// component never talks to the backend itself. See docs/DECISIONS.md.
export function DecomposeProposalPanel({
  proposal,
  onConfirmSteps,
  onAcceptDissolve,
  onUseManualEntry,
}: Props) {
  const [steps, setSteps] = useState<string[]>(
    proposal !== "loading" && proposal.type === "steps" ? proposal.steps : []
  );

  useEffect(() => {
    if (proposal !== "loading" && proposal.type === "steps") {
      setSteps(proposal.steps);
    }
  }, [proposal]);

  if (proposal === "loading") {
    return (
      <div className="decompose-panel" onPointerDown={(e) => e.stopPropagation()}>
        <p className="decompose-panel__status">thinking of a plan…</p>
        <button type="button" className="note-card__action--quiet" onClick={onUseManualEntry}>
          enter steps myself instead
        </button>
      </div>
    );
  }

  if (proposal.type === "skip") {
    return (
      <div className="decompose-panel" onPointerDown={(e) => e.stopPropagation()}>
        <p className="decompose-panel__suggestion">{proposal.suggestion}</p>
        <div className="decompose-panel__actions">
          <button type="button" onClick={onAcceptDissolve}>
            Accept &amp; dissolve
          </button>
          <button type="button" className="note-card__action--quiet" onClick={onUseManualEntry}>
            crack it open myself instead
          </button>
        </div>
      </div>
    );
  }

  function updateStep(index: number, text: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? text : s)));
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addStep() {
    setSteps((prev) => [...prev, ""]);
  }

  const finalSteps = steps.map((s) => s.trim()).filter(Boolean);

  return (
    <div className="decompose-panel" onPointerDown={(e) => e.stopPropagation()}>
      <p className="decompose-panel__hint">proposed steps — edit before confirming</p>
      <ol className="decompose-panel__steps">
        {steps.map((step, i) => (
          <li key={i}>
            <input value={step} onChange={(e) => updateStep(i, e.target.value)} />
            <button
              type="button"
              disabled={i === 0}
              aria-label="move step up"
              onClick={() => moveStep(i, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={i === steps.length - 1}
              aria-label="move step down"
              onClick={() => moveStep(i, 1)}
            >
              ↓
            </button>
            <button type="button" aria-label="remove step" onClick={() => removeStep(i)}>
              ×
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="note-card__action" onClick={addStep}>
        + add step
      </button>
      <div className="decompose-panel__actions">
        <button type="button" disabled={finalSteps.length === 0} onClick={() => onConfirmSteps(finalSteps)}>
          Crack it open
        </button>
        <button type="button" className="note-card__action--quiet" onClick={onUseManualEntry}>
          start over manually
        </button>
      </div>
    </div>
  );
}
