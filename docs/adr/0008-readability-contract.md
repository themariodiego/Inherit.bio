# ADR 0008: Readability scoring and vocabulary contract

- Status: Accepted
- Date: 2026-09-01

## Context

The application mixes short interface labels, long scientific explanations,
and legal text. A single threshold or a word-count proxy would either reject
necessary legal detail or leave headings and buttons unchecked. Scientific
identifiers also distort syllable-based scores even though readers treat them
as opaque labels.

## Decision

`pnpm gate:readability` is the sole readability command. It uses
`flesch-kincaid@2.0.1` with `syllable@5.0.1`, both pinned exactly. Ten committed
fixtures run before the repository scan and permit no score drift above 0.2.
rsIDs, gene symbols, units, hashes, coordinates, and numerals become one
one-syllable placeholder before scoring.

Long blocks must score at or below grade 9, with grade 11 reserved for legal
routes and grade 9 retained for their plain summaries. Short strings are
checked by rendered role against `data/plain-vocabulary.json`; the five
technical labels named by G1.10 must be replaced with plain words. The separate
`data/jargon.json` register supplies short definitions and normalization for
terms of art. Safety-critical onboarding, consent-summary, result-headline,
status, and error sentences have a 25-word cap.

The gate has no baseline allowance. It is added to pull-request CI only after
the complete corpus is clean; until then its non-zero audit is recorded rather
than hidden.

## Alternatives rejected

- A home-grown grade formula was rejected because an unversioned scorer could
  drift without a dependency change.
- Ignoring strings under 15 words was rejected because headings, buttons,
  labels, table headers, and status messages are the text people act on.
- Treating every technical token as an ordinary word was rejected because
  identifiers and measurements create unstable syllable counts unrelated to
  comprehension.
- A grandfathered violation count was rejected because it would make the gate
  permanently green while known difficult copy remained visible.

## Consequences

The scorer and corpus extractor can land before the copy is fully remediated,
but G1.10 remains NO and CI remains unchanged while any finding exists. Copy
repairs must preserve mandated caveats and scientific meaning; deleting a
qualification to lower a score is not an acceptable fix.
