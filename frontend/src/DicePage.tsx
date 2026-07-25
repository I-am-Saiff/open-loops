import { useRef, useState } from "react";
import { advanceThread, peekNote } from "./api";
import type { Note } from "./types";

interface Props {
  notes: Note[];
  refresh: () => Promise<Note[] | null>;
  onError: (message: string) => void;
}

// Timings mirrored in App.css (@keyframes dice-roll / dare-in /
// dare-fold). The roll is long enough to feel like surrendered chance,
// not a lookup; see docs/DECISIONS.md ("v3 dice roll").
const ROLL_MS = 900;
const FOLD_MS = 400;

interface Dare {
  loop: Note;
  step: Note;
}

type Phase = "idle" | "rolling" | "thrown" | "folding";

export function DicePage({ notes, refresh, onError }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dare, setDare] = useState<Dare | null>(null);
  // 1 after the first throw, 2 after the one permitted re-roll — at 2
  // the die grays out. "Not today" resets to 0: declining by name is an
  // honest exit, not a dodge, so it buys back the dice. See
  // docs/DECISIONS.md ("v3 dice roll").
  const [rollsUsed, setRollsUsed] = useState(0);
  const [face, setFace] = useState(5);
  const timerRef = useRef<number | null>(null);

  // The die only chooses among cracked loops that already have a
  // face-up step — plain notes are ink, not candidates ("Notebook
  // first"), and folded loops would need a decompose (an LLM
  // round-trip) mid-roll, when the point of this page is zero deciding,
  // including "decide to crack this open."
  const candidates: Dare[] = notes
    .filter((n) => n.parent_id === null && n.kind === "loop" && n.status === "active")
    .flatMap((loop) => {
      const step = notes.find((c) => c.parent_id === loop.id && c.status === "active");
      return step ? [{ loop, step }] : [];
    });

  function roll(isReroll: boolean) {
    if (phase === "rolling" || candidates.length === 0) return;
    if (isReroll && rollsUsed >= 2) return;

    // A re-roll must land somewhere new when it can — re-rolling into
    // the same dare would feel rigged.
    const pool =
      isReroll && dare && candidates.length > 1
        ? candidates.filter((c) => c.step.id !== dare.step.id)
        : candidates;
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    setPhase("rolling");
    setDare(null);
    setFace(1 + Math.floor(Math.random() * 6));

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setDare(chosen);
      setPhase("thrown");
      setRollsUsed(isReroll ? 2 : 1);
      // The notebook just showed you this step — same avoidance-memory
      // signal as opening its thread.
      peekNote(chosen.loop.id).catch(() => undefined);
    }, ROLL_MS);
  }

  async function handleDone() {
    if (!dare) return;
    try {
      await advanceThread(dare.loop.id);
      await refresh();
      setDare(null);
      setPhase("idle");
      setRollsUsed(0);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  // Visual-only: the dare folds away and the die comes back. Nothing is
  // written to the backend — "not today" is a decision about today, not
  // about the loop.
  function handleNotToday() {
    setPhase("folding");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setDare(null);
      setPhase("idle");
      setRollsUsed(0);
    }, FOLD_MS);
  }

  const dieDisabled = candidates.length === 0 || (phase === "thrown" && rollsUsed >= 2);
  const showDie = phase === "idle" || phase === "rolling" || phase === "thrown";

  return (
    <div className="dice-page">
      {showDie && (
        <div className="dice-page__die-zone">
          <button
            type="button"
            className={[
              "die",
              phase === "rolling" && "die--rolling",
              phase === "thrown" && "die--small",
              dieDisabled && "die--spent",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={dieDisabled || phase === "rolling"}
            onClick={() => roll(phase === "thrown")}
            aria-label={phase === "thrown" ? "re-roll" : "roll the die"}
          >
            <span className={`die__face die__face--${face}`}>
              {Array.from({ length: face }, (_, i) => (
                <i key={i} className="die__pip" />
              ))}
            </span>
          </button>

          {phase === "idle" && candidates.length > 0 && (
            <p className="dice-page__whisper">roll it — the notebook picks, you don’t</p>
          )}
          {phase === "idle" && candidates.length === 0 && (
            <p className="dice-page__whisper">
              nothing to choose from — crack a loop open on another page first
            </p>
          )}
          {phase === "thrown" && rollsUsed < 2 && (
            <p className="dice-page__whisper">one re-roll, if you must</p>
          )}
          {phase === "thrown" && rollsUsed >= 2 && (
            <p className="dice-page__whisper dice-page__whisper--rules">no take-backs</p>
          )}
        </div>
      )}

      {dare && (phase === "thrown" || phase === "folding") && (
        <div className={`dare${phase === "folding" ? " dare--folding" : ""}`}>
          <p className="dare__step">{dare.step.text}</p>
          <p className="dare__source">from “{dare.loop.text}”</p>
          <div className="dare__actions">
            <button type="button" className="dare__done" onClick={handleDone}>
              done
            </button>
            <button type="button" className="dare__decline" onClick={handleNotToday}>
              not today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
