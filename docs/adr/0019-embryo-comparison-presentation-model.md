# ADR 0019: The embryo comparison presentation model: a matrix in file order, never a ranking

- Status: Accepted
- Date: 2026-09-04
- G7.1 name: "the embryo-comparison presentation model"
- Absorbs the brief's A.12 names "embryo-comparison-not-ranking" and "no-cognitive-ability-or-embryo-sex-outputs"

## Context

The brief puts several embryos side by side on one page (`brief:388-396`,
`brief:1376-1412`) and forbids everything a comparison page usually does
with them: a rank, a composite, a "best", a sort by any computed quantity,
a lead count, an embryo's sex (`brief:2087-2090`, X10.2, X10.3). G4.5
(`brief:2632`) requires the joint-selection constraint and the exact
sentence "Inherit does not rank embryos and does not recommend one." on
every such surface, and the register's `embryo-autosomal-only-v1` binds the
closed shapes, the two permitted orders and the `tradeOffs.forbidden` list.
The condition registry (`data/embryo/allowed_conditions.json`) is empty, so
no condition row exists today; the model below is what every future row
renders into. The Embryo surfaces of design `docs/design/w10-embryo-surfaces.md`
(part E1, merged as PR #47) implement it.

## Decision

1. **The matrix is in file order and nothing reorders it.** Columns are
   embryos in ascending `sample_ordinal`, every one of them: a failed embryo
   keeps its full column with the quality chip and its reason in the footer.
   Rows are conditions in ascending registry `condition_id`. No `<th>` is a
   button, none carries `aria-sort`, and no control on the page changes
   column or row order (`src/lib/embryos/policy.ts` `filtersAndSorts`,
   `src/components/embryo/compare/compare-table.tsx`).
2. **Every number is an attributed figure.** Each cell renders one claim
   block attributed to that embryo's subject; the embryo's own figure is
   captioned as the embryo's and a population figure appears at most once
   per cell (`compare-cell.tsx`; the figure contract, ADR 0009).
3. **The trade-off panel is satisfied by statement.** It is permanent,
   non-dismissible and outside any collapsible. `deriveTradeOffs`
   (`src/lib/embryos/trade-offs.ts`, the one home of the conflict rule) runs
   over the full published matrix and returns a statement id and the named
   real conflicts — an embryo that alone has the lowest value on one row
   and the highest on another — with ties excluded. It exposes no per-embryo
   count, no composite and no order; with nothing measurable it states that
   there is no trade-off to show (`trade-off-panel.tsx`).
4. **Colour is suppressed.** The embryo chip and disc carry no subject
   colour and the compare surface renders no direction, state or evidence
   colour token; an embryo is "E" in a neutral disc.
5. **Sex never reaches the page.** Non-autosomal records are discarded at
   ingest without recording presence or count (register `ingress`); every
   closed shape refuses the sex, karyotype and laboratory-label keys of
   `forbiddenShapeFields` (`FORBIDDEN_SHAPE_FIELDS`); no jurisdiction has a
   sex row, so `brief:485` acceptance 25 is restated under X10.2.
6. **One standing statement, once.** The §4 §6.1 sentence (`brief:1376`) is
   the one rendered version: above the table, verbatim, on every load,
   never collapsible. The §2 and §3 variants of the same claim are not
   rendered (design open decision 1).
7. **Condition-first, without spread ordering.** Rows follow registry
   order, never the spread of values; a score not shown to hold up between
   siblings carries the within-family sentence beside it. Until a condition
   is registered the page says so in one sentence and shows the quality
   check, which is the one thing measured.

## Alternatives rejected

- **Sortable rows** (`brief:388`): killed by X10.3 — a sort key over a
  computed quantity is a ranking by another name.
- **A spread-ordered condition list and lead counts** (`brief:1024`,
  `brief:1027`, `brief:1411`): killed by X10.3 and the register's
  `tradeOffs.forbidden`; "leads on 3 of 5" is a composite.
- **A consented sex toggle** (`brief:396`): killed by X10.2 and by the data
  itself — the sex-bearing records are discarded at ingest, so no toggle
  could reveal them.
- **A stored PDF laboratory record** (`brief:379`): killed by ADR 0016 —
  a PDF is refused before any durable byte.

## Consequences

- `/embryos/compare` and `/embryos/[embryoId]` render today with quality
  columns, zero condition rows and the registry sentence; part E3 adds
  finding cells into this model without changing it.
- Pinned by `src/lib/embryos/policy.test.ts`, `src/lib/embryos/trade-offs.test.ts`,
  `src/components/embryo/embryo.test.ts`, `src/copy/embryos/embryos.test.ts`
  and `e2e/embryos.spec.ts`; the compare-page browser proof over a
  published cohort (`e2e/embryo-compare.spec.ts`) waits on an ingest path.
- A future change to any numbered point above is a superseding ADR, not a
  drift.
