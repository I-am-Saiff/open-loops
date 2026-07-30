# Open Loops — Information Architecture (Phase 1)

Status: **proposal for approval.** No app code changes in this phase. This
document defines structure and flow only; it builds strictly on the approved
[docs/DESIGN.md](DESIGN.md) and does not revisit any visual token (palette,
type, radii, motion curves — all inherited unchanged).

The product is the narrowed single-mechanic build from Phase 0: a notebook of
loops governed by **fog of war** (only the single next step is ever visible),
whose signature is **undeveloped ink you develop into a legible line**.

---

## The workflow

The client specified a four-stage flow:

```
Brain dump  →  Loop design  →  Open loops  →  Closed loops
  capture       plan once        work           record
```

An item is one *thing on your mind*. It enters as a raw line, is shaped once
into a loop with hidden scope, is worked one cracked-open step at a time, and
comes to rest as a record. The flow is linear on the way in and repeating on
the way through: you return to Brain dump to capture, and to Open loops to
work, constantly; Loop design and Closed loops you pass through.

---

## Screens vs. states — recommendation

**Recommendation: three horizontally-paged surfaces — Brain dump · Open loops ·
Closed loops — with Loop design as a transient focused overlay that rises over
whichever page you're on.**

Not four peer tabs, and not one long scroll. Reasoning, tied to the client's
Apple-minimalist, linear, calm intent:

- **Four equal tabs would fight the flow.** A tab bar says "four parallel
  places, jump anywhere." The stages aren't parallel — they're a pipeline with
  a direction. Tabs also invite you to sit on a screen that shows scope, which
  is exactly what fog of war exists to prevent.
- **Paged surfaces make the line physical.** Three full-bleed pages you move
  between left-to-right (Dump → Open → Closed) turn the workflow into a place
  you walk through, with a single restrained page marker (three ink dots, per
  DESIGN.md's annotation style) as the only chrome. This is the Apple pattern
  for a small fixed set of surfaces (paged home screens, Weather), and it is
  calm: one surface fills the view, nothing competes.
- **Touch-native and desktop-native from one model.** On mobile the pages are a
  horizontal swipe; on desktop, ← / → arrow keys or a click on the marker. No
  separate navigation to design for the mobile validation build.
- **Loop design is a moment, not a place.** You only ever design *one* loop, and
  only *briefly* — it is the single point in the whole product where full scope
  is visible. Making it a page you can loiter on would leave scope on screen;
  making it a focused overlay that you commit and dismiss matches "see the whole
  thing once, then it's folded away." So it remains one of the four conceptual
  stages, but it is presented as a transient state rather than a fourth page.

Default surface on launch is **Open loops** (the place you live). Brain dump
sits one page to its left (capture is always one swipe away); Closed loops one
page to its right (out of the way, never in your face).

```
   ┌────────────┐   ┌────────────┐   ┌────────────┐
   │ Brain dump │ ← │ Open loops │ → │  Closed    │
   │            │   │  (home)    │   │  loops     │
   └────────────┘   └─────┬──────┘   └────────────┘
                          │
                    ┌─────┴──────┐
                    │Loop design │  transient overlay,
                    │ (overlay)  │  rises from Dump or Open
                    └────────────┘
        page marker:   ● ○ ○   /   ○ ● ○   /   ○ ○ ●
```

---

## Stage 1 — Brain dump

**Job:** Get what's on your mind onto the page, one raw line at a time, with
zero friction and zero commitment.

**On screen:** A near-empty page. A live text line where the cursor waits;
above or below it, the raw lines you've already written, each a single line of
plain ink — no checkboxes, no status dots, no priority, no timestamps, no drag
ranking. Ranking or grouping here would mean *evaluating* scope, which is the
avoidance trigger; the dump stays deliberately flat and unstructured. Each line
carries one quiet affordance — **Make a loop** — surfaced only on hover
(desktop) or when the line is tapped (mobile), never persistently, so the
default reading of the page is "just my thoughts," not "a list of tasks
demanding triage."

```
┌─────────────────────────────────────────────┐
│  Brain dump                          ● ○ ○   │
│                                               │
│   finish the grant application                │
│   book dentist                                │
│   fix the leaking tap          ⤴ make a loop  │  ← on focus only
│   reply to landlord                           │
│   ▏                                           │  ← write the next line
│                                               │
└─────────────────────────────────────────────┘
```

**Enters:** The user types a line and commits it (Enter starts a new line; a
line is saved on blur or the next Enter). This is also the product's front
door — a first-run user lands here with an empty page.

**Leaves:** Choosing **Make a loop** on a line lifts it into the Loop design
overlay. The raw line is not deleted until the loop is committed, so backing out
of design leaves the thought safely on the page. A line the user never promotes
just stays a note here indefinitely — not everything on your mind is a task.

**AI at this stage:** **None.** Capture is silent and instant. There is no
auto-classification, no "this looks like a task" nudge, no suggestion — the old
build's whisper-on-save is removed. The decision that a line is worth becoming a
loop is the user's alone. (This is a deliberate strictness: the one moment the
product must never editorialize is the moment you're emptying your head.)

**Empty state:** *"Empty page. Write what's on your mind."*

---

## Stage 2 — Loop design

**Job:** Shape one raw line into a loop — a title and an ordered set of steps —
in the single moment the product ever shows full scope.

**On screen:** A focused overlay over a dimmed page. The loop **title** (the
promoted line, editable, set in the Newsreader ink voice). Below it, the
**steps**: either an AI-proposed ordered list you edit, or an empty list you
type into. Steps can be added, edited, reordered, and removed. One optional
**Repeats** control. One commit action, **Open loop**. Nothing else — this is a
planning surface, not a settings panel.

```
        ┌───────────────────────────────────┐
        │  Design loop                      │
        │                                   │
        │  Finish the grant application     │  ← title (editable)
        │  ───────────────────────────────  │
        │  1   Reread the brief             │
        │  2   Draft the budget section     │
        │  3   Write the one-page summary   │
        │  4   Proofread and submit         │
        │  +   Add step                     │
        │                                   │
        │  Repeats    ● Never   ○ Weekly …  │
        │                                   │
        │              [ Open loop ]        │
        └───────────────────────────────────┘
```

**Enters:** From **Make a loop** in Brain dump. (Also the destination of a
loop's *first* crack in Open loops if a loop was opened with no steps — but the
normal path is from the dump.)

**Leaves:** **Open loop** commits the design: the loop moves to Open loops, its
scope collapses, and it appears there as a single folded **loop-mark**. This
collapse is the psychological hinge of the whole product — you saw the mountain
for one deliberate moment, agreed to it, and now it's hidden again so only the
first foothold will surface when you choose to crack it.

**AI at this stage:** **Step proposal only — and this is the *only* stage where
AI appears at all.** On entering design (or on demand via **Suggest steps**), it
proposes an ordered step list by decomposing the title, or returns *no steps
needed* for a line that's already a single action (which becomes a one-step loop
you can close directly). The proposal is a plain editable list — accept it, edit
it, reorder it, throw it away and type your own. It is strictly functional:
there is no conversation, no back-and-forth, no message thread, no personality,
no first-person voice. It hands you a list and gets out of the way. If it fails
or is offline, the manual list is already there — the stage never blocks on it.

**Empty state:** (the steps list, before anything is proposed or typed)
*"No steps yet. Add the first, or suggest steps."*

---

## Stage 3 — Open loops

**Job:** Do the work one foothold at a time — crack open a loop to reveal its
single next step, act on it, mark it done.

**On screen:** The working surface, and the home page. Every open loop sits as a
small closed **loop-mark** (DESIGN.md's signature glyph) placed freely on the
page — a calm field of marks, no visible text, no counts, no progress bars,
nothing that reveals how much any loop holds. Cracking one open unspools its
mark into the **one live step**: undeveloped ink you develop into a sharp line
(see *The signature in the flow* below). Exactly one step is ever developed at a
time; it is the only element on the page with a surface, elevation, and the
wet-ink accent. After you mark it done, the loop folds back to a mark and the
next step waits — unseen — behind another crack.

```
┌─────────────────────────────────────────────┐
│  Open loops                          ○ ● ○   │
│                                               │
│      ◜◝              ◜◝                        │  ← folded loop-marks
│      ◟◞              ◟◞                        │     (scope hidden)
│                                               │
│           ┌─────────────────────────┐         │
│           │  Draft the budget        │        │  ← the ONE cracked,
│           │  section                 │        │     developed step
│           │                     ✓    │        │     (accent, raised;
│           └─────────────────────────┘         │      ✓ fades in after)
│      ◜◝                                        │
│      ◟◞                                        │
└─────────────────────────────────────────────┘
```

**Enters:** From **Open loop** in Loop design (a freshly designed loop), or from
a recurring loop regenerating at its interval (see *Recurrence*). Both arrive
folded — a new loop-mark on the page.

**Leaves:** Marking a step **Done** promotes the next step (kept hidden until
cracked). When the *last* step is marked done, the loop closes and moves to
Closed loops. A one-step / "no steps needed" loop closes on its single Done.

**AI at this stage:** **None.** No nudges, no reminders, no stale-shaming, no
"what's next" assistance, no companion messages appearing in-context. The old
build's stale prompts, merge suggestions, and backlog-pressure tone are all
removed — they were the assistant personality the client rejected. Fog of war
and the reveal do the entire job here; the surface is silent.

**Empty state:** *"Nothing open. Turn a brain-dump line into a loop."*

---

## Stage 4 — Closed loops

**Job:** Keep a quiet, honest record of what you finished — reachable, never in
the way.

**On screen:** A low-contrast list of completed loops, most-recent first, in
muted ink. Each row is the loop title with a mono-annotation date (DESIGN.md's
utility voice). Recurring loops are marked as returning. This surface is
deliberately the quietest in the product: full-`--ink` contrast and elevation
belong to the *live* step on Open loops, and a page of finished work must never
out-shout the one thing you're doing now. There is no re-open, no edit, no
metrics dashboard — a closed loop is history, and history is read, not managed.

```
┌─────────────────────────────────────────────┐
│  Closed loops                        ○ ○ ●   │
│                                               │
│   Finish the grant application    JUL 28      │
│   Book dentist                    JUL 27      │
│   Water the plants     ↻ weekly   JUL 26      │  ← recurring: will return
│   Reply to landlord               JUL 26      │
│                                               │
└─────────────────────────────────────────────┘
```

**Enters:** A loop's last step is marked done in Open loops.

**Leaves:** A non-recurring loop never leaves — it rests here permanently. A
recurring loop's *record* also stays here permanently (each completed instance
is its own immutable row); separately, a fresh instance is scheduled back into
Open loops at the next interval (see below).

**AI at this stage:** **None.**

**Empty state:** *"Nothing closed yet. Finished loops collect here."*

---

## The signature in the flow — crack it open

The signature lives in **Open loops**, and it is the one gesture the product is
remembered by. A folded loop-mark **unspools into a developing line of ink that
you rub into legibility.** Unspool and develop are one continuous act — "cracking
it open." Per DESIGN.md: blur eases *out* (the first effort visibly stirs the
ink — instant proof it's working), opacity eases *in* (legibility, the payoff,
lands only near the end), progress never decays, and on full reveal a
`--dur-settle` (260ms) "drying" transition settles the wet-ink accent toward
resting ink and the ✓ **Done** affordance fades in *after*.

Effort is required on purpose: revealing a step is something you *did*, which is
what gives you ownership of it. The tuning target is ~500–600px of deliberate
motion, or ~700ms of sustained press — under a second of real work, never a
chore. Each *new* step is a fresh crack; the current step, once developed, stays
legible until you mark it done, then the loop re-folds to a mark. You never see
even the next foothold until you choose to.

### Desktop (cursor)

- **Primary — rub.** Press on the loop-mark and move the cursor back and forth
  across it. Accumulated pointer travel drives development; per-event travel is
  capped (~40px) so one fast flick can't cash in the whole reveal — it must be
  sustained, like developing a photo or a scratch card.
- **Alternative — press-and-hold.** Hold the pointer down without moving and the
  ink develops on a ~700ms curve. Covers users who read "hold to reveal" before
  "rub," and anyone who'd rather not scrub.
- Cursor over a developable mark is the develop affordance, not a text cursor.

### Mobile / touch — designed now, not deferred

The touch reveal must feel deliberate, not fiddly — no chasing a tiny target, no
gesture that fights the page swipe.

- **Press-and-hold to develop, under your thumb.** Touch and hold anywhere on
  the loop-mark's row (a full-width, ≥44px target — never a small glyph). The
  ink develops *under your finger* with continuous visual feedback plus a
  **haptic ramp**: a light tick as development starts, building to a single
  medium impact at full legibility. Because the feedback is under the finger and
  continuous, it's deliberate and self-teaching, with nothing to aim at.
- **Rub is optional acceleration, not a requirement.** Moving the thumb while
  held speeds development slightly for the impatient, but a still hold completes
  it — so it's never fiddly, and never demands fine motor precision.
- **It cannot be triggered by accident, and never fights the swipe.** A hold
  only begins after a ~90ms delay, so a horizontal page-swipe fling passes
  straight through without starting a develop. Once a hold is active, vertical
  page-scroll and horizontal paging are locked for that pointer until release.
  Lifting early pauses (progress never decays); resting again resumes from where
  you were.
- **Release at full = revealed.** At completion the step snaps to legible with
  the 260ms dry-settle and the medium haptic; **Done** fades in after. Lifting
  before full leaves a partial smudge — legibly "started," enticing to finish.

### Reduced motion & assistive access

Under `prefers-reduced-motion: reduce`, and for keyboard/screen-reader users,
the loop-mark is a focusable control labeled **Reveal next step**. Activating it
(Enter/Space, or the press-and-hold path) reveals the step immediately with no
develop animation and announces the step text. Fog of war is preserved — the
step text is not in the accessibility tree until the control is activated — while
the reveal stays fully operable without the gesture. The effort-for-ownership
tuning never comes at the cost of access.

---

## Recurrence

- **Set in Loop design.** Recurrence is a property of the loop, chosen in the
  one planning moment via the **Repeats** control (Never / Daily / Weekdays /
  Weekly / Monthly, plus the specific day where relevant). It is deliberately
  absent from Brain dump (too raw a moment to schedule) and from Open loops
  (that surface is for doing, not planning). A recurring loop stores its
  designed step list as a reusable template.

- **What happens when a recurring loop closes.** Two things, kept separate:
  1. **The completed instance is recorded** as its own immutable row in Closed
     loops, marked as recurring (`↻`). You did it; the record stands.
  2. **A fresh instance is scheduled** for the next interval. It does *not*
     reappear immediately — fog of war applies to time as well as scope: next
     week's version shouldn't clutter this week's page. At the interval it
     **regenerates directly into Open loops as a folded loop-mark**, already
     carrying the stored step plan with every step undeveloped again. A
     regenerating loop **skips Brain dump and Loop design entirely** — it was
     designed once and comes back ready to crack, no AI re-run, no re-planning.

- **Editing or ending recurrence.** Because there is no loop-management surface
  by design, changing a recurrence (or stopping it) happens the next time that
  loop is open: its Loop design can be reopened from the live loop to adjust
  **Repeats**. Ending recurrence simply stops scheduling future instances; past
  records remain in Closed loops.

---

## Item lifecycle (cross-stage)

```
   write a line
        │
        ▼
 ┌─────────────┐   make a loop    ┌─────────────┐   open loop   ┌─────────────┐
 │  Brain dump │ ───────────────▶ │ Loop design │ ────────────▶ │ Open loops  │
 │  (raw line) │                  │  (has steps)│   scope hides │ (loop-mark) │
 └─────────────┘                  └─────────────┘               └──────┬──────┘
                                    ▲  set Repeats                      │ crack → develop
                                    │                                   │ → Done → next step
                        reopen to edit recurrence                       │
                                    │                        last step done
                                    │                                   ▼
                                    │                          ┌─────────────┐
                                    └───── regenerate ◀─────────│Closed loops │
                                        (recurring, at          │  (record)   │
                                         next interval,         └─────────────┘
                                         straight to Open)
```

---

## Self-critique — does this serve the flow, or is it generic task-app IA?

Testing each decision against the client's stated flow and the avoidance-solving
purpose.

- **Screens vs. states — revised.** *First instinct* was the honest generic
  answer: four tabs, one per stage (and it's what the current build already does
  with its page tabs). That's textbook task-app IA and it undermines the point —
  peer tabs are parallel and jump-anywhere, and a stage that persistently shows
  scope is an avoidance trap. **Changed to** three paged surfaces for the
  linear feel plus a transient overlay for Loop design specifically so full
  scope is seen once and then dismissed, not parked on a tab.

- **Brain dump — genuine.** The specific, non-generic decisions are the
  *removals*: no ranking, no priority, no grouping, no status, and no AI
  whatsoever. A generic capture inbox would add quick-tags and a triage view; I
  cut all of it because evaluating a dump *is* the avoidance behavior the product
  fights. Flat and silent is the choice.

- **Loop design — genuine, with one reframe.** A generic app scatters an
  AI assistant across the whole product. **Changed** to confine AI to this one
  stage and to a plain editable list — no chat, no thread, no persona — which is
  both the client's strict-functional requirement and a real narrowing from the
  current build's four AI touchpoints (classify, decompose, stale, merge). The
  overlay-not-page treatment makes the "see scope once" idea structural rather
  than a guideline.

- **Open loops — genuine.** This is the least generic stage: a field of blank
  loop-marks with zero visible scope and a single developed step is the opposite
  of a task list. The load-bearing decision — re-folding to a mark after each
  step so the next foothold must be cracked open again — is derived from the
  avoidance thesis, not from any task-app convention.

- **Closed loops — genuine.** A generic "completed" view trends toward streaks,
  counts, and productivity metrics. **Kept** it deliberately inert: a quiet
  record, no metrics, no re-open, lower contrast than everything else by rule —
  because celebrating throughput would reintroduce the pressure the product
  exists to remove.

- **The signature & mobile crack — genuine, and the real work of this phase.**
  The generic move would be a tap-to-expand disclosure and a "we'll polish touch
  later" note. **Instead** the touch reveal is fully specified now — hold-to-
  develop under the thumb with a haptic ramp, rub as optional acceleration,
  a 90ms arm delay and scroll-lock so it never fights the page swipe, partial-
  smudge on early release — because effortful reveal is the entire identity and
  it ships to mobile for public validation. The assistive/reduced-motion path
  preserves fog of war without the gesture.

- **Recurrence — genuine.** The non-obvious, purpose-driven choices: recurrence
  is set only in the one planning moment; a regenerating loop skips capture and
  design and returns straight to Open loops already folded; and it does *not*
  reappear until its interval — fog of war extended to time, so you're never
  shown next week's obligation early. A generic scheduler would surface the next
  occurrence immediately in an "upcoming" list; that would be an avoidance
  trigger, so it's excluded.
