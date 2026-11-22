# Neanderthal estimate: pending owner source review

Status: **pending**. No reviewer and no review date are recorded, because no
review has happened. This note exists so the two items below are registered as
awaiting the owner's reading, the way other unreviewed claims are registered
pending review — not to imply any of them has been reviewed.

The Neanderthal estimate itself ships under TEST-LOCAL now: it is computed from
a licence-checked marker list (`data/ref/neanderthal/PROVENANCE.md`, CC BY 4.0)
and tested on synthetic data. Two things depend on this review and are held off
until it is recorded.

## 1. The comparison figure (held off, owner decision 2026-10-16)

The owner's decision (G7.4, `docs/protocol/decisions.md`): "The Neanderthal
comparison figure still needs the owner's source review before it is shown."

The card is built so the comparator stays hidden until that review is recorded:
`NEANDERTHAL_COMPARISON_REVIEWED` in `src/lib/genome/neanderthal-availability.ts`
is `false`, and the card renders no comparator sentence while it is false
(`src/components/results/ancestry/neanderthal-card.tsx`, asserted by
`src/components/results/ancestry/ancestry.test.ts`). No comparator wording is
shipped at all.

What the owner must supply and review before it can be shown:

- The brief's draft comparator (§4.6) — "In people with ancestry outside Africa
  this is usually a little under 2%. People with only sub-Saharan African
  ancestry usually show a smaller share, but not zero." — was written for a
  **genome-wide ancestry proportion**. Inherit's statistic is different: the
  fraction of covered panel sites carrying a Neanderthal-derived allele (brief
  line 2265), which is not a genome-wide proportion and whose typical values
  depend on this specific panel. A comparator for this statistic needs a
  source that measured **this quantity on this panel**, not the genome-wide
  figure, with a citation and the reviewer's access date.
- Until then, no typical-range sentence and no "Where this comes from" review
  date for a comparator exists, and none is rendered.

## 2. The brief's mandatory "0%" coverage caveat

Brief §4.6 marks this caveat mandatory on the card: "A 0% result from an array
file usually means your file cannot measure this, not that you have none." It
is **not shipped yet**. The string carries a percentage ("0%"), so the
citation-surface gate (`scripts/citation-surface-gate.ts`, G4.7) treats it as
an unsourced claim on a scanned surface. Closing that needs either a registered
citation in `data/claims.json`/`data/citations.json`, or a reviewer's
`product-wording` verdict in `docs/claim-surface-backlog.json` — and the
reviewer's verdict may not be fabricated, while the backlog's open-count ratchet
refuses a new open entry. So the caveat is folded into this review: the owner
(or the named reviewer) decides whether it is product wording (closed via the
backlog) or a claim to register with a source, and it is added to the card at
the same time. Until then the card states the file limit plainly in the
not-covered state and does not show the "0%" caveat.

## 3. The panel's population choice

`data/ref/neanderthal/sites.json` was built from the CEU, CHB and GIH Sprime
results (European, East Asian, South Asian 1000 Genomes panels). This is an
engineering default chosen for broad non-African coverage; it changes which
segments, and therefore which sites, enter the panel. It is **not** a reviewed
scientific choice. The owner should confirm the population set (and whether to
include or exclude others) as part of reviewing the estimate's scientific
presentation.

## Sign-off (unsigned)

- Reviewer: _not yet assigned._
- Review date: _none._
- Outcome: _pending._

When this review is recorded, set `NEANDERTHAL_COMPARISON_REVIEWED` with the
reviewed comparator and its citation, add the comparator's source to the
ancestry page's "Where this comes from" with the review date, and register the
comparator as a reviewed claim in `data/claims.json`.
