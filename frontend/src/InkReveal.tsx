import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { Note } from "./types";

// The signature (DESIGN.md §6, IA.md "crack it open"). A folded loop is a
// closed ink loop-mark; on press it unspools into the one live step as an
// undeveloped smudge, which you develop into a sharp legible line through
// deliberate effort. Blur eases OUT (the first effort visibly stirs the
// ink — the hook); opacity eases IN (legibility, the payoff, lands only
// at the end). The line inks up in wet accent and dries to settled ink.
// This is the one place the app spends its boldness.

// ~2–3 deliberate rub-swipes of travel to fully develop, or a sustained
// hold; per-event travel is capped so one fast flick can't cash it in.
const REVEAL_TRAVEL_PX = 600;
const MAX_DELTA_PX = 40;
const HOLD_MS_MOUSE = 700;
const HOLD_MS_TOUCH = 1000;
const MAX_BLUR_PX = 7;
const MIN_OPACITY = 0.22;
// Touch only: a hold must survive this before it develops, so a stray
// brush over the mark doesn't trigger it. The cancel threshold separates
// a fling (which hands the gesture to the pager) from a press: a real
// thumb settling into a press — even one that starts rubbing right away —
// stays well under 24px in 90ms (~270px/s), while a genuine page fling
// runs an order of magnitude faster.
const ARM_DELAY_MS = 90;
const ARM_CANCEL_PX = 24;

// Blur out, opacity in — deliberately opposite curves (DESIGN.md §5).
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
function easeInQuad(t: number): number {
  return t * t;
}

// Best-effort haptic ramp. navigator.vibrate is honored on Android; iOS
// Safari has no web haptic API and ignores it (documented in DECISIONS).
function haptic(ms: number): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(ms);
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

interface Props {
  step: Note;
  onDone: () => void;
  // Touch paging must not fight a develop: once a hold commits, the
  // parent pager is locked until release.
  lockPager: (locked: boolean) => void;
}

// Keyed by step.id in OpenLoops, so completing a step remounts this fresh
// (next step starts folded — unrevealed by construction).
export function InkReveal({ step, onDone, lockPager }: Props) {
  const prefersReduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0);
  const [started, setStarted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // A quiet "rub to reveal" hint for first-timers — the folded mark alone
  // doesn't say it's interactive. Shown only until the user develops their
  // first step ever, then it stays out of the way forever.
  const [showHint] = useState(() => localStorage.getItem("ol.developedOnce") !== "1");

  const progressRef = useRef(0);
  const activeRef = useRef(false);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTsRef = useRef(0);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const holdMsRef = useRef(HOLD_MS_MOUSE);
  const armTimerRef = useRef<number | undefined>(undefined);
  const downPtRef = useRef<{ x: number; y: number } | null>(null);
  const startedHapticRef = useRef(false);
  const rootRef = useRef<HTMLButtonElement>(null);
  const docGuardRef = useRef<((e: TouchEvent) => void) | null>(null);
  // The single pointer that owns the gesture — a stray second finger must
  // not add rub travel, restart the hold, or end the develop.
  const pointerIdRef = useRef<number | null>(null);
  // One-shot document release installed by finish(): the reveal swaps the
  // button out while the finger is still down, so the button's own
  // pointerup never fires — the locks must release at the actual lift.
  const liftReleaseRef = useRef<(() => void) | null>(null);

  // REAL-iOS scroll lock. CSS touch-action + React pointer events are not
  // enough on iOS Safari: React's root-attached touch listeners are
  // passive (preventDefault is a no-op there), and Safari doesn't reliably
  // honor touch-action:none on a descendant of a scrollable page — so the
  // thumb's micro-movement starts a native scroll/rubber-band, the layout
  // shifts, and Safari pointercancels the develop. The only dependable
  // mechanism is a NATIVE non-passive touchmove listener that
  // preventDefault()s the gesture before a scroll ever starts.
  //
  // Swipes still pass through: pointermove fires before the matching
  // touchmove, so a fast flick cancels the arm (and unlocks the pager)
  // first and its touchmove is NOT prevented — the pager, which armed on
  // the same pointerdown, takes the gesture over and turns the page.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    function onNativeTouchMove(e: TouchEvent) {
      if ((armTimerRef.current !== undefined || activeRef.current) && e.cancelable) {
        e.preventDefault();
      }
    }
    el.addEventListener("touchmove", onNativeTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onNativeTouchMove);
    // Re-attach when the folded button remounts (revealed toggles the tree).
  }, [revealed]);

  // While a develop is actively running, freeze the whole document —
  // covers a second finger, scroll chaining, and body rubber-banding.
  // Engaged in beginDevelop, released on pointer lift / unmount.
  function addDocGuard() {
    if (docGuardRef.current) return;
    const guard = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    docGuardRef.current = guard;
    document.addEventListener("touchmove", guard, { passive: false });
  }
  function removeDocGuard() {
    if (!docGuardRef.current) return;
    document.removeEventListener("touchmove", docGuardRef.current);
    docGuardRef.current = null;
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
      if (liftReleaseRef.current) liftReleaseRef.current();
      removeDocGuard();
      lockPager(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockPager]);

  // Advance progress and reveal when it reaches full. Progress never
  // decreases — a partial smudge never decays.
  function addProgress(inc: number) {
    if (inc <= 0 || !activeRef.current) return;
    progressRef.current = Math.min(1, progressRef.current + inc);
    setProgress(progressRef.current);
    if (progressRef.current >= 1) finish();
  }

  // Time-based accrual for a sustained hold. (Rubbing is applied
  // immediately in onPointerMove, so it develops even if rAF is throttled
  // — e.g. a backgrounded tab.)
  function tick() {
    if (!activeRef.current) return;
    const now = performance.now();
    const dt = now - lastTsRef.current;
    lastTsRef.current = now;
    addProgress(dt / holdMsRef.current);
    if (activeRef.current) rafRef.current = requestAnimationFrame(tick);
  }

  function beginDevelop() {
    if (revealed || activeRef.current) return;
    activeRef.current = true;
    setStarted(true);
    lastTsRef.current = performance.now();
    if (!startedHapticRef.current) {
      haptic(8); // light tick — effort has begun
      startedHapticRef.current = true;
    }
    lockPager(true);
    addDocGuard(); // page completely still until the thumb lifts
    rafRef.current = requestAnimationFrame(tick);
  }

  function finish() {
    activeRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    progressRef.current = 1;
    setProgress(1);
    setRevealed(true);
    markDevelopedOnce();
    haptic(24); // medium — legible
    // setRevealed swaps this button out of the tree while the finger is
    // still down, so the button's own pointerup will NEVER fire. Without
    // an explicit release the document guard and pager lock stay stuck —
    // the whole app frozen for touch until the next remount. Release at
    // the actual lift via a one-shot document listener (capture, so it
    // runs before anything else sees the pointerup); trailing movement
    // stays swallowed until then, keeping the page still to the end.
    const release = () => {
      liftReleaseRef.current = null;
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      lockPager(false);
      removeDocGuard();
    };
    liftReleaseRef.current = release;
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
  }

  function stopWithoutReveal() {
    activeRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    // progress is retained — a partial smudge never decays.
  }

  function revealInstantly() {
    progressRef.current = 1;
    setProgress(1);
    setStarted(true);
    setRevealed(true);
    markDevelopedOnce();
  }

  function markDevelopedOnce() {
    localStorage.setItem("ol.developedOnce", "1");
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (revealed) return;
    // One pointer owns the gesture. A second finger landing on the row
    // must not restart the hold, overwrite the rub anchors, or later end
    // the develop when it lifts.
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    holdMsRef.current = e.pointerType === "touch" ? HOLD_MS_TOUCH : HOLD_MS_MOUSE;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // A synthetic/ended pointer can't be captured — harmless.
    }
    const pt = { x: e.clientX, y: e.clientY };
    downPtRef.current = pt;
    lastPtRef.current = pt;
    // Reduced motion: no develop gesture — a plain tap reveals on release
    // (guarded against swipes in onPointerUp). No lock, so swipes page.
    if (prefersReduced) return;
    if (e.pointerType === "touch") {
      // Lock the pager NOW, not at arm-fire: the pointerdown continues to
      // bubble (no stopPropagation), so the pager records its own start
      // point but is held from acting. If the arm cancels (the finger is
      // swiping, not pressing), we unlock and the pager takes over from
      // its original start point — a seamless handoff, so flicks that
      // start on this row still turn the page instead of dying.
      lockPager(true);
      armTimerRef.current = window.setTimeout(beginDevelop, ARM_DELAY_MS);
    } else {
      beginDevelop();
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (e.pointerId !== pointerIdRef.current) return;
    const pt = { x: e.clientX, y: e.clientY };
    // Before a hold commits, a large move means a swipe — cancel the arm
    // and hand the gesture back to the pager (unlock).
    if (armTimerRef.current && downPtRef.current) {
      const d = Math.hypot(pt.x - downPtRef.current.x, pt.y - downPtRef.current.y);
      if (d > ARM_CANCEL_PX) {
        window.clearTimeout(armTimerRef.current);
        armTimerRef.current = undefined;
        lockPager(false);
        return;
      }
    }
    if (!activeRef.current) return;
    if (lastPtRef.current) {
      const d = Math.min(
        Math.hypot(pt.x - lastPtRef.current.x, pt.y - lastPtRef.current.y),
        MAX_DELTA_PX
      );
      addProgress(d / REVEAL_TRAVEL_PX); // rubbing develops immediately
    }
    lastPtRef.current = pt;
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (e.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    if (armTimerRef.current) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = undefined;
    }
    // Reduced motion: a TAP reveals on release — a swipe (which the pager
    // is free to page, since we never locked) must not.
    if (!revealed) {
      if (prefersReduced) {
        const down = downPtRef.current;
        const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
        if (moved <= ARM_CANCEL_PX) revealInstantly();
      } else {
        stopWithoutReveal();
      }
    }
    // Always release the pager and the document freeze on lift.
    lockPager(false);
    removeDocGuard();
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (revealed) return;
    // Keyboard / assistive tech can't rub — activating reveals this one
    // step instantly. Fog of war holds: only this step, never full scope.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      revealInstantly();
    }
  }

  if (revealed) {
    return (
      <div className="reveal reveal--revealed">
        <p className="reveal__line reveal__line--dry">{step.text}</p>
        <button type="button" className="btn btn--text reveal__done" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  const blur = MAX_BLUR_PX * (1 - easeOutQuad(progress));
  const opacity = MIN_OPACITY + (1 - MIN_OPACITY) * easeInQuad(progress);

  return (
    <button
      ref={rootRef}
      type="button"
      className={`reveal reveal__target${started ? " reveal--developing" : ""}`}
      aria-label="Reveal next step"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="reveal__mark" aria-hidden="true">
        <svg width="30" height="22" viewBox="0 0 30 22" fill="none">
          <path
            d="M15 16.5c-4.2 0-6.5-2.2-6.5-5S11 6 14.5 6s6 2.2 6 4.8c0 3.2-3.4 5.4-8 5.4-3.1 0-5.5-1.1-5.5-1.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {showHint && (
        <span className="reveal__hint" aria-hidden="true">
          rub to reveal
        </span>
      )}
      <span
        className="reveal__line"
        style={{ filter: `blur(${blur}px)`, opacity: started ? opacity : 0 }}
        aria-hidden="true"
      >
        {step.text}
      </span>
    </button>
  );
}
