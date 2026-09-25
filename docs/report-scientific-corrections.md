# Corrections to historical report wording

Saved report templates and outcomes remain immutable. Correcting the current
catalog does not change an earlier result or make its explanation current.

`data/report-scientific-corrections.json` records 32 exact earlier fields from
the reviewed ADORA2A, APC, FGFR2, ALDH2, TREM2, APOE and TCF7L2 changes: seven summaries,
24 genotype explanations and the ALDH2 title. Each batch names the preceding
and corrected Git revisions, template path and dated source review. The pure
matcher requires the exact report and field identity and original wording.
Unknown or unregistered wording is not classified as incorrect or current.

Report details and library cards show a generic historical-wording notice.
It is based on public template definitions and does not identify a person's
genotype. Existing sensitive-result gates and source checks still control
personal outcomes. JSON exports add sibling correction metadata; text exports
place the notice first. Original templates, outcomes, calls, dates and catalog
hashes remain unchanged. Known outcomes without a captured catalog can match
only an exact saved genotype explanation with the resolver's canonical
genotype and explicit, valid strand flag.

Copilot inspects the already-authorized report context before consuming a new
conversation nonce or connecting to a provider. A known correction refuses
the turn with no provider call or new chat commit. This applies to existing
assistant paraphrases as well as tool results. Stored history stays unchanged
and readable with a notice. It deliberately blocks the whole affected context,
including an uncovered report whose captured template contains corrected
wording. A new conversation or renewed permission does not refresh that text.
An actually changed source projection resets the client panel, and the server
checks the new context again. Existing session, source and purpose checks are
preserved; no new database operation or migration is introduced.

The regression suites cover exact and nonmatching strings, opposite-strand
outcomes, immutable exports, own and Family reveal gates, authority changes,
bounded pagination, historical paraphrases, zero provider/commit calls and
client recovery. Current-report browser cases also assert that no false notice
appears. Those browser assertions require CI; no old-capture browser journey
is claimed by the local tests. Local route tests execute the page components,
but generated route types and complete browser behavior remain CI checks.

This finite register does not establish full-catalog accuracy, human clinical
review, hosted deployment or release completion. No captured result is silently
regenerated, and no acceptance row changes in this patch.

Merging a correction does not deliver it: deploying code never refreshes a
hosted catalog. On 25 September 2026 production still held the registered
earlier text of all eight batches (D-134); it was refreshed the same day with
the owner's approval, and the three reports already captured keep their
notice. `pnpm gate:catalog-drift` reports that condition against a deployed
database and is the check to run after every deploy and refresh.
