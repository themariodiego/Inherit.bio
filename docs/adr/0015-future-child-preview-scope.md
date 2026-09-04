# ADR 0015: Future-child preview scope

- Status: Accepted (2026-09-04, when `/family/portrait/[pairId]` shipped on
  the F3 libraries; Proposed 2026-09-03 for the libraries alone)
- Date: 2026-09-03
- G7.1 name: "the future-child preview scope"

## Context

Portrait is the third content of the Family domain and the brief calls it
"the highest-risk surface in the product" (G5.9, `docs/inherit-v2-brief.md`
line 2650). Four parts of the brief describe it, and they do not agree with
each other about what it may show:

- §2 §5.6 (lines 352–364) lists an "exhaustive allowlist": carrier overlap,
  X-linked arithmetic over 100 pregnancies including both sexes, ABO and Rh
  with two verbatim RhD sentences, and "exactly three low-stakes traits" —
  eye colour, bitter taste and earwax type — with hair colour excluded. It
  also fixes the 100-dot distribution, the sentence pattern, the sub-1-in-100
  rule, the "How sure we are" block, the persistent banner and the refusals
  screen (lines 358–364).
- §3 §8.4 (lines 1014–1017) fixes the header sentence and the denied list
  ("cognitive ability, educational attainment, height, BMI, personality, any
  mental-health condition, appearance ranking, sex, longevity, athletic
  ability") and names hair colour among the trait rows.
- §4 §5.1–5.4 (lines 1343–1368) says Portrait "computes no polygenic estimate
  of any kind", limits it to three classes — recessive and X-linked carrier
  arithmetic from the `variant_call` layer, the chromosomal-sex expectation,
  and "a closed allow-list of high-effect Mendelian traits" of exactly five:
  ABO, Rh, red hair (MC1R), lactase persistence and earwax — and requires the
  refusals list with at least eight items.
- A.7 (lines 2238–2240) describes both *Portrait, monogenic* (exact Mendelian
  segregation, the six canonical crosses, the prohibited `0%`) and
  *Portrait, polygenic* (a child's score as a weighted sum of Bernoulli
  transmissions, with a Normal approximation above 50 heterozygous loci).

X0.1 (line 2364) sets the precedence: X10.1 (line 2480) governs the trait
list — "closed and is exactly: ABO blood type, Rh type, red hair (MC1R),
lactase persistence, earwax type — plus recessive and X-linked carrier
arithmetic, which is not a trait" — and §4 §5.4 governs the polygenic
question. X3.6 (line 2418) governs who may open the page: two accounts, a
grant signed from each person's own session, an independent acknowledgement
from each. C5 (line 2734) forbids inventing a citation, an identifier, a
statistic or a coverage figure; where a number cannot be sourced the
capability renders an explicit unavailability state.

Three repository facts bound the decision. `data/citations.json` does not
exist, so no genotype-to-phenotype table and no accuracy figure can be cited
for any of the five traits (`docs/design/w9-family-surfaces.md` §2.5). The
figure contract already carries the pieces the arithmetic needs: the `exact`
basis with `EXACT_MARKER` (`src/lib/figures/contract.ts`), the forced
denominator of 100 that refuses any value rounding below 1 in 100
(`src/lib/figures/claim-block.ts`), and largest-remainder apportionment
(`apportionShares` in `src/lib/ancestry/present.ts`). And nothing records a
person's chromosomal sex (`subject_demographics` has no writer), so the
carrier rule of ADR 0017 answers an X-linked pattern with a named reason
rather than a split (D-031).

This ADR records the scope of Portrait as shipped: the pure libraries
(`data/family-trait-allowlist.json`, `src/lib/family/{traits,mendel,distribution}.ts`,
`src/copy/family/portrait.ts`) and, since 2026-09-04, the page
(`src/app/(app)/family/portrait/[pairId]/page.tsx`), the pair rule
(`src/lib/family/portrait.ts`), the components
(`src/components/family/portrait/*`) and the browser suite
(`e2e/portrait.spec.ts`).

## Decision

1. **Portrait computes carrier arithmetic and nothing else today.** The
   only quantities are exact Mendelian fractions from `src/lib/family/mendel.ts`:
   autosomal recessive and dominant crosses from the number of changed
   copies each file shows, and X-linked crosses over 100 pregnancies with
   both sexes shown. Every fraction is counted from equally likely gametes
   and reduced only by a factor common to the whole cross, so the mandated
   derivation "1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%)
   neither" (line 1349) is produced as written. Each cross carries its
   assumptions by name — independent assortment, no new mutation, no
   imprinting unless the gene is registered as imprinted, both files below
   the runs threshold and, for X-linked crosses only, equal X/Y transmission
   — for the "How sure we are" block to state in words. The equal X/Y split
   is an assumption in the returned structure, never an observed ratio, and
   nothing predicts or selects a sex.

2. **The page renders one cross: the recessive one, from the carrier rule
   of ADR 0017.** The trigger is F2's `resolveCarrierPair` (both people's
   own files, the classified reference positions, the registry's gene
   symbols, each file's stored runs measure). A match the rule answered with
   the one fraction renders as `autosomalCross("autosomal_recessive", 1, 1)`
   through `distribute` — the derivation line, three `natural-frequency`
   figures with basis `exact` at the forced denominator 100 inside the
   100-dot renderer, the exactness label once per block, the assumptions in
   words, the covered-against-known count (line 2238), the segregation
   sentence once, the "How sure we are" block and "This is a chance, not a
   prediction about a particular child." Every other match — dominant,
   harmless, unknown meaning, copies unknown, no recorded pattern, two
   copies, and an X-linked pattern — renders the side-by-side page's refusal
   sentence with its named reason and the two status readings, and never a
   fraction; the runs refusal is the brief's own sentence (line 1349). The
   design's derivation-versus-figures question is answered by rendering
   both: the derivation is prose the block owns, the three figures are the
   contract's, and neither prints a number the other does not.

3. **X-linked pairs render the refusal, not the split (D-031 stays open).**
   `xLinkedCross` and the mandated sentence "Out of 100 possible
   pregnancies, about {a} would be boys with the condition and about {b}
   girls who carry it." exist in the library and the copy registry, and no
   component renders them: the split needs to know which parent carries the
   change on the X, and Inherit records no person's sex. The rule's reason
   `sex-unknown` renders on this page exactly as on the health picture.
   When a sourced writer for chromosomal sex exists, the page swaps the
   reason for the cross and this decision is superseded.

4. **The one-sided sentences of line 2238 render without a distribution.**
   Where one file shows one copy of a pathogenic change in a gene the
   registry records as recessive and the other file shows no changed copy
   at any of that gene's known positions, the page renders "Based on the
   variants your files cover, we found no second copy in {parent}. This is
   not zero risk: your files do not cover every variant known to cause this
   condition." with the covered-against-known count; where the other file
   reports none of those positions, it renders "We cannot do this
   calculation. {Subject label}'s file does not cover {rsid}." Neither
   card draws dots: the cross `recessive_one_copy_none_found` would show
   "zero affected" as an absent dot category, and the sentence says the
   risk is not zero. Two changed copies in one file only, and any pattern
   other than recessive, render nothing one-sided: the brief gives no
   sentence for them and a wrong one is worse than none.

5. **The five X10.1 traits are the whole trait list, shipped as a withheld
   registry.** `data/family-trait-allowlist.json` holds exactly `abo`, `rh`,
   `red_hair`, `lactase_persistence` and `earwax`, plus the non-trait class
   `carrier_arithmetic`. Every field that would need a source — evidence
   level, table citation, accuracy citation — is `null`, every trait is
   `unregistered`, and the file's header reads
   `withheld_until_genotype_phenotype_tables_are_registered`, following the
   precedent of `data/embryo/allowed_conditions.json`. The reader
   (`src/lib/family/traits.ts`) refuses a file with any key outside the five,
   any key matching a denied class, or a registered entry lacking either
   citation; `src/lib/family/traits.test.ts` is the gate the brief names at
   line 2304. The page renders one card per entry, in a two-column grid,
   each stating "Inherit has not registered a sourced table for {trait} yet,
   so this card shows nothing." — "yet" is permitted because registering a
   cited table is within the operator's control (line 2680). The ABO, Rh and
   RhD sentences of line 354 stay in the copy registry, rendered by nothing
   until an entry is registered.

6. **No polygenic estimate, no image, no ranking, no sex prediction.**
   Nothing in the library or the page produces a score, a distribution of
   scores, a picture or an order; `portrait_results.kind =
   'polygenic_distribution'` is never written, and the page writes no
   `portrait_results` row at all: every output is computed at request time
   (A.7 line 2215 permits carrier arithmetic serverless) and nothing derived
   is persisted. The refusals screen (`REFUSALS` in
   `src/copy/family/portrait.ts`) carries eleven cards, each with a
   `refusalId` and a one-sentence reason, server-rendered under "What
   Portrait will not tell you, and why" (open decision 10: the §4 heading
   is its prefix), with one link to the science page until `/science/limits`
   exists; the reasons for intelligence and height are the brief's (line
   358) and the polygenic-risk reason is line 1365. The dots are DOM spans;
   no `img`, `canvas` or `svg[role=img]` exists anywhere on the page
   (G5.9(a)).

7. **The 100-dot distribution with the exact basis.**
   `src/lib/family/distribution.ts` turns category shares into dot counts
   summing to exactly 100 by largest remainder, reusing `apportionShares`
   (1,000 units, then the same rule into 100 dots — lossless for every
   Mendelian fraction). `<OutcomeDots>` renders them in ten rows of ten,
   three treatments that differ by fill and by border (solid ink, half ink
   dashed, empty dotted) with a legend that names each in words, a stacked
   bar beneath, the figure node and the mandated sentence per category, a
   `<figcaption>` and a `<table>` fallback behind "See these numbers as a
   table" (line 801). The sentence pattern is §2's "Out of 100 possible
   children, about {n} would {outcome}." (open decision 6): it names no pair
   and satisfies line 1016. The sub-1-in-100 rule renders one outlined dot
   and the sentence "Fewer than 1 in 100 — but not zero. Inherit’s estimate
   is about {exact} in 1,000."; the tests prove it is unreachable for any
   Mendelian cross (whose smallest share is a quarter) and reachable only by
   banded inputs, which no registered trait produces yet. When such a
   category exists it belongs in its own claim block at 1,000, because the
   100-denominator block refuses it (open decision 6b).

8. **The chromosomal-sex expectation card does not render (open decision
   7).** §4 §5.3 item 2 (line 1350) states the expectation "Each conception
   is equally likely to get an X or a Y from the father…" as a claim about
   inheritance in general. C5 forbids rendering a statement about the
   category without a source, and `data/citations.json` does not exist, so
   the sentence is kept in the copy registry
   (`CHROMOSOMAL_SEX_EXPECTATION`) and rendered by no component until a
   citation id exists. The equal X/Y split still appears — as a named
   assumption of the X-linked crosses, which is what the arithmetic rests
   on, not as a claim about births.

9. **Who may open the page, decided as one pure rule.**
   `evaluatePortraitPreconditions` in `src/lib/family/portrait.ts` takes the
   pair row, its two subjects, the live own-session `family.portrait` grants
   between the two accounts and the pause predicate — the equivalent read of
   `private.resource_authorized_v1(…, 'family_pair', …)` plus the columns
   the blocking screen names — and answers, in order: not authorised (the
   viewer holds neither account, or the pair is revoked or purged), paused,
   missing steps, ok. A step is one of the register's four — the account,
   the independent login (`subjects.independent_login_at`), the grant signed
   by that person's own account toward the other, the acknowledgement
   (`subjects.portrait_acknowledged_at`) — and the blocking screen lists
   every missing step of both people in the pair's own order, so both
   viewers read the same list; the viewer's own lines read in the second
   person. Any unmet step is the whole screen (line 352: never a partial
   render), which fetches no file, genotype or result. A pause renders the
   person page's paused sentence rather than a false step. A missing file is
   not a step: it is read only after the gate, and the outputs section then
   renders the person page's "{name} hasn’t added a file yet. There is
   nothing to show." — the design's `processing → blocking screen` row is
   not followed, because whether another adult has a file is a derived fact
   the gate withholds.

10. **The acknowledgement is each person's own.** The blocking screen carries
    the checkbox "I have read what Portrait will and will not show." and the
    action "Open Portrait" only while the viewer's own acknowledgement is the
    step left to them; it posts the `portrait` body of
    `POST /api/family/acknowledge`, which calls `acknowledge_portrait_v1`
    for the acting account and refuses any subject that account does not
    hold. Nothing on the page can acknowledge for the other person.

11. **"Either of you can delete it" is real, through the viewer's own
    grant.** The one routine that deletes from one side is
    `revoke_directional_purpose_v1` on the viewer's own `family.portrait`
    grant (`POST /api/consents/[id]/revoke`): it deletes every
    `portrait_results` row of the pair inline, returns the pair to pending
    so the page closes for both people on the next request, and enqueues
    the purpose.derived-60s purge. The page renders one destructive action,
    "Delete Portrait", behind a dialog naming what is deleted and what it
    takes to undo (tier 2 of line 936); nothing is typed, because the action
    is scoped to one pair and reversible by two grants. "Stop sharing" on
    the permissions page remains the wider action.

12. **The F_ROH refusal is a within-file quantity, distinct from the declared
    relatedness gap.** The runs-of-homozygosity check the brief requires
    (line 1349) is measured inside one file at a time (`src/lib/family/roh.ts`),
    and `mendel.ts` carries it as the assumption `runs_below_threshold` that
    each file, on its own, sits below the limit. No quantity crossing the
    two files — shared DNA, centimorgans, IBD segments, kinship, a
    relationship label — is computed anywhere in Portrait, so the declared
    gap in `docs/capability-register.md` ("Relative matching, relatedness or
    any shared-DNA quantity") stays true. The refusal sentence itself is the
    brief's verbatim (`RUNS_REFUSAL`).

13. **The `0%` string cannot be produced for any monogenic outcome.** A
    cross lists only the outcomes that occur and names the rest in
    `absentOutcomes`, so the page renders the mandated no-second-copy
    sentence (line 2238) rather than a zero; the test named `no outcome
    renders zero` renders every outcome of every cross through the figure
    contract and asserts no `0%` and no `0 in 100`, and the component and
    browser suites assert the same over the rendered page.

## Alternatives rejected

- **§2's eye colour and three-trait list (line 354).** Rejected by X10.1
  (line 2480): "Eye colour is excluded: offspring eye-colour prediction is a
  multi-locus model and is therefore an estimate, not a variant call, and
  the allow-list admits variant calls only." Bitter taste is absent from
  both X10.1 and §4 §5.3, which removes "cilantro perception and
  asparagus-odour detection" as "single-SNP associations with no probability
  table meeting the bar" (line 1351). The allowlist follows X10.1.
- **§3 §8.4's hair colour row (line 1017's trait rows; the design's reading
  of §3).** Rejected by X10.1: "Hair colour beyond MC1R red hair is
  excluded." Only `red_hair` is admitted, and the refusals card
  `appearance` names eye colour and hair colour beyond MC1R as refused.
- **A.7's polygenic Portrait (line 2239).** Rejected by §4 §5.4 (line 1357:
  "Portrait computes no polygenic estimate of any kind") and X10.1, which
  admits variant calls only. The mean-and-variance construction at line 2239
  is not implemented; `polygenic_distribution` is never written; the
  `polygenic-disease-risk` card refuses it with line 1365's reason. X0.1
  places X10.1 and the gates above A.7.
- **A.7's dominant cross on the page (line 2238: "Autosomal dominant, one
  heterozygous parent: 50%").** Not rendered: the carrier rule of ADR 0017
  refuses a dominant pattern with the reason "the change runs in a dominant
  pattern", and Portrait reuses that rule rather than running a second one.
  `autosomalCross("autosomal_dominant", 1, 0)` exists in the library for the
  day the rule admits it.
- **Rendering an X-linked pair as the hundred-pregnancy split.** Rejected
  until a sourced writer for chromosomal sex exists: the split needs which
  parent carries the change on the X, and a guess would be a prediction
  about a person Inherit knows nothing about.
- **Rendering an absent outcome as `0%`.** Rejected by line 2238: "The
  string "0%" is prohibited for any monogenic Portrait outcome." The cross
  structure has no slot for a zero; the page renders words instead.
- **Drawing the dots for a one-sided reading.** Rejected: the only cross
  available shows no affected category, and the mandated sentence says the
  risk is not zero; a grid with no affected dot would contradict it.
- **A rendered chromosomal-sex card without a citation.** Rejected by C5
  (decision 8).
- **Inventing a genotype-to-phenotype table so a trait card could render.**
  Rejected by C5 and by line 354's requirement that "each trait card renders
  a stated accuracy figure with its source": no source exists, so the card
  states that and shows nothing.
- **A blocking screen for a missing file.** Rejected: whether another adult
  has a processed file is a fact about their files, read only behind the
  gate on every Family surface; the outputs section says so after the gate
  in the person page's own words (decision 9).
- **No delete control, banner sentence only.** Rejected because a real
  one-sided mechanism exists (decision 11); a mandated sentence that
  promised a control the page did not have would be a dead promise.
- **A second stacked subject bar.** Rejected (design open decision 11):
  the pair bar carries both chips in one 44px row, in the pair's own order,
  with no file count and no "Add a file", so the same bar stands on the
  blocking screen before any grant is live.
- **A single-step apportionment written for this module.** Rejected in
  favour of reusing `apportionShares`, the one home of largest-remainder
  apportionment; the second step into 100 dots applies the same rule to its
  output and is lossless for every exact fraction.

## Consequences

- The capability register's *Future-child preview (portrait)* row moves to
  `shipped-degraded`: the blocking screen, the banner, the gate, the
  recessive block, the refusals and the delete control ship; all five trait
  entries are `unregistered`, so every trait card states so; no classified
  reference position exists in production (every
  `ref_variants.clinvar_significance` is null), so the shipped outputs
  section reads "Inherit has no classified positions to check yet…" and the
  recessive block is proved only on synthetic fixture rows.
- Registering a trait means adding `data/citations.json` with the table and
  accuracy citations, setting the entry's `evidence` and `status`, and
  writing the renderer for that entry's `rendering`; the gate then admits it
  without a change to the allowlist reader.
- `src/lib/family/traits.test.ts` fails the build on any key outside the
  five, on any denied key (the brief's list at line 1014 and X10.1's two
  exclusions), and on a registered entry lacking a citation; it also mirrors
  the `portrait_results.trait_key` check from
  `supabase/migrations/20260831224126_reference_registries_and_constraints.sql`.
- The copy registry keeps the brief's Portrait strings character-for-
  character; the strings written for the page grade at 9 or below and their
  short roles use registered words (`dot`, `each` and `means` were added to
  `data/plain-vocabulary.json` for the legend's label).
- The page carries three headings (h1, the outputs, the refusals): output
  cards and "How sure we are" are labelled sections, not headings, so the
  six-heading cap holds however many cards render.
- Reversing any part of this scope — a sixth trait, a polygenic
  distribution, a rendered sex card, a rendered X-linked split, a dots grid
  for a one-sided reading — means editing X10.1 or §4 §5.4, or closing
  D-031 with a sourced writer, and writing a superseding ADR, not editing
  this one.
