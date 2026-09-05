# Report count contract

## Authority and scope

G4.3 is read through the overriding X4/X5.1 taxonomy and ADR 0011. DOM
`data-figure-class` is `variant-call` or `estimate`; the database layer is
`variant_call` or `estimate`. The older count attribute and class names are
not additional requirements. No database taxonomy changes here. Definitions
remain exactly those approved in ADR 0022 and `src/copy/reports/strings.ts`.

`Count` requires one layer and one definition id. Runtime validation refuses
missing/mixed/legacy layers, negative/fractional/nonfinite/unsafe counts and
missing or multiple definition ids. The unavailable-score presentation only
accepts an estimate; starter counts must be between one and five. These
guards cannot establish the provenance of an arbitrary caller's number:
the caller inventory, source-layer partition and exact seeded browser checks
are also required. A number being tagged does not by itself prove correctness.

## Complete rendered-count inventory

| Surface | Count source and presentation | Definition / proof |
| --- | --- | --- |
| Overview library metrics | Published non-fixture templates counted independently by their declared layer, through `Count`; zero halves suppressed | Exact visible adjacent definitions; both nonzero seeded layers checked |
| Overview starter set | Existing deterministic, covered, eligible up-to-five selection; `StarterReports` partitions by layer before counting | Exact prescribed starter wording, classified node, adjacent layer link to the visible exact definition; homogeneous and mixed grouping/render tests |
| Own and authorized shared-subject report lists | Each authorized layer's covered subset and library total, counted separately | Active definition visible; inactive count itself opens the exact definition in one native disclosure; no new access gate |
| Unavailable polygenic models | Existing `unavailablePolygenicCount`, not the whole single-locus estimate catalog; classified estimate with exact unchanged unavailable sentence | Exact estimate definition; helper and component refusal tests |
| Category show-all controls | Filtered cards from one server-selected layer only, through `Count` | Active exact definition; before/after expansion and search checked |
| Category filter chips and layer tabs | No numeric subset total; category chips remain within one library layer, tabs name their own layer | Each references the exact applicable definition; no merged count |
| Genome hub and global search | Report destinations, no report totals | Browser audit includes hub, open search dialog and matching/empty search states |
| Legacy `/reports` routes | Redirect to the same canonical subject list/detail | No independent count renderer |
| Individual report details | No count of reports; cited-source and observed-position quantities retain their distinct existing meanings | Existing skeleton/Medicines browser checks run alongside count checks |
| Report-ready email | Legacy queue payload remains accepted, but its combined catalog count is not displayed | Same ready notification and dashboard link; rendered template checks reject numeric report totals |
| Research digest email | Individual entries and a nonnumeric new-report introduction | No count token |
| Public changelog | Nonnumeric event disclosure; every relabelled entry and before/after label remains | Browser audit includes changelog |

File counts, artifact row totals in downloadable export manifests, cited
source counts and scientific position coverage are not counts of report
layers and are not relabelled as such. User-authored/chat-provider prose is
not catalog count chrome. This change does not modify those data contracts.

## Starter wording reconciliation

Section 7.2 requires the exact Five/{n} starter sentences; ADR 0010 permits
both variant calls and single-locus estimates in that selection. X5.1 forbids
a combined count. Homogeneous selections therefore keep the original exact
sentence through `Count`. Mixed selections retain the same selected links,
the same overall cap and within-layer order, but render separate homogeneous
sections with each group's exact count sentence and definition link. No
mixed total is displayed. Paragraphs preserve the four-heading Overview
budget. Eligibility, evidence thresholds and excluded categories do not change.

## Evidence and remaining acceptance step

The independent browser detector scans the smallest numeric or worded
report-count elements, including split text nodes; it does not trust known
count slots alone. It checks one canonical class, a valid numeric attribute,
one count token, exact reachable definition and no mixed-class headline.
Mutation checks inject missing/mixed classes, a mixed heading, an unclassified
split-span total, a dangling definition and the legacy attribute, and require
the detector to fail before restoring and rechecking the real page.

Actual-route tests cover no-file and processed-file states, both real seeded
layers, Overview, the hub, category expansion, local search, result filtering,
global search and changelog at desktop and phone widths. Existing report
definition, count, six-section, Medicines and Overview density assertions are
retained or strengthened. The main seed has 151 single-locus estimates and
eleven Medicines position reports: 162 is not a displayed combined count and
151 is not described as a count of polygenic models.

Local verification: 13 targeted production-browser tests passed with no skips
or retries; 1,618 combined unit tests, typecheck, scoped lint and the naming,
secret and readability gates passed after integration with main `f6d7cca`.
No hosted data or source templates were edited. G4.3 remains NO pending the
complete reviewed PR acceptance run; component tests alone are not closure.
