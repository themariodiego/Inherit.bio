# Jurisdiction research — NOT determinations

**Nothing in this directory is a determination, and nothing here may be copied
into `data/jurisdictions.json` as one.** Every conclusion field is blank on
purpose. These files gather instruments so that a qualified person has
something concrete to read; they do not say what the instruments mean for
Inherit, and they are not evidence that anybody reviewed anything.

The operator asked on 2026-09-12 for research with a named human signing the
determination afterwards, after an earlier request — review each jurisdiction
and hand back a recommendation to sign — was declined and stayed declined.
That decline has not moved: G5.5 is structurally a human-review gate, and a
determination authored here and countersigned later would make its `reviewer`
and `qualification` fields assert that a qualified person reached it.

## What is filled in, and what is not

| field | here | why |
|---|---|---|
| instruments | **yes** | Named, linked, quoted verbatim, snapshotted. |
| quotes | **yes** | Verified present in the fetched bytes before being recorded. |
| access dates | **yes** | This machine's clock at the moment of the request. |
| `status` | **blank** | The determination. Not mine. |
| `reviewer` | **blank** | The person accountable. Not mine. |
| `qualification` | **blank** | Theirs, in their words. |
| what the law requires of Inherit | **blank** | That is the determination in prose. |

## The scoping decision, which is mine and is stated so it can be overruled

`realJurisdictionCatalog` holds **249** codes and there are **12** restricted
capabilities: 2,988 possible determinations. Researching all of them is not a
tractable task and would not help — nobody has decided where Inherit launches,
and research for a jurisdiction nobody has chosen is shelf-ware that expires
(the freshness contract warns at 300 days and fails above 365).

The operator said to choose. **I scoped the first tranche to where Inherit
would plausibly operate first**, and named the reasoning rather than the
result, so a different launch plan replaces it cleanly:

1. the jurisdiction the project is actually run from;
2. the EU/EEA, which one instrument covers for all of it;
3. the United Kingdom, adjacent and separately governed since 2020.

Anything else is added when a launch plan names it.

**Amended 2026-09-13, and the amendment is a scoping change rather than a
finding.** The EU tranche could not be built (below), so the second slot was
spent on the **United States** instead — chosen because Inherit already ships
`/legal/gina`, `/legal/insurance-and-discrimination` and
`/legal/state-genetic-privacy`, so the product already speaks about US law
whether or not anyone has researched it, and because its federal definitions
were reachable when the EU's text was not. That is a reason of convenience as
much as of plan, and it should be overruled the moment a launch plan says
otherwise. `US.md` says on its face that it is thinner than `GB.md` and that
the largest body of law it bears on — the state statutes — is absent.

## What could NOT be retrieved, recorded rather than worked around

**The EU's official text is not reachable from this environment**, and the
description of how it fails was corrected on 2026-09-13 after re-measuring:
the earlier note said EUR-Lex answers `202` with an empty body to every route,
which is not what happens.

What happens, over eight requests:

- the ELI form, `/eli/reg/2016/679/oj/eng`, answers **200** — with the Official
  Journal LANDING page, 13,692 bytes, not Regulation 2016/679. It answers
  correctly and serves the wrong document, which is the failure mode a status
  check cannot see;
- `/legal-content/EN/TXT/?uri=CELEX%3A32016R0679` and the `/TXT/HTML/` form
  **time out**, at 25s, 40s, 60s and 150s alike;
- `data.europa.eu/eli/reg/2016/679/oj` answers **502**;
- the CELLAR resource answers 200 with a 60MB bundle and rejects
  `Accept: text/html` with **400**.

One early probe of the ELI form returned 1,070,540 bytes. Its content was
never checked and it did not reproduce in six later attempts, so it is
recorded as an unverified anomaly rather than as evidence the text is
retrievable.

`gdpr-info.eu` serves the article text and is reachable. **It is not cited
here.** It is a third-party reproduction, and a legal research package whose
whole value is that a reader can check the source against the authority should
not quote a mirror of the Official Journal in place of the Official Journal.
Citing it would look like EU research had been done.

So the EU tranche is **not** in this package. It needs either an environment
that can reach EUR-Lex or a person with a copy of the Official Journal text.

**HIPAA's definition could not be retrieved either.** `www.ecfr.gov` serves
programmatic clients an anti-scraping "Request Access" page and points at its
API; the renderer API path tried returns 404. So 45 CFR 160.103 is named as a
gap in `US.md` rather than quoted, for the same reason `gdpr-info.eu` is not
cited: a research package is worth having only if every quote in it can be
checked against the authority that published it.

## How the sources here were captured

`scripts/glossary/fetch-source.mjs <term> <url> "<quote>" docs/sources/jurisdictions`
— the same verified-fetch path the glossary uses, deliberately, so there is one
tool whose checks can be audited rather than two that drift. It refuses to
record a quote it cannot locate in the raw bytes, and it records a page date
only when the bytes carry one. That second rule exists because a summarising
fetch invented a "last updated" date on 2026-09-12 for a page that carries
none.

**One trap found on 2026-09-13, worth knowing before the next fetch:
govinfo serves its "Page Not Found" with HTTP 200.** A guessed granule path
for 42 U.S.C. §300gg-53 came back 200 with 44KB of navigation chrome, and only
reading the bytes showed it was an error page. The fetch tool would have
refused to record a quote from it — which is the tool working — but a probe
that checks status codes alone would have logged the URL as reachable.
