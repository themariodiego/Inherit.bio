# ADR-0029 — The density contract

- Status: **Proposed** · 2026-09-11 · not decided here
- Deciders: Inherit engineering
- Records: the contract as built in `docs/density-baseline.json` (schemaVersion 2)

The brief's minimum ADR set names a density contract, and this repository has
never had the ADR while the contract itself has been specified and enforced for
some time. As with ADR-0028, writing it down records what exists.

## The question

How much may a surface carry before it stops being readable, and how is that
measured rather than judged?

## The decision

**Density is a measured budget, not a review opinion.** Every threshold lives
in `docs/density-baseline.json`, every measurement is taken through a declared
selector, and the budgets are asserted in the browser rather than at review
time. The selectors are the contract's own vocabulary:
`[data-density-primary-content]`, `[data-density-top-level-section]`,
`[data-density-primary-claim]`, `[data-density-required-accuracy]`, and an
explicit pixel-exclusion set for map tiles and user images.

The budgets, in the shape they are enforced:

| What | Budget |
|---|---|
| White space, hub and standard surfaces | ≥ 0.62 |
| White space, wide-data surfaces | ≥ 0.45 |
| Visible text, Overview and domain landings | ≤ 480 characters |
| Visible text, elsewhere | ≤ 700 characters |
| Decorated elements | ≤ 40 at 390×844, ≤ 60 at 1280×800 |
| Interactive elements, empty or single-purpose | ≤ 7 |
| Interactive elements, populated hub or standard | ≤ 12 |
| Interactive elements, wide data | ≤ 24 |
| Prose measure | 45–68 ch, the minimum applying from 640 px |
| Gap between adjacent top-level sections | ≥ 64 / 80 / 96 px by breakpoint |
| Horizontal overflow at 390 px | 0 |

**A successor surface may not be denser than what it replaces.** Post-change
ink coverage must be ≤ 60% of the mapped baseline route at the same viewport
and state. Where a new route has no honest predecessor the relative rule is
recorded as not applicable and the absolute budgets stand alone — which is the
right answer rather than a gap, because inventing a predecessor to compare
against would produce a number that means nothing.

## Why budgets rather than guidance

The product's purpose is that a beginner understands a genetic file. Density is
the failure mode that does not announce itself: no single sentence is wrong, no
gate goes red, and the page is simply unreadable to the person it was written
for. A budget converts that into something a test can fail on.

The interactive-element budgets carry a second job worth naming, because it is
easy to mistake for a styling rule. **Every interactive element is a decision a
reader is being asked to make.** Seven on an empty hub is not a layout cap; it
is a limit on how much a person must choose between before they have anything
to choose about.

## The interaction this ADR exists to make visible

These budgets are not independent of the accessibility contract, and the two
can pull against each other. Brief lines 1053 and 2575 require a 44×44 CSS-px
target for every interactive element, deliberately stricter than WCAG 2.2 AA's
24×24 and with no inline-link exception. Raising the target scale changes the
rendered height of every surface that carries links, which moves white-space
ratios, decorated-element counts and section gaps at once.

**When they conflict, the accessibility rule wins and the density baseline is
re-captured.** A target a person cannot hit is a surface they cannot use at
all, where a density budget overrun is a surface that is harder to read. The
baseline exists to be re-measured; the 44 px does not exist to be negotiated.
The operator settled this on 2026-09-11 for the 198 text links that fail it
today.

The same interaction governs anything that adds controls to prose — the
`GlossaryTerm` glosses added on 2026-09-11 are buttons, which is why they are
rendered on first use only rather than on every occurrence.

## Alternatives considered

**Review-time judgement.** Rejected: it produces a different answer per
reviewer and per day, and it cannot fail a pull request.

**Absolute budgets only, with no relative rule.** Rejected: a redesign can
satisfy every absolute budget and still be denser than the thing it replaced,
which is how a product degrades without any individual change looking wrong.

**Per-component limits.** Rejected: density is a property of a surface as a
reader meets it, and a page can be built entirely from compliant components.

## Consequences

Changing a shared control's size is a density event and must be re-captured,
not assumed. `docs/density-baseline.json` carries `capture`,
`captureValidation` and `postChange` for that reason: a baseline nobody can
reproduce is a number, not a contract.
