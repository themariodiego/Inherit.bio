# ADR 0015: Future-child preview scope

- Status: Proposed (draft; becomes Accepted when `/family/portrait/[pairId]` ships)
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
question. C5 (line 2734) forbids inventing a citation, an identifier, a
statistic or a coverage figure; where a number cannot be sourced the
capability renders an explicit unavailability state.

Two repository facts bound the decision. `data/citations.json` does not
exist, so no genotype-to-phenotype table and no accuracy figure can be cited
for any of the five traits (`docs/design/w9-family-surfaces.md` §2.5). And
the figure contract already carries the pieces the arithmetic needs: the
`exact` basis with `EXACT_MARKER` (`src/lib/figures/contract.ts`), the
forced denominator of 100 that refuses any value rounding below 1 in 100
(`src/lib/figures/claim-block.ts`), and largest-remainder apportionment
(`apportionShares` in `src/lib/ancestry/present.ts`).

This ADR records the scope of the pure-library half of F3 (design §10) as
built on this branch: `data/family-trait-allowlist.json`,
`src/lib/family/{traits,mendel,distribution}.ts` with their tests, and
`src/copy/family/portrait.ts`. The page and its components are not yet
built; when they are, this record is re-read against them and its status
changes.

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

2. **The five X10.1 traits are the whole trait list, shipped as a withheld
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
   line 2304. An unregistered trait card renders "Inherit has not registered
   a sourced table for {trait} yet, so this card shows nothing." — "yet" is
   permitted because registering a cited table is within the operator's
   control (line 2680).

3. **No polygenic estimate, no image, no ranking, no sex prediction.**
   Nothing in the library produces a score, a distribution of scores, a
   picture or an order; `portrait_results.kind = 'polygenic_distribution'`
   is never written. The refusals screen (`REFUSALS` in
   `src/copy/family/portrait.ts`) carries eleven cards, each with a
   `refusalId` and a one-sentence reason; the reasons for intelligence and
   height are the brief's verbatim (line 358) and the polygenic-risk reason
   is line 1365 verbatim.

4. **The 100-dot distribution with the exact basis.**
   `src/lib/family/distribution.ts` turns category shares into dot counts
   summing to exactly 100 by largest remainder, reusing `apportionShares`
   (1,000 units, then the same rule into 100 dots — lossless for every
   Mendelian fraction). Every Mendelian figure is a `natural-frequency` spec
   with `basis: "exact"` at the forced denominator 100, so the block carries
   `EXACT_MARKER` and never `MODELLED_MARKER`; a block that mixed an exact
   fraction with a modelled band would throw (`assertBasesDoNotMix`). The
   sub-1-in-100 rule renders one outlined dot and the sentence "Fewer than 1
   in 100 — but not zero. Inherit’s estimate is about {exact} in 1,000."; the
   tests prove it is unreachable for any Mendelian cross (whose smallest
   share is a quarter) and reachable only by banded inputs, which no
   registered trait produces yet. When such a category exists it belongs in
   its own claim block at 1,000, because the 100-denominator block refuses
   it (open decision 6b).

5. **The F_ROH refusal is a within-file quantity, distinct from the declared
   relatedness gap.** The runs-of-homozygosity check the brief requires
   (line 1349) is measured inside one file at a time (`src/lib/family/roh.ts`,
   built by F2), and `mendel.ts` carries it as the assumption
   `runs_below_threshold` that each file, on its own, sits below the limit.
   No quantity crossing the two files — shared DNA, centimorgans, IBD
   segments, kinship, a relationship label — is computed anywhere in Portrait,
   so the declared gap in `docs/capability-register.md` ("Relative matching,
   relatedness or any shared-DNA quantity") stays true. The refusal sentence
   itself is the brief's verbatim (`RUNS_REFUSAL`).

6. **The `0%` string cannot be produced for any monogenic outcome.** A
   cross lists only the outcomes that occur and names the rest in
   `absentOutcomes`, so the page renders the mandated no-second-copy
   sentence (line 2238) rather than a zero; the test named `no outcome
   renders zero` renders every outcome of every cross through the figure
   contract and asserts no `0%` and no `0 in 100`.

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
- **Rendering an absent outcome as `0%`.** Rejected by line 2238: "The
  string "0%" is prohibited for any monogenic Portrait outcome." The cross
  structure has no slot for a zero; the page renders words instead.
- **A rendered chromosomal-sex card without a citation.** §4 §5.3 item 2
  (line 1350) states the expectation "Each conception is equally likely to
  get an X or a Y from the father…" as a claim about inheritance in general.
  C5 (line 2734) forbids rendering a statement about the category without a
  source, and `data/citations.json` does not exist, so the sentence is kept
  in the copy registry (`CHROMOSOMAL_SEX_EXPECTATION`) and rendered by no
  component until a citation id exists (design open decision 7). The equal
  X/Y split still appears — as a named assumption of the X-linked crosses,
  which is what the arithmetic rests on, not as a claim about births.
- **Inventing a genotype-to-phenotype table so a trait card could render.**
  Rejected by C5 and by line 354's requirement that "each trait card renders
  a stated accuracy figure with its source": no source exists, so the card
  states that and shows nothing.
- **A single-step apportionment written for this module.** Rejected in
  favour of reusing `apportionShares`, the one home of largest-remainder
  apportionment; the second step into 100 dots applies the same rule to its
  output and is lossless for every exact fraction.

## Consequences

- The capability register's *Future-child preview (portrait)* row can move
  to `shipped-degraded` only when the page ships; until then it stays
  `not shipped` and this ADR stays Proposed. All five trait entries are
  `unregistered`, so every trait card will state so; registering one means
  adding `data/citations.json` with the table and accuracy citations, setting
  the entry's `evidence` and `status`, and the gate then admits it without
  a code change.
- `src/lib/family/traits.test.ts` fails the build on any key outside the
  five, on any denied key (the brief's list at line 1014 and X10.1's two
  exclusions), and on a registered entry lacking a citation; it also mirrors
  the `portrait_results.trait_key` check from
  `supabase/migrations/20260831224126_reference_registries_and_constraints.sql`.
- The copy registry keeps the brief's Portrait strings character-for-
  character. Two mandated reasons (line 358's height sentence, line 1365's
  polygenic sentence) grade above 9 and two mandated short strings ("See
  these numbers as a table" from line 801; "Rh type") use words outside
  `data/plain-vocabulary.json`; the vocabulary additions are the
  orchestrator's to make, and the design (§4) expects exactly the words the
  gate reports.
- The page half of F3 depends on F2's `evaluateCarrierPairs` and
  `<CarrierMatchBlock>`, on F0's `portrait_acknowledged_at` and
  `independent_login_at` columns and `acknowledge_portrait_v1`, and on the
  `<OutcomeDots>` renderer; the library exposes `canonicalCross`,
  `autosomalCross`, `xLinkedCross`, `crossShares` (returning `Partial<Record<MendelOutcome, number>>`, so an absent outcome is an absent key, never a zero), `distribute`,
  `readTraitAllowlist`, `traitStatus` and the copy for it to consume.
- Reversing any part of this scope — a sixth trait, a polygenic
  distribution, a rendered sex card — means editing X10.1 or §4 §5.4 and
  writing a superseding ADR, not editing this one.
