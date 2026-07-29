# Open Loops — Design System (Phase 0)

Status: **proposal for approval.** No app code changes in this phase. This
document is the single source of truth the Phase 1 rebuild will implement
against. Every value here is a deliberate choice for *this* product; the
self-critique at the end records where a first instinct was a generic
default and what replaced it.

## What this replaces (context for the reviewer)

The current build is a warm-cream paper notebook: background `#f3ecda`, a
terracotta accent `#b3502a`, deliberately uneven "hand-drawn" corner radii,
multi-layer sticky-note shadows, and a literal handwriting typeface
(`Bradley Hand`). The frontend-design skill names this exact combination —
warm cream + high-contrast serif + terracotta — as the number-one
"AI-default" look to avoid. It also drifted into a chatty "companion" voice
(lowercase texts like *"hey, still thinking about writing that novel…"*).

This spec throws all of that out. Open Loops becomes a quiet, precise,
black-and-white instrument. The warmth is gone; the personality moves out
of the copy and into a single interaction.

---

## 1. Subject & intent

Open Loops is a notebook for tasks you're avoiding. A "loop" is one unfinished
thing. Its defining rule is **fog of war**: a loop never shows its full scope.
You only ever see the *single next step*, and even that starts as
**undeveloped ink** — physically present on the page but illegible, a blurred
grey smudge — until you spend a small, deliberate effort to *develop* it into a
sharp, readable line. The premise is behavioral, not decorative: a task feels
avoidable because the mind sees the whole mountain before the first step, so
the product hides the mountain and hands you exactly one foothold, and makes
seeing even that foothold an act you perform rather than a wall of text thrown
at you. The narrowed v2 product keeps only this ink-reveal mechanic; the
companion-chat, dice, and time-fade experiments are dropped.

The audience is one focused person — a maker, a founder, someone with a
handful of heavy open loops, not a team running a backlog. There is no
assignee, no priority field, no due date. Screens and their single jobs:

- **The page** (a calm, freeform surface of loops): show what's open *without*
  showing scope. A loop appears as either a small closed **loop-mark** (folded,
  unopened) or its one live line. Nothing on this screen reveals how much is
  left in any loop.
- **A live step** (the one developed line, elevated off the page): make the
  single next action legible through effort, then let you mark it done. This is
  the only element on screen with weight, contrast, and color.
- **Empty state**: invite the first loop. One line, no illustration.
- **Done**: a quiet, low-contrast record of what's finished. It exists so
  history is never lost, and it never competes with the live line for
  attention.

---

## 2. Color

Black-and-white, but grounded in a specific idea: **developed ink on cool
paper, under the flat even light of an e-ink page.** Not the warm pulp cream
of the old build, not clinical `#FFFFFF`. Paper is a cool-neutral off-white;
ink is a near-black with a faint blue-black undertone (real ink is never pure
`#000`); the single accent is **"wet ink"** — the blue-black cast fresh ink
has before it dries — and it appears *only* on the one thing that is alive
right now.

```
--paper        #F4F4F1   /* the page — cool-neutral off-white, warmth removed */
--surface      #FCFCFA   /* the one raised plane: a live step's card (brighter than the page) */
--ink          #17171A   /* settled ink — primary text, the loop-mark, done strokes */
--ink-muted    #73736E   /* muted ink — metadata, done items, secondary labels */
--hairline     #E4E3DE   /* barely-there rules and dividers; never a full box */
--accent       #223A6B   /* "wet ink" indigo — the live/now marker and focus. Used sparingly. */
```

Rules that make this a system, not six swatches:

- **The accent is a state, not a brand color.** `--accent` marks *the single
  live step* and interactive focus — nothing else. A freshly developed step is
  inked in `--accent` (wet) and settles toward `--ink` (dry) once you act on
  it. Color literally means "this is the one thing alive right now." No accent
  on headers, no accent fills on ordinary buttons.
- **Elevation is meaning.** The page is flat. Only the live step gets a
  surface (`--surface`) and a shadow. Everything folded or done sits directly
  on `--paper` with no card.
- **Contrast is rationed.** Full `--ink` is reserved for what you should read
  now (loop titles, the live line). Done and ambient text drop to
  `--ink-muted`. The page never has two things shouting.
- **One neutral temperature.** Everything is cool-neutral to cool. There is no
  warm value anywhere — that was the tell of the old look.

Contrast check: `--ink` on `--paper` ≈ 15:1 (AAA). `--accent` on `--paper` ≈
9:1 (AAA). `--ink-muted` on `--paper` ≈ 4.6:1 (AA for text ≥ ~14px; it is only
ever used for secondary/meta at 13px+, never for primary body).

---

## 3. Typography

Two typefaces, each with one job, plus a single utility face for annotations.
The pairing is chosen from the product's own logic — *the payoff of the whole
interaction is reading a line* — not from "minimalist app ⇒ grotesque + fashion
serif."

- **Newsreader** (serif) — the **ink voice**. A screen-optimized *reading*
  serif with genuine ink character and a beautiful italic. It is used with hard
  restraint: only for loop titles and for the one developed step. Because the
  entire mechanic climaxes in *reading a sentence you worked to reveal*, that
  sentence deserves the reading face. The just-revealed step is set in
  **italic** (wet ink, still flowing) and settles to roman once acted on. This
  is not a decorative display serif — it's the honest voice of the payoff.
- **IBM Plex Sans** (grotesque) — the **instrument voice**. Everything else:
  chrome, buttons, inputs, hints, the folded-loop count-less labels. Plex is a
  neutral, lightly engineered humanist grotesque (its brief was literally "man
  and machine"), which fits a notebook that is also a quiet precise tool. It is
  deliberately *not* Inter/SF — clean without reading as the 2024 default
  webfont.
- **IBM Plex Mono** (utility only) — small drafting annotations: the loop's
  ordinal marks and timestamps in the done record. Shares DNA with Plex Sans,
  so it's one decision, not a third personality. Optional; if payload matters,
  tracked Plex Sans small-caps substitutes.

**Loading.** Self-host `woff2` (latin subset) via `@font-face` for control,
performance, and offline parity with the product's zero-network ethos. Google
Fonts is the acceptable quick path in early Phase 1. All three are OFL. Ship a
minimal cut only:

- Newsreader — 400, 400 *italic*, 500 (optical size ~18–40; variable file if
  used, otherwise these named instances)
- IBM Plex Sans — 400, 500
- IBM Plex Mono — 500

**Type scale** (base 16px = 1rem; restrained, ~1.25 rhythm, few sizes):

| Role | Font | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Display (empty state, the one hero line) | Newsreader | 40 / 1.05 | 400 | −0.01em |
| Loop title / developed step | Newsreader | 28 / 1.2 | 400 (step: 400 italic → roman) | −0.005em |
| Body | IBM Plex Sans | 16 / 1.55 | 400 | 0 |
| UI default (buttons, controls) | IBM Plex Sans | 14 / 1.4 | 500 | 0 |
| Meta / secondary (done items) | IBM Plex Sans | 13 / 1.45 | 400 | 0 |
| Annotation label (ordinals, timestamps) | IBM Plex Mono | 12 / 1.4 | 500 | 0.08em, uppercase |

Only two weights per family. No light weights, no black weights, no faux
styles. Emphasis comes from the ink/muted contrast and the roman/italic
switch, not from piling on weights.

---

## 4. Spacing & shape

Precision over decoration. The old build's charm was uneven hand-drawn radii
and warm sticky-note shadows; the rebuild's charm is exactness.

**Spacing** — 4px base, 8px rhythm. One scale, used everywhere:

```
--space-1  4px      --space-4  16px     --space-7  48px
--space-2  8px      --space-5  24px     --space-8  64px
--space-3  12px     --space-6  32px     --space-9  96px
```

Layout leans on whitespace and alignment, not dividers. A loop's live step
gets generous internal padding (`--space-5`/`--space-6`); the page keeps loops
well apart so scattered placement reads as calm, not crowded.

**Corner radius** — uniform and small; the unevenness of the old cards is
explicitly rejected. Continuous ("squircle"/superellipse) corners where the
platform allows, for the Apple-grade softness.

```
--radius-control  6px    /* buttons, inputs */
--radius-card     10px   /* the live-step surface, menus */
--radius-modal    16px   /* rare large surfaces */
```

Zero-radius is also rejected — hard 0px corners are their own AI-default
(broadsheet/brutalist) and read as cold here.

**Hairlines / borders** — 1px (physical-pixel `0.5px` on retina where
supported), color `--hairline`, used *only* as dividers and only where
whitespace can't do the job. No element is boxed in a full border. The live
step has no border — it's defined by its surface and shadow, not an outline.

**Shadows** — one shadow, one meaning: *this is the live step.* Everything else
is flat.

```
--shadow-live:
  0 1px 2px rgba(23, 23, 26, 0.05),
  0 8px 24px rgba(23, 23, 26, 0.07);
```

Cool blue-black tint (never warm). Low, soft, single source. No shadows on
folded loops, done items, buttons, or the page. Elevation is rationed exactly
like contrast and color: it points at the one thing that matters.

---

## 5. Motion

Apple-style motion is subtle and earns its place; scattered animation is the
tell of AI-generated UI. Open Loops is mostly *still*. Motion appears in three
moments and nowhere else.

**Deliberately absent:** no page-load orchestration, no parallax, no ambient
drift, no hover-scale on cards or buttons, no animated list reflows, no
decorative transitions. `prefers-reduced-motion: reduce` removes even the three
earned moments (the develop resolves instantly to legible; advancement and
press feedback become instant state changes).

**Tokens:**

```
--dur-fast   120ms   /* press / focus feedback */
--dur-base   200ms   /* enter / fade */
--dur-settle 260ms   /* the develop resolve, "ink drying" */
--dur-slow   320ms   /* a step retiring to the done record */

--ease-standard   cubic-bezier(0.2, 0, 0, 1)      /* decelerate — most transitions */
--ease-develop    cubic-bezier(0.22, 0.61, 0.36, 1) /* the reveal settle */
```

**1. The develop (the signature moment).** Revealing the next step is driven by
the user's own effort — sustained pointer travel / press-and-hold, ~500–600px
of deliberate motion, capped per event so one fast flick can't cash it in. Two
opposing curves, kept from the current build's best insight because it's
psychologically right:

- **Blur eases out** (fast at the start, from ~7px → 0): the very first rub
  visibly stirs the ink — instant proof that effort works, the hook.
- **Opacity eases in** (blooms late, ~0.2 → 1): legibility — the payoff —
  arrives only near the end, so it pulls you through to the finish.

Progress never decays (ink doesn't un-develop; a half-smudge is more enticing
than a blank). On full reveal: a `--dur-settle` "drying" transition snaps blur
to 0 and settles the ink from `--accent` (wet) toward its resting weight; the
✓ action fades in *after*, over `--dur-base` with a ~120ms delay, so the action
reads as a consequence of reading, not a competing button.

**2. Advancing.** Marking the live step done: it recedes to `--ink-muted` and
retires into the done record over `--dur-slow`/`--ease-standard`; the next
step's surface rises in (4px translate + `--shadow-live`) over `--dur-base`.
One clean handoff, never a cascade.

**3. Feedback.** Buttons and controls: opacity/`--accent` transitions over
`--dur-fast`, a 0.98 press scale. Focus-visible ring fades in over
`--dur-fast`. That's the entire motion budget.

---

## 6. Signature

**Undeveloped ink → a legible line.** This is the one thing Open Loops is
remembered by, and the one place all the boldness is spent.

The next step of a loop is not hidden and not summarized — it is *physically on
the page as ink that hasn't developed*: a blurred, low-opacity, grayscale
smudge with real ink texture, clearly a written line you cannot yet read. You
develop it into a sharp, high-contrast sentence through deliberate effort (rub
/ press-hold), and the moment it becomes legible it is inked in **wet-ink
accent** and then dries to settled black. The folded, unopened loop is drawn as
a small **closed ink loop-mark** — a single continuous pen stroke — which, on
open, unspools into that developing line. Loop → ink → reveal, in one gesture.

Everything else on the page is silent by contract: flat grayscale, no
elevation, no color, minimal motion. The signature is the *only* element that
gets contrast, the accent, the surface, the shadow, and animation
simultaneously. That concentration is what makes it read as a deliberate
product identity rather than a styled to-do list — the restraint everywhere
else is what makes this one moment land.

---

## 7. Copy tone

Apple-restraint register: plain, active, exact. The personality lives in the
*interaction*, never in the words. The old "companion" voice — first-person,
lowercase, chatty, emotional — is removed entirely; the interface does not have
a personality, it has a vocabulary.

- **Voice:** the interface states and instructs; it never speaks in first
  person, never apologizes, never emotes. No emoji, no exclamation marks, no
  "let's", no filler. Sentence case throughout.
- **Labels & buttons:** the exact verb of the outcome, and the same word all
  the way through a flow. The control that reveals a step says **Reveal**;
  finishing one says **Done**; a folded loop says **Open**. "Publish" produces
  "Published," never "Submit."
- **Empty state:** a plain invitation, one line. *"Nothing open. Write a
  loop."* — no illustration, no encouragement.
- **Errors:** what happened and how to fix it, in the interface's voice, not a
  person's. *"Couldn't save. Check your connection and try again."* Never vague,
  never apologetic.
- **The one reveal, unlabeled where possible:** the developing smudge often
  needs no instruction — the affordance teaches itself. When a hint is
  unavoidable it is a single quiet imperative (*"Rub to reveal"*) in muted ink,
  never a sentence of explanation.

---

## Self-critique — genuine choice, or default?

Working through each section against the frontend-design skill's core test:
*would I produce this for any minimalist app, or is it specific to Open Loops?*

1. **Subject & intent — genuine.** Grounded in the actual mechanic (fog of war,
   undeveloped ink, one foothold) and an audience of one avoider, not a generic
   "productivity app for teams." No revision. I did cut the multi-mechanic
   framing to commit to the ink-reveal, since the design can't have a signature
   if the product hasn't chosen one.

2. **Color — revised.** *First instinct* was the true default for this brief:
   pure `#FFFFFF` paper, Apple's own `#1D1D1F` ink and `#6E6E73` grey, and a
   bright system-blue accent — i.e. "generic Apple minimalist," which is just a
   cooler version of a default. **Changed to** a cool-*neutral* paper `#F4F4F1`
   (deliberately not `#FFF`, deliberately not the rejected cream), a blue-black
   ink `#17171A` instead of copying Apple's exact values, and — the real move —
   an accent that is a *state* (wet vs. dry ink) rather than a brand color, tied
   to ink chemistry and to the "which one is alive" question the whole product
   asks. `--ink-muted` was nudged off Apple's exact `#6E6E73` so the palette
   isn't lifted wholesale.

3. **Typography — revised.** *First instinct* was Inter for everything, or
   Inter + a fashion display serif (Playfair/Fraunces) — both current AI-defaults.
   **Changed to** a pairing justified by the product's logic rather than by
   convention: a *reading* serif (Newsreader) used only for the sentence the
   user works to reveal, because reading is the literal payoff; and Plex Sans as
   a lightly-engineered "instrument" grotesque that isn't Inter. The italic→roman
   "wet/dry" switch ties type directly to the signature. Fashion display serifs
   were explicitly rejected as decorative.

4. **Spacing & shape — genuine, with an explicit rejection.** A 4px/8px scale is
   standard and correctly so — inventing a quirky spacing scale would be
   decoration, not distinction; restraint here *is* the choice. The specific,
   defensible decisions are the two rejections: uniform continuous radii
   *instead of* the old uneven hand-drawn corners, and small radii *instead of*
   the 0px broadsheet default. Shadow reduced to a single elevation that carries
   meaning (the live step) rather than ambient depth.

5. **Motion — genuine.** The default for "premium minimalist" is a load-in
   orchestration plus hover-scales everywhere; I cut all of it and spent the
   entire budget on the one develop transition, keeping the opposing
   blur-out/opacity-in curves because they're psychologically load-bearing for
   *this* mechanic, not a generic fade. Reduced-motion removes even those.

6. **Signature — genuine.** This is the least default section: undeveloped ink
   that you physically develop into legibility, fed by a closed loop-mark, is
   specific to Open Loops and can't be transplanted onto another app. Boldness
   is concentrated here and nowhere else, per the skill's "spend it in one
   place."

7. **Copy tone — genuine, and a real reversal.** The default for a "friendly"
   task app — and the current build — is exactly the warm conversational
   companion the client rejected. **Changed to** a vocabulary-not-personality
   register: same verb through a flow, no first person, no apology, no filler.
   The feeling is carried by the interaction, which is where this product's
   personality actually belongs.

**One accessory removed (Chanel test):** the loop-mark could easily have grown
into an animated "unspooling" flourish on every open. Cut. It appears, it
unspools once into the developing line, and it stays quiet — the develop is the
signature, and it shouldn't share the stage.
