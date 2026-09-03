# ADR 0010: Overview information architecture

- Status: Accepted
- Date: 2026-09-03

## Context

`/overview` was a landing page with a headline, a list of domain tiles and a
"Data files" section. The specification's X9 requires the Overview to be a
hub that informs nothing: it points at the three domains, shows only counts a
reader can act on, and never renders a genetic value. The density baseline
(`docs/density-baseline.json`) budgets interactive elements in the first
viewport at seven when the account is empty and twelve when populated, and
the route register binds the page's headings to the navigation labels.

## Decision

- One `h1`, `Overview`, and three `h2` sections, `My Genome`, `Family` and
  `Embryos`, character-identical to the navigation labels in
  `src/copy/navigation.ts`. Four headings, never more; every other title on
  the page is a paragraph.
- Nine entry boxes, three per domain, each one link whose accessible name is
  exactly its label (Reports, Ancestry, Copilot; Individual risks, Portrait,
  Copilot; Upload, Compare your embryos, Copilot) with a one-line
  description of at most twelve words.
- Exactly one primary button per state: `I have a DNA file` (empty),
  `Add a file` (processing), `Open my reports` (one or more processed files,
  with or without other adults), `Compare your embryos` (embryo files).
- Every count carries a unit noun and a one-to-twelve-word note; library
  counts are per layer and never summed; a tile with nothing to count renders
  its empty sentence, never a dash. No figure, chart or genetic value renders
  on the page.
- The starter reading list shows up to five reports the subject's file
  covers, chosen by the recorded rule (`variant_call` or single-locus
  estimate, evidence clinical, established or emerging, outside the
  brain/mood and cancer categories), ordered by category rank then slug;
  "you have read the starter set" is not rendered because nothing records
  which reports were opened.
- The processing state shows a determinate step list and the measured p50
  and p95 for the file's tier only when at least twenty files of that tier
  have been measured; otherwise the honest "not enough files" sentence.
- Navigation is exactly five items (Overview, My Genome, Family, Embryos,
  Settings). The desktop rail is one `App` landmark including the wordmark;
  the phone navigation is a fixed 64px bottom bar of five labelled 44px items
  with no hamburger; the header's theme, e-mail and sign-out cluster is an
  `Account` landmark. Persistent chrome therefore sits outside the density
  count, exactly as the capture harness measures it.
- A dead link is never shipped: the "Show me what this looks like first"
  item renders only once an example route exists, and the Family and
  Embryos Copilot boxes link to their domain landing until the Copilot route
  serves group scopes.

## Alternatives rejected

- Tiles that carry results (a top risk, an ancestry share, a percentile).
  Rejected by X9.1 and by the density budget: a figure on the hub is a claim
  without its claim block, and the harness basis leaves no room for figure
  controls inside seven interactive elements.
- A Copilot dock on every page. Rejected by X1.2 and recorded in
  `docs/protocol/decisions.md`: Copilot is a route.
- An `/example/report` route reachable from the strip. Rejected by the route
  register's superseded proposals and G8.2 (no production path renders
  fixture data as user data); the strip renders two items until an example
  surface that satisfies G8.2 exists.
- Linking the Family and Embryos Copilot boxes to `/copilot/family` and
  `/copilot/{cohort}` now. Rejected because `src/app/(app)/copilot/[scope]`
  resolves only `me` and `s-{uuid}` and answers 404 for anything else; the
  E2E asserts every box target answers 200.
- A wrapping text row or a hamburger for phone navigation. Rejected: labels
  must stay visible and every item must meet the 44px target; the previous
  wrapping row could not guarantee either at 390px.

## Consequences

`src/copy/overview.ts` is the only source of the page's strings;
`e2e/overview.spec.ts` pins the four headings, the nine names, one primary per
state, the counts' shape, the first-viewport budgets at 1280×800 and 390×844
and the bottom bar. Adding a sixth navigation item or a fourth box to a domain
requires removing one. Recorded in `docs/protocol/decisions.md` (2026-09-03,
presentation decisions; example surfaces).
