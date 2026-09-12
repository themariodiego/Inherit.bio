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

## What could NOT be retrieved, recorded rather than worked around

**The EU's official text is not reachable from this environment.** EUR-Lex
answers `202` with an empty body to every route tried
(`/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679`, the ELI form, and the
non-HTML form), which is a bot gate rather than a missing document.

`gdpr-info.eu` serves the article text and is reachable. **It is not cited
here.** It is a third-party reproduction, and a legal research package whose
whole value is that a reader can check the source against the authority should
not quote a mirror of the Official Journal in place of the Official Journal.
Citing it would look like EU research had been done.

So the EU tranche is **not** in this package. It needs either an environment
that can reach EUR-Lex or a person with a copy of the Official Journal text.

## How the sources here were captured

`scripts/glossary/fetch-source.mjs <term> <url> "<quote>" docs/sources/jurisdictions`
— the same verified-fetch path the glossary uses, deliberately, so there is one
tool whose checks can be audited rather than two that drift. It refuses to
record a quote it cannot locate in the raw bytes, and it records a page date
only when the bytes carry one. That second rule exists because a summarising
fetch invented a "last updated" date on 2026-09-12 for a page that carries
none.
