import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { completeNote, advanceThread, listMessages, peekNote, startThread } from "./api";
import type { Note } from "./types";

interface Props {
  notes: Note[];
  refresh: () => Promise<Note[] | null>;
  onError: (message: string) => void;
}

// Total pointer travel (px) over a ghost stroke to fully develop it.
// ~2-3 deliberate back-and-forth swipes over a line of text — enough
// that it feels earned, not so much it becomes a chore. See
// docs/DECISIONS.md ("v2 ink reveal").
const REVEAL_TRAVEL_PX = 600;
// Per-pointermove-event distance cap, so a single fast flick (or a
// pointer teleporting across the element) can't skip the development.
const MAX_DELTA_PX = 40;
const MAX_BLUR_PX = 7;

// Ink develops the way curiosity needs it to: the blur falls off fast
// at the start (easeOut — the very first rub visibly stirs the ink,
// hooking you), while the opacity blooms late (easeIn — legibility is
// the payoff and it lands only near the end). See docs/DECISIONS.md.
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
function easeInQuad(t: number): number {
  return t * t;
}

interface GhostStroke {
  key: string; // step note id, or "skip:<loopId>" for a skip suggestion
  text: string;
}

export function InkPage({ notes, refresh, onError }: Props) {
  // Development progress per ghost stroke, 0..1, keyed by GhostStroke.key.
  // Keyed by the step's own id so completing a step automatically starts
  // the next one fully ghosted. Never decays — ink doesn't undevelop.
  const [progress, setProgress] = useState<Record<string, number>>({});
  // Skip suggestions ("this seems small enough to just do") revealed the
  // same way a step is — keyed by loop id, populated on crack-open.
  const [skipSuggestions, setSkipSuggestions] = useState<Record<string, string>>({});
  const lastPointRef = useRef<Record<string, { x: number; y: number }>>({});
  // Loops we've already peeked for this page-view — one peek per full
  // reveal, not one per pointermove.
  const peekedRef = useRef<Set<string>>(new Set());

  // Notebook first: only cracked loops exist on this page at all —
  // plain notes are ink on the v1 canvas and never surface here. See
  // docs/DECISIONS.md ("Notebook first").
  const topLoops = notes.filter((n) => n.parent_id === null && n.kind === "loop");
  const openLoops = topLoops.filter((n) => n.status !== "done");
  const doneLoops = topLoops.filter((n) => n.status === "done");

  function currentStep(loop: Note): Note | undefined {
    return notes.find((n) => n.parent_id === loop.id && n.status === "active");
  }

  // Mirrors v1's handleOpenLoop: reuse an existing thread if the loop
  // already has one (e.g. a skip_prompt left pending from the chat
  // page), otherwise start it — which decomposes and cracks open.
  async function handleCrackOpen(loop: Note) {
    try {
      await peekNote(loop.id);
      let msgs = await listMessages(loop.id);
      if (msgs.length === 0) {
        msgs = await startThread(loop.id);
      }
      const fetched = await refresh();
      const hasActiveChild = (fetched ?? []).some(
        (n) => n.parent_id === loop.id && n.status === "active"
      );
      if (!hasActiveChild) {
        const skip = [...msgs].reverse().find((m) => m.kind === "skip_prompt" && !m.resolved);
        if (skip) {
          setSkipSuggestions((prev) => ({ ...prev, [loop.id]: skip.text }));
        }
      }
    } catch (err) {
      onError((err as Error).message);
    }
  }

  function handleRub(stroke: GhostStroke, loopId: string, e: ReactPointerEvent) {
    const p = progress[stroke.key] ?? 0;
    if (p >= 1) return;

    const last = lastPointRef.current[stroke.key];
    lastPointRef.current[stroke.key] = { x: e.clientX, y: e.clientY };
    if (!last) return;

    const dist = Math.min(
      Math.hypot(e.clientX - last.x, e.clientY - last.y),
      MAX_DELTA_PX
    );
    const next = Math.min(1, p + dist / REVEAL_TRAVEL_PX);
    setProgress((prev) => ({ ...prev, [stroke.key]: next }));

    // Fully developing a step counts as "looking at it" for the
    // avoidance memory — one peek per reveal, same signal v1 sends
    // when a thread is opened.
    if (next >= 1 && !peekedRef.current.has(loopId)) {
      peekedRef.current.add(loopId);
      peekNote(loopId).catch(() => undefined);
    }
  }

  async function handleStepDone(loop: Note) {
    try {
      await advanceThread(loop.id);
      await refresh();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  // Skip suggestion accepted — same direct folded -> done path v1's
  // "accept skip" uses.
  async function handleSkipDone(loop: Note) {
    try {
      await completeNote(loop.id);
      await refresh();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  function renderGhost(stroke: GhostStroke, loop: Note, onDone: () => void) {
    const p = progress[stroke.key] ?? 0;
    const revealed = p >= 1;
    const blur = MAX_BLUR_PX * (1 - easeOutQuad(p));
    const opacity = 0.25 + 0.75 * easeInQuad(p);

    return (
      <div className="ink-ghost-row">
        <span
          className={`ink-ghost${revealed ? " ink-ghost--revealed" : ""}`}
          style={revealed ? undefined : { filter: `blur(${blur}px)`, opacity }}
          onPointerMove={(e) => handleRub(stroke, loop.id, e)}
          onPointerLeave={() => {
            delete lastPointRef.current[stroke.key];
          }}
        >
          {stroke.text}
        </span>
        {revealed && (
          <button type="button" className="ink-done" onClick={onDone}>
            ✓ done
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ink-page">
      <p className="ink-page__hint">
        something is written under each smudge — rub it to develop the ink
      </p>

      {openLoops.length === 0 && (
        <p className="ink-page__empty">nothing open — write a loop on the companion page</p>
      )}

      {openLoops.map((loop) => {
        const step = currentStep(loop);
        const skipText = skipSuggestions[loop.id];
        return (
          <div key={loop.id} className="ink-entry">
            <div className="ink-entry__title">{loop.text}</div>
            {step ? (
              renderGhost({ key: step.id, text: step.text }, loop, () => handleStepDone(loop))
            ) : skipText ? (
              renderGhost({ key: `skip:${loop.id}`, text: skipText }, loop, () =>
                handleSkipDone(loop)
              )
            ) : (
              <button
                type="button"
                className="ink-entry__crack"
                onClick={() => handleCrackOpen(loop)}
              >
                still folded — crack it open
              </button>
            )}
          </div>
        );
      })}

      {doneLoops.length > 0 && (
        <div className="ink-page__done">
          {doneLoops.map((loop) => (
            <div key={loop.id} className="ink-page__done-line">
              {loop.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
