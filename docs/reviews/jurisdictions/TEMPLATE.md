---
path: docs/reviews/jurisdictions/{JURISDICTION}/{CAPABILITY}.md
reviewer: 
qualification: 
jurisdiction: {JURISDICTION}
capability: {CAPABILITY}
scope: /realJurisdictions/{JURISDICTION}/capabilities/{CAPABILITY}
status: 
reviewedOn: 
gitSha: 
outcome: approved
---

<!--
  THIS IS A TEMPLATE. It is not a review and it is not valid until a qualified
  person completes it. `pnpm gate:jurisdictions` ignores this file: it reads
  only records named by a decision in `data/jurisdictions.json`, and no
  decision names this path.

  Copy it to docs/reviews/jurisdictions/{CODE}/{capability}.md, substituting
  the alpha-2 country code (optionally with a subdivision, e.g. `GB` or
  `US-CA`) and one of the twelve restricted capabilities.

  WHAT EACH FIELD ASKS, so that nothing is filled in by pattern-matching:

  reviewer       The name of the human being who reached this conclusion. CI
                 checks that it is present and that the sign-off line matches
                 it. It makes no judgement about who you are.
  qualification  That person's relevant professional qualification, in their
                 own words. CI checks presence and exact equality only. It
                 cannot and does not assess whether the qualification is
                 adequate for this determination.
  status         `permitted` or `prohibited`. There is no third answer here:
                 a capability nobody has decided about stays `unreviewed` in
                 data/jurisdictions.json with `review: null`, and needs no
                 record at all.
  reviewedOn     The UTC date the determination was made, YYYY-MM-DD. It
                 expires: the freshness contract warns after 300 days and
                 fails above 365, so this is a standing obligation rather
                 than a one-time unlock.
  gitSha         The full 40-character commit sha of the tree the decision was
                 read against, so a later change to the decision cannot
                 inherit this approval.
  outcome        Always the literal string `approved`. A determination that
                 does not approve something is recorded as `status:
                 prohibited`, not as a different outcome.

  THE BODY BELOW IS THE DETERMINATION ITSELF. Nothing generates it and nothing
  should: it is the reasoning a qualified person is accountable for. At
  minimum it should say which instruments were consulted, what they require,
  and what the reviewer concluded for this one capability in this one
  jurisdiction.

  The final non-blank line of this file must be exactly
  `Signed-off-by: {the reviewer field}`. CI verifies that structurally and
  makes no claim about substantive qualification or independence.
-->

## Instruments consulted

## What they require

## Determination

Signed-off-by: 
