# Readability audit

Date: 2026-09-01

Baseline: `864736979c92a08ba77e8580d61946eba6864918`

Run:

```sh
pnpm gate:readability
```

The first deterministic extraction covers 1,443 user-visible blocks:

- 912 long blocks from static TSX, the 151 report templates, rendered provider
  fields, and seeded consent artifacts;
- 393 short strings selected by rendered role;
- 255 onboarding, consent-summary, result-headline, status, and error blocks
  subject to the 25-word sentence cap.

The pinned ten-case scorer self-test passes. The short-role vocabulary and
sentence-length rules are clean. The command currently exits non-zero with
455 long-block grade findings, concentrated in the existing report-template
library and long marketing/legal copy. There is deliberately no baseline
allowance and the command is not yet wired into CI.

Before G1.10 can become YES, the extractor must also prove coverage for strings
assembled entirely from runtime data and for chart-axis labels registered by a
chart component. Those surfaces are not claimed by the current static corpus.

Remediation must keep every uncertainty, applicability, and provenance clause.
Punctuation-only splits are acceptable only when both resulting sentences are
grammatical. Any wording change to a scientific template must retain the same
direction, magnitude, population, evidence status, and limitation before the
gate can be promoted to required CI.
