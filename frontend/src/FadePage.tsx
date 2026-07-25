import { useEffect, useState } from "react";
import { advanceThread, dissolveNote, peekNote } from "./api";
import type { Note } from "./types";

interface Props {
  notes: Note[];
  refresh: () => Promise<Note[] | null>;
  onError: (message: string) => void;
}

// DEMO-COMPRESSED timescale: full fade in 4 minutes so the mechanic is
// visible in a sitting. The real product would fade over days (the same
// scale Feature B's staleness uses). See docs/DECISIONS.md
// ("v4 shrinking page").
const FADE_WINDOW_MS = 4 * 60_000;
// The whisper floor — never quite zero: the page doesn't erase anything
// by itself, it only asks.
const FLOOR_OPACITY = 0.08;
// How often opacities recompute. Paired with a 1s linear CSS opacity
// transition so the fade reads as continuous, not stepped.
const TICK_MS = 5_000;
// Mirrored in App.css (@keyframes fade-reclaim) — the delete is
// deferred until the ink has fully left the page.
const FADE_OUT_MS = 900;

// Backend timestamps are naive UTC (no zone suffix); parsing them raw
// would treat them as local time and skew every elapsed-time
// computation by the UTC offset.
function parseUtc(iso: string): number {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`).getTime();
}

// Decay eases IN (t^1.7): freshly-touched ink barely fades for a while,
// then the decay accelerates toward the whisper floor — the rescue
// window feels urgent near the end without a badge, counter, or a drop
// of red. See docs/DECISIONS.md.
function inkOpacity(elapsedMs: number): number {
  const t = Math.min(1, elapsedMs / FADE_WINDOW_MS);
  return Math.max(FLOOR_OPACITY, 1 - 0.92 * Math.pow(t, 1.7));
}

export function FadePage({ notes, refresh, onError }: Props) {
  const [, setTick] = useState(0);
  const [fadingOutId, setFadingOutId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Notebook first: plain notes are ink and never fade — only cracked
  // loops are subject to the page's forgetting.
  const activeLoops = notes.filter(
    (n) => n.parent_id === null && n.kind === "loop" && n.status === "active"
  );

  // Time since the loop was last touched — a peek from ANY page counts
  // (v1 thread-open, v2 full reveal, v3 landed dare), as does the
  // current step being newly promoted.
  function lastTouchMs(loop: Note, step: Note): number {
    return Math.max(
      parseUtc(loop.created_at),
      loop.last_peeked_at ? parseUtc(loop.last_peeked_at) : 0,
      parseUtc(step.created_at)
    );
  }

  // Completing is the strongest interaction there is, so it also resets
  // the fade clock (peek), then advances through the same shared
  // orchestration as every other page.
  async function handleDone(loop: Note) {
    try {
      await peekNote(loop.id);
      await advanceThread(loop.id);
      await refresh();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  // The whisper's "touch it": re-ink, reset the clock, recommit.
  async function handleReInk(loop: Note) {
    try {
      await peekNote(loop.id);
      await refresh();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  // The whisper's "let it go": the page reclaims the ink — a gentle
  // fade to blank paper, deliberately NOT v1's crumple. Same
  // animate-then-DELETE pattern as the crumple, different feeling.
  function handleLetGo(loop: Note) {
    setFadingOutId(loop.id);
    window.setTimeout(async () => {
      try {
        await dissolveNote(loop.id);
        await refresh();
      } catch (err) {
        onError((err as Error).message);
      } finally {
        setFadingOutId(null);
      }
    }, FADE_OUT_MS);
  }

  return (
    <div className="fade-page">
      <p className="fade-page__hint">untended ink fades — the page forgets what you don’t rescue</p>

      {activeLoops.length === 0 && (
        <p className="fade-page__empty">nothing in progress — the page is blank</p>
      )}

      {activeLoops.map((loop) => {
        const step = notes.find((n) => n.parent_id === loop.id && n.status === "active");
        if (!step) return null;
        const doneSteps = notes.filter((n) => n.parent_id === loop.id && n.status === "done");

        const elapsed = Date.now() - lastTouchMs(loop, step);
        const opacity = inkOpacity(elapsed);
        const whispering = elapsed >= FADE_WINDOW_MS;

        return (
          <div
            key={loop.id}
            className={`fade-entry${fadingOutId === loop.id ? " fade-entry--reclaimed" : ""}`}
          >
            <div className="fade-entry__loop">{loop.text}</div>

            {doneSteps.map((d) => (
              <div key={d.id} className="fade-entry__done-stroke">
                {d.text}
              </div>
            ))}

            <div className="fade-entry__line" style={{ opacity }}>
              <span
                className="fade-entry__step"
                onClick={whispering ? () => handleReInk(loop) : undefined}
              >
                {step.text}
              </span>
              {!whispering && (
                <button
                  type="button"
                  className="fade-entry__check"
                  onClick={() => handleDone(loop)}
                >
                  ✓
                </button>
              )}
            </div>

            {whispering && (
              <div className="fade-entry__whisper">
                <button type="button" onClick={() => handleReInk(loop)}>
                  touch it to re-ink
                </button>
                <span className="fade-entry__whisper-sep">·</span>
                <button type="button" onClick={() => handleLetGo(loop)}>
                  let it go
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
