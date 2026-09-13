---
# RESEARCH, NOT A DETERMINATION. Every conclusion field below is blank on
# purpose and must stay blank until a qualified person fills it in. This file
# is not named by any decision in data/jurisdictions.json and pnpm
# gate:jurisdictions does not read it.
kind: research
jurisdiction: US
capabilities: []          # which of the twelve this bears on — for the reviewer to scope
reviewer:                 # BLANK. The person accountable for the determination.
qualification:            # BLANK. Theirs, in their own words.
status:                   # BLANK. permitted | prohibited. Not decided here.
reviewedOn:               # BLANK.
gitSha:                   # BLANK.
researchedBy: automated research, 2026-09-13
researchedNote: >-
  One instrument gathered and quoted verbatim from the official publisher. No
  conclusion is drawn about what it requires of Inherit, and none should be
  inferred from which instrument was chosen or from how much is missing.
---

# United States — instruments bearing on genetic-data processing

## Status of this file

Research, and thinner than the United Kingdom file beside it. It names one
federal instrument and quotes it. **It does not say whether any Inherit
capability may run in the United States**, and the absence of an instrument
here is not evidence that none exists — the gaps section is longer than the
findings section on purpose.

There is a second reason to read the gaps first. The United States is not one
jurisdiction for this subject. Federal law sets a floor in specific contexts;
the provisions that most directly govern a consumer genomics service are
STATE laws, and none of them is here.

## Instruments retrieved

### 42 U.S.C. §2000ff — definitions, Genetic Information Nondiscrimination Act

- Source: https://www.govinfo.gov/content/pkg/USCODE-2023-title42/html/USCODE-2023-title42-chap21F-sec2000ff.htm
- Publisher: U.S. Government Publishing Office (govinfo), United States Code, 2023 edition
- Retrieved: 2026-09-13T04:04:57.177Z
- Snapshot: `docs/sources/jurisdictions/us-42-usc-2000ff-genetic-information.json`
- Page date in the bytes: none — the page carries no last-updated date

Verified verbatim:

> such individual's genetic tests, (ii) the genetic tests of family members of such individual, and (iii) the manifestation of a disease or disorder in family members of such individual

**Why this one is here:** it is the federal statutory definition of "genetic
information", and its third limb is the one a Family product runs into
directly — the definition covers what is known about a person's RELATIVES, not
only about them. Whether Inherit's processing engages the Act, and in which of
its titles, is the determination and is not answered here.

### 42 U.S.C. §2000ff — definition of "family member"

- Source: the same page and the same snapshot family
- Snapshot: `docs/sources/jurisdictions/us-42-usc-2000ff-family-member.json`
- Retrieved: 2026-09-13T04:05:03.765Z

Verified verbatim:

> any other individual who is a first-degree, second-degree, third-degree, or fourth-degree relative of such individual

**Why this one is here:** it is quoted separately because it is the term the
definition above turns on, and because the degree range is a concrete fact a
reviewer can check Inherit's Family and Portrait surfaces against. It is
recorded as a definition, not as a limit on anything Inherit does.

## GAPS IN THIS RESEARCH, stated so the reviewer is not misled by its shape

This is a starting point and is **not** a picture of United States law on this.
Known to be missing:

- **The operative sections of GINA.** Only the definitions were retrieved.
  Title I (health insurance) and Title II (employment) are the sections that
  prohibit anything, and neither is quoted here. A guessed govinfo path for
  42 U.S.C. §300gg-53 returned govinfo's "Page Not Found" — **served with HTTP
  200**, so a status check alone would have recorded it as retrieved. Find the
  real granule identifier before quoting it.
- **HIPAA, 45 CFR 160.103**, which carries its own definition of genetic
  information. Not retrieved: `www.ecfr.gov` serves programmatic clients an
  anti-scraping "Request Access" page and directs callers to an API, and the
  renderer API path tried returns 404. Until it is fetched it cannot be cited.
- **Every state law**, and this is the largest gap. A consumer genomics service
  is governed in the United States chiefly by state genetic-privacy statutes
  and state consumer-data laws, which differ from each other. Inherit already
  ships a `/legal/state-genetic-privacy` page; nothing in it is sourced here.
- **The FTC Act's unfairness and deception authority**, which is how a federal
  regulator would most plausibly reach a consumer genomics service, and which
  is not a genetics statute at all.
- Anything specific to **embryo testing**, which is regulated by state law and
  professional bodies rather than by any of the above.

The reviewer should treat the list above as the minimum still to read, not as
an exhaustive list of what is missing. In particular, a determination that
cited only GINA would be citing an employment and insurance statute for a
question about a consumer product.

## What a determination would still have to do

State which capability it decides, cite the provision that permits or
prohibits it, say what conditions attach, and be signed by a named person with
their qualification — then be recorded at
`docs/reviews/jurisdictions/US/{capability}.md` per
`docs/reviews/jurisdictions/TEMPLATE.md`, with the matching decision in
`data/jurisdictions.json` carrying its `review` object. Until that exists the
resolver reads US as `unreviewed` and every restricted capability stays off,
which is the correct behaviour and not a bug to route around.

It would also have to say which United States it means. `data/jurisdictions.json`
carries one code per jurisdiction, and a single `US` determination would assert
something uniform about fifty states that do not agree.
