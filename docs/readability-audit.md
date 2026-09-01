# Readability audit

Date: 2026-09-01

Baseline: `864736979c92a08ba77e8580d61946eba6864918`

Run:

```sh
pnpm gate:readability
```

The deterministic extraction currently covers 1,437 user-visible blocks:

- 907 long blocks from static TSX, the 151 report templates, rendered provider
  fields, and seeded consent artifacts;
- 393 short strings selected by rendered role;
- 252 onboarding, consent-summary, result-headline, status, and error blocks
  subject to the 25-word sentence cap.

The pinned ten-case scorer self-test passes. The short-role vocabulary and
sentence-length rules are clean. The command currently exits non-zero with
430 long-block grade findings, concentrated in the existing report-template
library and long marketing/legal copy. There is deliberately no baseline
allowance and the command is not yet wired into CI.

The first remediation pass removed 22 genuine findings from application UI and
reusable components without deleting caveats. It also corrected the extractor
so a parent status or list container no longer concatenates its nested heading
and paragraph into a synthetic copy block. Three regression tests prove that
nested blocks remain separate, inline markup remains part of its block, and
visible text attributes are still extracted. Two Copilot paragraphs remain in
the application-route set because the brief separately requires their current
wording verbatim; that conflict must be resolved without silently exempting
them from G1.10.

Before G1.10 can become YES, the extractor must also prove coverage for strings
assembled entirely from runtime data and for chart-axis labels registered by a
chart component. Those surfaces are not claimed by the current static corpus.

Remediation must keep every uncertainty, applicability, and provenance clause.
Punctuation-only splits are acceptable only when both resulting sentences are
grammatical. Any wording change to a scientific template must retain the same
direction, magnitude, population, evidence status, and limitation before the
gate can be promoted to required CI.
