# Citations outside report templates

`pnpm gate:citations` measures claim-marked wording on the source paths in
`data/gates/claim-surfaces.json`: report copy, Copilot context, email, Portrait
and embryo cards. It runs locally without a server, network or database, and
in CI immediately after `pnpm gate:claims`.

Measured on 30 September 2026 after merging main `95a89f69`: 59 candidate
sentences across 103 files, none registered and none classified by a reviewer.
The 59 unresolved sentences are preserved in
`docs/claim-surface-backlog.json`; no source quotation, review verdict or
access date was added to make this gate pass. Its green result means the
measured backlog is exact and has not grown. G4.7 remains NO.

Current integration against release `587007a0`, measured 2 October 2026:
**59** candidates across **114** source files, still none registered and none
classified. The backlog is byte-exact to the original 59-entry ledger. All
11 added mail and embryo modules are scanned; no new marked sentence was found.
The current claims gate separately measures **71 of 227** template citations
and **120 of 750** prose blocks registered. That mechanical coverage and the
12 new abstract-bound sources do not constitute human review. The review
queue is in [citation-review-worklist.md](citation-review-worklist.md). This
is a proposed integration, not proof that the gate shipped on `587007a0`.

## What each gate proves

| Gate | Obligation |
| --- | --- |
| `gate:templates` | The template schema, citation identifiers, access-date structure and its undated-citation ratchet. |
| `gate:claims` | The citation and canonical-claim registers, template prose registration, resolving rendering provenance, and designated surfaces reaching the shared claim component. Its existing divergence ledger remains separate. |
| `gate:citations` | Candidate sentences extracted from the five non-template surface types, exact canonical wording with matching dated evidence, and an exact reviewer backlog for everything else. |

The gates complement each other. A citation-shaped template value does not
prove canonical registration, and a sourced source sentence does not prove
its rendered element carries provenance. None of them can establish that a
publication supports a statement without a person reading the source.
The earlier Part C count was 42 of 227 template citations; the current
mechanical count is 71 of 227. Human source review remains due. The October
tranche records bounded author-abstract retrieval, not publisher full-text,
genotype revalidation, clinical approval or a reviewer signature.

Glossary definitions follow the owner's 18 September decision that a
definition is not a claim. They are not added to this backlog.

## The mechanical rule

The gate uses the readability gate's TypeScript and JSX extraction, splits
the resulting copy into sentences, and checks a closed marker list:
percentages, multipliers, natural frequencies, rsIDs, effect measures,
associations and evidence language. The tests pin both the names and their
regular expressions. They also plant an uncited sentence on every surface
type and require the real repository scan to fail.

A candidate is registered only when its normalized sentence is an exact
sentence of a canonical claim in `data/claims.json`, every piece of that
claim's evidence resolves to `data/citations.json`, and each evidence access
date matches that citation's valid, non-future access date. A near match or
a citation without a matching canonical sentence does not pass.

This is a bounded static detector, not a claim of complete semantic coverage.
It cannot infer unmarked scientific assertions, evaluate runtime data, or
validate scientific support. In interpolated template strings the extractor
replaces each expression with the word `fact`; that is the text hashed in
the worklist. A reviewer must read the originating source and its rendering,
not treat that placeholder as a quotation from a publication.

## Reviewing the worklist

Each entry carries its surface, source path, normalized sentence and SHA-256.
New candidates without cited registration fail. Entries whose sentence has
disappeared or become registered also fail, so stale entries cannot mask a
changed product.

A person reviewing an entry may set:

- `product-wording`: the sentence is not a scientific fact. Record the named
  reviewer and a valid past or current `reviewedOn` date; it leaves the open
  count while remaining in the ledger.
- `claim-to-register`: the sentence is a fact awaiting source registration.
  Record the same review metadata; it stays open until its evidence is
  registered and its ledger entry removed.

`null` means no verdict has been reached. Do not invent a reviewer, date,
quote or verdict. Classification is human work, not a way to bypass a failing
gate.

`OPEN_BACKLOG` is currently 59. Both growth and an unexplained decrease fail.
After an earned closure, lower the pin to the measured count and record the
evidence in the newest dated test-diff entry. Never raise it to admit a new
unsourced claim or lower it without earning the closure. The baseline test
must move with that documented review.

To rebuild candidate entries while keeping all existing verdicts:

```bash
pnpm exec tsx scripts/citation-surface-gate.ts --write-backlog
pnpm gate:citations
```

Rebuilding is a review aid. It cannot lower the pin, approve a sentence or
register evidence. Inspect the diff before committing it.
