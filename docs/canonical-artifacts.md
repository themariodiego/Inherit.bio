# Inherit v2 canonical artifacts

Status: binding  
Baseline application SHA: `864736979c92a08ba77e8580d61946eba6864918`  
Brief SHA: `d2ed08678f0ac29840519db11256084bb8b74653`  
Platform: GitHub `themariodiego/Inherit.bio`; Supabase project **Inherit** (`zuvloczwgrayonqabnss`); Vercel project `sequence` (`prj_K7bVowhjFr0uIapXraH41hthJkgy`) pending a separately reviewed platform rename.

This file is the index required by X0.2. An item has one authority. Generated code, tests, seed files and rendered copy may consume an authority, but may not redefine it. A differing second definition is a defect.

## Precedence and conflict decisions

The order is legality, accuracy, comprehension, accessibility, simplicity, aesthetics. When accuracy and simplicity collide, ship fewer claims. Later binding rules govern earlier drafts unless that would violate the precedence order.

| Conflict | Canonical decision | Authority |
| --- | --- | --- |
| Copilot dock versus route | One route, `/copilot/[scope]`; no floating dock. | `docs/route-register.json`, X1.2 |
| Legacy 307 redirects versus G2.3 | Permanent 308 redirects for every legacy user-facing page. | `docs/route-register.json`, G2.3 |
| Example-result routes versus the no-fixture completion gate | No production example-result surface. Fixture values remain test-only; proposed `/example/*` routes are withheld until G8.2 can be satisfied without user-reachable fixture results. | `docs/capability-register.md`, `docs/withheld/example-results.md`, G8.2 |
| `gate:language` versus `gate:readability` | `gate:language` is the one script; it implements and evidences the G1.10 readability contract. | `package.json`, `scripts/language-gate.ts`, X14 |
| Redirect table duplication | Redirects are route records, not a second table. | `docs/route-register.json` |
| Natural-frequency variants | One denominator per claim block, selected from 100 through 1,000,000. | `src/lib/figures/natural-frequency.ts`, X4.1 |
| Figure vocabularies | Only the X4 `data-figure-kind` and `data-figure-class` values are valid. | `src/lib/figures/contract.ts`, X4 |
| Density variants | X6 measurement exclusions, caps and CIEDE2000 basis govern. | `docs/density-baseline.json`, `scripts/density-gate.ts` |
| Liability cap | No amount is invented. Any dependent capability remains unavailable until counsel/operator supplies the real non-zero cap and legal artifact. | `docs/release-checklist.md`, C5 |

## Registries and documents

| Dimension | Single authority | Consumers and generated mirrors |
| --- | --- | --- |
| Page, endpoint and redirect paths; auth; dispositions; route states | `docs/route-register.json` | Next.js routes, `next.config.ts`, navigation, route E2E, `src/lib/primary-routes.ts` |
| Canonical-artifact index | `docs/canonical-artifacts.md` | `gate:canon` |
| Schema requirements before migration authoring | `docs/schema-requirements.md` | Supabase migrations only |
| Jurisdiction statuses, capabilities and `TEST-LOCAL` | `data/jurisdictions.json` | `src/lib/legal/jurisdictions.ts`, settings picker, jurisdiction E2E |
| Citation metadata | `data/citations.json` | report templates, legal/science surfaces, provenance gate |
| Claim text, quantity, population, portability and evidence bindings | `data/claims.json` | result renderers, claim and science gates |
| Report templates | `data/templates/*.json` under `data/templates/SCHEMA.md` | seed and template gate |
| Provider directory | `data/providers/providers.json` | `/providers`; this is the only competitor-name carve-out |
| Counsellor directory | `data/counsellors.json` | counselling surfaces and mail |
| Ancestry region thresholds and fallback labels | `data/ancestry-regions.json` | ancestry computation and map |
| Retention clocks and artifact dispositions | `docs/retention.md` | purge jobs, export/deletion UI, legal copy |
| Legal artifacts and exact versions | `content/legal/<slug>/<version>.md` | legal routes, consent artifact seed, signatures |
| Legal rendered-string anchors and review status | `docs/legal-register.json` | legal gate and review checklist |
| Attestation statements | `content/attestations/<kind>/<version>.md` | server signing routes |
| Legal/human review records | `docs/reviews/` | jurisdiction resolver and release gate |
| Copy review outcomes and exact regulated strings | `docs/copy-review.md` | product copy and language gate |
| Science positions | `content/science/positions/*.md` | `/science/positions`, science gate |
| Figures reused across surfaces | `docs/figures-register.json` | differencing and cross-surface gates |
| Baseline and post-change viewport measurements | `docs/density-baseline.json` | density gate |
| Fixture-bearing production paths | `docs/fixture-paths.md` | mock-token allowlist and G8.2 |
| Permitted mock-token paths | `scripts/mock-token-allowlist.json` | mock-token gate |
| Permitted secret-pattern paths | `scripts/secret-allowlist.json` | secrets gate |
| Capability ship/withhold status | `docs/capability-register.md` | release checklist and comprehension variants |
| Withheld-capability evidence | `docs/withheld/<capability>.md` | capability register |
| Gate blockers | `docs/blockers/<gate-id>.md` | acceptance matrix and release checklist |
| Acceptance evidence | `docs/acceptance-matrix.md` | release decision; A1–A18 are append-only |
| Gate run evidence and exit codes | `gates.md` | release decision |
| Test changes | `docs/test-diff-register.md` | G8.1 |
| Test seed paths and identities | `docs/fixture-paths.md` | E2E and comprehension harness |
| Comprehension tasks and grading | `docs/comprehension-protocol.md` | `scripts/comprehension/` |
| Raw comprehension runs | `docs/comprehension-runs/<date>/` | G3 evidence |
| Release obligations and human sign-offs | `docs/release-checklist.md` | release decision |
| Architecture decisions | `docs/adr/NNNN-*.md` | implementation and acceptance evidence |
| Multi-workstream path ownership | `docs/protocol/ownership.md` | contributors and migration owner |
| Decisions, defects, assumptions and progress ledgers | `docs/protocol/decisions.md`, `docs/protocol/defects.md`, `docs/protocol/assumptions.md`, `docs/protocol/progress.md` | adversarial loop |

## Database schema and enums

`docs/schema-requirements.md` is the pre-migration request ledger. Once a requirement is implemented, the ordered SQL in `supabase/migrations/` is authoritative. Generated Supabase TypeScript types are a mirror, never a schema authority. The Platform workstream is the sole migration author.

| Item | Canonical home |
| --- | --- |
| `subjects`, `subject_demographics` | ordered Supabase migration series; exact required columns originate in X2 |
| Consent artifacts, signatures, purposes, grants, subject consents, invitations and attestations | ordered Supabase migration series; X3 |
| `embryo_cohorts`, `embryos`, `embryo_qc` | ordered Supabase migration series; X3/X10 |
| The only audit table, `legal_audit_log` | ordered Supabase migration series; X3.1 |
| Finding layer and estimate kind | `report_templates.layer`, `report_templates.estimate_kind` constraints |
| Evidence levels | database constraint: `clinical`, `established`, `emerging`, `preliminary`, `insufficient` |
| Chat scope | database constraint: `self`, `subject`, `family`, `cohort`, `report` |
| Subject kind | database constraint: `self`, `adult`, `embryo` |
| Upload class | database constraint: `self`, `other_adult`, `embryo_own`, `embryo_third_party` |
| Subject lifecycle | database constraint: `active`, `revoked`, `purge_queued`, `purged` |
| Attestation kind | database constraint: `own_embryo`, `parents_permission`, `jurisdiction` |
| Consent type and scope vocabulary | database constraints introduced by the consent migration |
| Inheritance mode | `condition_registry.inheritance_mode` constraint |
| Risk baselines and transformations | `risk_models`; no template or UI-local baseline copy |
| Processing and purge job vocabulary | database constraint on the canonical queue table |
| Mail delivery/outbox state | database constraint on the canonical mail outbox |

No authenticated client may insert, update or delete a derived genetic result, consent, attestation, subject, embryo, audit row or worker job. Storage object identity is derived from database rows; request payload paths are never authorities.

## Result and presentation contract

| Item | Single authority |
| --- | --- |
| Numeric rendering components | `src/components/figures/figure.tsx` and `src/components/figures/relative-figure.tsx` |
| Figure runtime types and DOM vocabulary | `src/lib/figures/contract.ts` |
| Claim-block container | `[data-claim-block]` emitted by the shared figure components |
| `data-figure-kind` values | `src/lib/figures/contract.ts`: `absolute`, `relative`, `difference-pp`, `natural-frequency`, `percentile`, `coverage`, `interval`, `ancestry-share`, `genotype`, `carrier-status` |
| `data-figure-class` values | `src/lib/figures/contract.ts`: `variant-call`, `estimate`, `ancestry`, `quality` |
| Provenance attributes | `src/lib/figures/contract.ts`: `data-provenance`, `data-subject-id`, `data-subject-pair` |
| Natural-frequency algorithm | `src/lib/figures/natural-frequency.ts` |
| Reference-group vocabulary and term definitions | `src/lib/figures/copy.ts` |
| Fixed report heading skeleton | `src/components/reports/report-skeleton.tsx` |
| Evidence glyph/word mapping | `src/lib/reports/evidence.ts` |
| Portrait allowlist | `src/lib/family/portrait-allowlist.ts` |
| Embryo non-ranking and sex-data prohibitions | `src/lib/embryos/policy.ts` plus database constraints |

## Design, density and accessibility

| Item | Single authority |
| --- | --- |
| Frozen colour, font, spacing, size, radius and subject-colour tokens | `src/app/globals.css` |
| Route surface class and width | `docs/route-register.json` |
| Primary-route measurement population | generated from `docs/route-register.json` |
| Density thresholds, exclusions and recorded values | `docs/density-baseline.json` |
| Accessibility target | WCAG 2.2 AA assertions in the registry-driven E2E suite |
| Readability preprocessing, scorer version and thresholds | `scripts/language-gate.ts` |
| Pinned reading grades | `tests/fixtures/reading-grade.json` |

## Mail and external services

| Item | Single authority |
| --- | --- |
| Transactional template IDs, payload schemas and required/optional delivery | `src/lib/mail/registry.ts` |
| Durable delivery requests | canonical database mail outbox |
| Local/test mail capture | `src/lib/mail/test-adapter.ts` |
| Sender domain and addresses | `src/lib/mail/registry.ts`; deployment environment supplies credentials only |
| Supabase machine binding | project ref `zuvloczwgrayonqabnss` |
| Vercel machine binding | project id `prj_K7bVowhjFr0uIapXraH41hthJkgy` |
| GitHub machine binding | repository `themariodiego/Inherit.bio` |

The Resend sender domain must not be assumed from a project name. It ships only after the actual domain is verified and the registry/configuration agree.

## Gate commands

`package.json` is the sole command-name registry. Exactly these concern commands may exist:

`gate:legal`, `gate:names`, `gate:language`, `gate:tokens`, `gate:design`, `gate:density`, `gate:routes`, `gate:claims`, `gate:science`, `gate:templates`, `gate:provenance`, `gate:licenses`, `gate:secrets`, `gate:canon`, `perf:budgets`.

Build, typecheck, lint, unit, E2E and seed/reset commands are workflow commands rather than concern gates. `gate:language` supplies the evidence requested under the G1.10 label `gate:readability`; no second alias is created.

## Change rule

Change an authority and its consumers in one reviewed change. When a generated mirror differs, the authority wins and the mirror is regenerated. Creating a second list, enum, copy constant, route table, threshold or gate alias to avoid updating the authority is prohibited.
