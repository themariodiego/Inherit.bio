---
# RESEARCH, NOT A DETERMINATION. Every conclusion field below is blank on
# purpose and must stay blank until a qualified person fills it in. This file
# is not named by any decision in data/jurisdictions.json and pnpm
# gate:jurisdictions does not read it.
kind: research
jurisdiction: GB
capabilities: []          # which of the twelve this bears on — for the reviewer to scope
reviewer:                 # BLANK. The person accountable for the determination.
qualification:            # BLANK. Theirs, in their own words.
status:                   # BLANK. permitted | prohibited. Not decided here.
reviewedOn:               # BLANK.
gitSha:                   # BLANK.
researchedBy: automated research, 2026-09-12
researchedNote: >-
  Instruments gathered and quoted verbatim from the official publisher. No
  conclusion is drawn about what they require of Inherit, and none should be
  inferred from which instruments were chosen.
---

# United Kingdom — instruments bearing on genetic-data processing

## Status of this file

Research. It names instruments and quotes them. **It does not say whether any
Inherit capability may run in the United Kingdom**, and the absence of an
instrument here is not evidence that none exists — see the gaps section.

## Instruments retrieved

### Data Protection Act 2018, section 205 — definition of "genetic data"

- Source: https://www.legislation.gov.uk/ukpga/2018/12/section/205
- Publisher: legislation.gov.uk (King's Printer of Acts of Parliament)
- Retrieved: 2026-09-12T10:28:51.123Z
- Snapshot: `docs/sources/jurisdictions/gb-data-protection-act-2018-section-205.json`
- Page date in the bytes: none — the page carries no last-updated date

Verified verbatim:

> personal data relating to the inherited or acquired genetic characteristics of an individual which gives unique information about the physiology or the health of that individual

**Why this one is here:** it is the statutory definition of the category
Inherit's files fall into. Whether Inherit's processing engages it, and on what
lawful basis, is the determination and is not answered here.

### Data Protection Act 2018, section 10 — special categories and Article 9

- Source: https://www.legislation.gov.uk/ukpga/2018/12/section/10
- Publisher: legislation.gov.uk (King's Printer of Acts of Parliament)
- Retrieved: 2026-09-12T10:28:33.896Z
- Snapshot: `docs/sources/jurisdictions/gb-data-protection-act-2018-section-10.json`
- Page date in the bytes: none — the page carries no last-updated date

Verified verbatim:

> make provision about the processing of personal data described in Article 9(1) of the

The section then enumerates the Article 9(2) exceptions it makes provision
about: point (b) employment, social security and social protection; point (g)
substantial public interest; point (h) health and social care; point (i) public
health; point (j) archiving, research and statistics.

**Why this one is here:** Article 9(1) prohibits processing special-category
data, and the exceptions are where any lawful route would have to be found.
Which exception, if any, applies to a consumer genomics service is the
determination.

## GAPS IN THIS RESEARCH, stated so the reviewer is not misled by its shape

This is a starting point and is **not** a complete picture of UK law on this.
Known to be missing:

- **UK GDPR itself.** Section 10 operates on Article 9 of the UK GDPR, and that
  text was not retrieved. The assimilated instrument's official text needs
  fetching separately; nothing here quotes it.
- **Schedule 1 of the DPA 2018**, which sets the conditions for the Article 9(2)
  exceptions section 10 points at. Without it the exceptions above are names
  rather than requirements.
- **Human Tissue Act 2004** and any provision on DNA analysis without consent,
  which may bear on a service that analyses a sample-derived file.
- **ICO guidance**, which is not law but is what a regulator would apply.
- Any provision specific to **insurance or employment use** of genetic results.
- Whether **Scotland or Northern Ireland** differ on any of the above; the DPA
  extends UK-wide but related provisions may not.

The reviewer should treat the list above as the minimum still to read, not as
an exhaustive list of what is missing.

## What a determination would still have to do

State which capability it decides, cite the provision that permits or
prohibits it, say what conditions attach, and be signed by a named person with
their qualification — then be recorded at
`docs/reviews/jurisdictions/GB/{capability}.md` per
`docs/reviews/jurisdictions/TEMPLATE.md`, with the matching decision in
`data/jurisdictions.json` carrying its `review` object. Until that exists the
resolver reads GB as `unreviewed` and every restricted capability stays off,
which is the correct behaviour and not a bug to route around.
