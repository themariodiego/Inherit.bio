# ADR-0028 — The jurisdiction gating mechanism

- Status: **Proposed** · 2026-09-11 · not decided here
- Deciders: Inherit engineering, plus the operator for anything a reviewer must sign
- Records: the mechanism as built. It proposes no legal determination and contains none.

The brief's minimum ADR set names a jurisdiction-gating mechanism and this
repository has never had the ADR, while the mechanism itself has been built and
is enforced. That gap is the reason for this document: the rules below are
already load-bearing, so writing them down is recording what exists rather than
proposing something new.

## The question

Which capabilities may a person use, and who decides?

## What is built

`data/jargon.json`'s sibling `data/jurisdictions.json` is the authority. Its
shape carries the answer:

- **Twelve restricted capabilities**: `third_party_adult_analysis`,
  `family_heritability`, `family_portrait` and its five trait sub-capabilities,
  `embryo_analysis`, `embryo_single_locus`, `embryo_statistical_estimate`,
  `carrier_match`.
- **One unrestricted capability**, `adult_self_analysis`, exempted by X12.3 so
  that My Genome ships without a jurisdiction review. This is why priorities 1
  and 2 are reachable in production and priorities 4 and 5 are not.
- **Three status values**: `permitted`, `prohibited`, `unreviewed`.
- **`defaultRealJurisdiction`**, where every capability reads `unreviewed`, and
  which every one of the catalogue's 249 selectable country codes falls through
  to.
- **`TEST-LOCAL`**, which permits all twelve and which `next.config.ts` refuses
  to start with on Vercel production.

## The decision this records

**Default deny, and the default is the whole population.** Measured
2026-09-11: `realJurisdictions` holds **zero** entries, so all 249 selectable
codes resolve through `defaultRealJurisdiction` to `unreviewed`, and every
restricted capability is therefore off everywhere. Nothing in the product
grants a capability by omission.

**A permitted or prohibited decision requires a signed review.**
`signedReviewContract` will accept only an exact reference object — `path`,
`reviewer`, `qualification`, `jurisdiction`, `capability`, `scope`, `status`,
`reviewedOn`, `gitSha`, `outcome`, no additional fields — backed by a markdown
record at `docs/reviews/jurisdictions/{jurisdiction}/{capability}.md`. `review`
is null only for `unreviewed`.

That contract is the point of the whole mechanism, and it is worth saying why
in an ADR rather than leaving it to the schema: **the gate exists to make a
legal conclusion attributable to a person who is qualified to reach it.** A
system that let a capability be switched on without one would still gate, but
it would gate on nobody's judgement.

## What follows from it, and is not optional

**Building the jurisdiction-selection UI unlocks nothing on its own.** G5.1a
records that nothing writes `profiles.jurisdiction_code`; this ADR records why
completing that path would change no outcome — all 249 codes resolve to
`unreviewed` regardless, so the capability check refuses either way. The
blocker is the empty `realJurisdictions`, not the missing selection.

**No determination may be authored by the system that enforces it.** The
operator's own non-negotiables for this work forbid invented reviews, and this
mechanism is the structural half of a *human*-review gate. Scaffolding a record
with its fields blank is engineering; filling in `reviewer`, `qualification`
and `outcome` is not, whoever signs it afterwards.

## Alternatives considered

**Default permit, review to restrict.** Rejected: it ships a restricted
capability into every jurisdiction nobody has looked at, and the failure is
silent and one-directional — a person's genetic data is analysed under a legal
regime nobody checked, and no later review can un-analyse it.

**A single global determination.** Rejected: the twelve capabilities differ in
kind (an embryo analysis and a carrier match raise different questions), and
the regimes differ by country and sometimes by subdivision, which is why
`realSubdivisionOverrideRequiredFields` exists.

**Let engineering record a provisional status pending review.** Rejected for
the reason above: a provisional `permitted` is a `permitted`, and the field
that would carry the provisionality is the same field that asserts who decided.

## Consequences

Priorities 4 and 5 cannot function in production until at least one
jurisdiction carries a signed review, and no amount of engineering shortens
that. Priorities 1 and 2 are unaffected by design. The freshness contract
(`warnAfterDays`, `failAboveDays`) means a review is a thing that expires, so
this is a standing obligation rather than a one-time unlock.
