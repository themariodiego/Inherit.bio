# Report confirmation policy — owner decision 2 October 2026

The owner selected adding the extra laboratory-confirmation text to Emerging.
The closed scope is `clinical`, `established`, `emerging`. `preliminary` and
`insufficient` do not acquire this additional block. This does not change which
reports may publish or any classification, reviewer, model or activation rule.

On an actual report page, both paragraphs appear inside "How sure we are",
on the same page, without an accordion or additional action:

> This is a reading of a file you uploaded, not a clinical test. Before acting on it, ask a doctor or genetic counsellor to confirm it in an accredited laboratory.

> We don’t have a counsellor to point you to where you are. Your doctor can refer you.

These are the unchanged `CONFIRMATION_BLOCK` and `COUNSELLOR_NO_ROUTE` strings.
The existing renderer uses `CONFIRMATION_LEVELS.has(template.evidence)` for both.
No source read or page data is added. The warning does not assert that Inherit,
the file, the finding or the owner has clinical accreditation or review.

Keep every original result, no-range/not-covered explanation, non-diagnostic
line, evidence definition, study context, citation, coverage/provenance receipt
and subject attribution. The six report headings, order, full content and all
existing safety obligations stay. The new copy is scroll-reachable plain text;
it does not displace the primary finding or introduce a disclosure control.
The 60% density rule and the previously declined redesign stay.

Strict policy/source checks and the original copy tests cover the closed levels,
exact text, real renderer wiring and refusal of planted missing/hidden/wrong-level
blocks. Added browser assertions use the already generated actual own-file report
on both registered viewport sizes, prove its Emerging label and both paragraphs,
and retain its genotype/attribution, limitations, six headings and safety text.
The original report skeleton assertions are unchanged. Full actual browser,
accessibility, readability and final combined qualification remain required;
this contract document records no execution or clinical acceptance.
