# Acceptance matrix (A1–A18)

**Required baseline:** `864736979c92a08ba77e8580d61946eba6864918`
(`8647369`; 48 E2E tests on 2026-08-28).

G1.2 non-test-code baseline/current counts over the same population:
`@ts-expect-error` 0/0; `@ts-ignore` 0/0; `as any` 1/1;
`eslint-disable` 0/0.

Evidence for each Section-2 acceptance item. "E2E" refers to a Playwright
spec run against a production build backed by the local Supabase stack (real
PostgREST/Storage/Auth/Mailpit); "unit" to a vitest test; "live" to the
provisioned hosted project or deployment.

**Full-suite result: 57/57 E2E tests passed in a single clean run**
(2026-09-01, `pnpm e2e`, production build + local stack). The run
surfaced one real app bug — igv.js resolved to its UMD `browser`-field
build, whose AMD-or-global dispatch left the bundled module namespace
empty, so the genome browser never rendered in production — fixed by
importing `igv/dist/igv.esm.js` directly.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Clean clone → self-hosting guide → local app runs; deviations fixed and guide re-run clean | ✅ | Clean-room audit followed `docs/self-hosting.md`, found the `worker/.env.example` + `CRON_SECRET` deviations; both fixed and re-verified (`docs/audit-report.md`). Every documented `pnpm` script exists; every required env var is in `.env.example`/`worker/.env.example`. |
| A2 | Sign-up → Resend verification email → verified session; password reset works | ✅ | `e2e/auth.spec.ts`: sign-up shows "Check your email", the Mailpit-captured verification link yields a signed-in session; reset link flow changes the password and the new password signs in. `enable_confirmations=true`. |
| A3 | ≥12 real providers, each with source URL + last-verified date this run; US→NY flags NY exclusions; Buy links resolve | ✅ | 16 providers with canonical source URLs and `last_verified 2026-09-01`. The live checker resolved 14/16 buy/privacy pairs directly; the two automation-blocked pages were confirmed through current official pages indexed within the prior month. `e2e/providers.spec.ts` covers rendering, NY exclusion, and external buy links. |
| A4 | Synthetic 23andMe sample renders ≥100 reports with genotype-specific results + honest not-covered states | ✅ | `data/samples/synthetic_23andme.txt` covers all 135 template variants (GRCh37, liftover-exercising). `e2e/upload-vcf.spec.ts` + report resolution over 151 templates; reports page shows covered vs "your file does not cover this variant". |
| A5 | GIAB HG001 VCF (chr20–22): parse → annotate → report; genome browser at a locus; rsID + gene search | ✅ | `e2e/upload-vcf.spec.ts` uploads the real 187k-variant GIAB subset through the UI, processes to `annotated`, renders the igv.js browser and rsID/gene/locus search. `src/lib/genome/pipeline-integration.test.ts` (unit) parses the full GIAB file and resolves every template. |
| A6 | ≥1 PRS with percentile + ancestry-portability caveat + numeric coverage | ✅ | 3 real PGS Catalog scores seeded; `src/lib/genome/prs.ts` (unit-tested) computes raw/z/percentile/coverage; report page renders percentile bar, mandatory `ancestry_note`, and numeric coverage fraction. |
| A7 | Research job → review-queue draft → publish updates changelog + triggers opt-in digest | ✅ | `e2e/research.spec.ts`: fixtured release drafts a `review` template (idempotent), publish flips to `published`, changelog shows the entry, mock-Resend captures the digest to the opted-in user; unauthorized refresh → 401. |
| A8 | mtDNA (and Y where supported) + admixture with "what your file supports" labels | ✅ | Process route computes admixture (EM/AIM panel), mtDNA + Y haplogroups; ancestry page renders with honest support notes. `e2e/upload-vcf.spec.ts` asserts the chr20–22 file honestly reports no MT/Y positions. Unit tests for all three libs. |
| A9 | Copilot: no-key local instructions; consent dialog names provider + data classes; tool call retrieves a genotype; streamed answer cites its report; grant revocable | ✅ | `e2e/copilot.spec.ts`: local-mode instructions with no provider (local-first ordering); cloud provider → consent dialog naming host + data classes before any genome data leaves; `get_genotype` tool call; streamed answer cites the report + genotype; revoke in Settings re-requires consent. |
| A10 | Tier-2 BAM/CRAM: resumable direct-to-Storage upload (interrupted+resumed in E2E), hashed, listed, re-downloadable | ✅ | `e2e/tier2-upload.spec.ts`: 14 MB BAM, 2nd TUS chunk aborted then resumed, stored, sha256 shown, "Stored (Tier 2)" listed, re-downloaded byte-for-byte identical. |
| A11 | Worker skeleton consumes a queued annotation job and writes results back; documented | ✅ | `worker/` self-contained queue consumer (`FOR UPDATE SKIP LOCKED`) with a real VCF-annotation stage joining `ref_variants`; `worker/annotate.test.ts` (unit, runs in root CI); Dockerfile + compose + README; alignment/calling documented as the extension path. |
| A12 | RLS proof: user A denied direct PostgREST/storage reads of user B's data; anon denied everywhere private | ✅ | `e2e/rls.spec.ts` (6 tests) attacks real PostgREST + Storage: cross-user reads return 0 rows, forged inserts rejected, cross-user storage denied, anon denied on every private table, `llm_keys` hard-denied even to authenticated. |
| A13 | Export ZIP has originals + variants + reports; account deletion uses the cancellable seven-day notice and joined-object purge lifecycle; no fee path | 🟡 | `e2e/deletion-export.spec.ts` verifies the free export and cancellable notice period. `e2e/account-deletion-purge.spec.ts` proves exact joined Storage deletion, relational zero-residual checks, Auth-user-last deletion, and pseudonymized terminal control rows. Database tests additionally prove complete deletion of wholly owned, unshared adult subjects plus their family-pair and Portrait outputs. Cross-account adults and embryo/claim/invitation/reviewer graphs deliberately fail closed until their independent notice, transfer, restriction, or preservation dispositions are implemented, so this remains 🟡 rather than overstating full-contract coverage. No billing/fee code path exists. |
| A14 | Network audit: on landing/dashboard/report, third-party origins == allowlist; `window.fbq` undefined; no beacon/pixel hosts | ✅ | `e2e/network-audit.spec.ts` over real rendered pages: only first-party origins observed (fonts self-hosted via `next/font`), `window.fbq`/`window.gtag` undefined, no tracker-host fragments. |
| A15 | Legal pages complete; placeholder gate passes; disclaimers on report surfaces by E2E | ✅ | `e2e/legal.spec.ts`: all 8 legal requirements + dual-surface Plus Bio disclosure present and on-topic; report-surface disclaimer visible; `pnpm gate:legal` passes. Legal audit returned clean. |
| A16 | Design tokens implemented; wordmark + attribution; light+dark; axe/a11y pass; Lighthouse ≥90 | ✅ | `e2e/a11y.spec.ts`: axe WCAG2 AA on landing/providers/privacy/sign-in/dashboard/settings/uploads in both themes; design-token assertions (Fraunces, pill radius, attribution, numbered steps, theme toggle). UX audit confirmed AA contrast in both themes. Lighthouse against the served production build: landing performance 95 / accessibility 100, providers performance 92 / accessibility 100 (`scripts/lighthouse-check.ts`). |
| A17 | CI green on main: typecheck (strict), lint, unit, E2E; no secrets in repo history; `.env.example` complete | ✅ | GitHub Actions `checks` job green (typecheck+lint+unit+gate). `pnpm gate:secrets` scans the tracked tree and every added line in non-merge commits after the required baseline; only exact local fixtures covered by ADR 0006 are accepted. The hosted Supabase publishable key formerly present in deployment documentation was removed from the current tree. `.env.example` is complete and E2E runs against the local stack. |
| A18 | LICENSE, README, architecture doc, ADR directory (incl. Gating Decision), dataset-license audit | ✅ | `LICENSE` (AGPL-3.0), `README.md`, `docs/architecture.md`, `docs/adr/` (0001 Gating Decision + 0002–0006), `docs/dataset-licenses.md` (ClinVar/dbSNP/gnomAD/GWAS/PGS/1000G verified; SNPedia excluded as NC). |

## Notes

- **Lighthouse (A16):** axe accessibility is enforced per-rule in CI; the
  Lighthouse performance/accessibility ≥90 gate
  (`node --experimental-strip-types scripts/lighthouse-check.ts` against the
  served production build) passed with landing 95/100 and providers 92/100
  (performance/accessibility). It needs a Chrome run, so it is a documented
  local/CI-optional check rather than part of the default E2E gate.
- **Hosted deployment:** Supabase provisioned + migrated + provider/reference
  data seeded; Vercel linked and deploying green; the remaining secret env
  vars are a one-time owner step (`docs/deployment.md`).

## Full-resolution gates (G1–G8)

Current audited state: **15/65 YES**. `NO` means the exact gate is not yet
proved; partial implementations are intentionally not rounded up. The adult
subject invitation work adds a safe TEST-LOCAL reservation and acceptance
boundary, but it does not claim the class-(b) upload, quarantine, purpose,
revocation, notification, or ownership-transfer contract is complete.

| ID | Statement | YES/NO | Evidence |
| --- | --- | --- | --- |
| G1.1 | Production build exits cleanly without source warnings. | YES | `pnpm build` exits 0; `package.json`; verified 2026-09-01. |
| G1.2 | Typecheck passes and suppression counts do not exceed baseline. | YES | `pnpm typecheck`; baseline/current counts are recorded above and reproducible with `git grep` over non-test `*.ts,*.tsx,*.js,*.jsx`. |
| G1.3 | Lint treats warnings as failures and passes. | YES | `pnpm lint`; `package.json` uses `eslint --max-warnings=0`. |
| G1.4 | Unit suite and required pure-module coverage pass. | YES | `pnpm test` (155 tests); unit specs under `src/lib/**/*.test.ts` and `scripts/**/*.test.ts`. |
| G1.5 | E2E has zero failures, skips, retries, or quarantine. | YES | `pnpm e2e` (57 tests); `playwright.config.ts` has `retries: 0`; `scripts/run-e2e.ts` validates `test-results/results.json`; `docs/test-diff-register.md`. |
| G1.6 | Extended RLS attack suite covers every new table and revocation. | NO | `e2e/rls.spec.ts` does not yet cover all tables in `supabase/migrations/20260831*.sql`; adult invitation database invariants are narrower in `supabase/tests/adult_subject_invitation.sql`. |
| G1.7 | Network audit covers every registered route/state/theme/auth mode. | NO | `e2e/network-audit.spec.ts` covers only its existing route subset; compare `docs/route-register.json`. |
| G1.8 | Legal gate runs rendered-page mode over all required routes. | NO | `pnpm gate:legal` passes static checks, but `scripts/legal-placeholder-gate.ts` lacks the complete rendered-route G5.7/G5.8 contract. |
| G1.9 | Name gate passes. | YES | `pnpm gate:names`; `scripts/name-gate.ts`; the private denylist is supplied through `NAME_DENYLIST_FILE` and is never committed. |
| G1.10 | Readability and vocabulary gate passes with self-test. | NO | `pnpm gate:readability` runs the pinned ten-case self-test and scans 1,440 extracted blocks using `data/plain-vocabulary.json` and `data/jargon.json`, but exits non-zero on 101 long-block grade findings after the application, public-page, provider-metadata, eleven report-template categories, and privacy-policy remediation passes. See `docs/readability-audit.md`; CI is intentionally unchanged until the corpus is clean. |
| G1.11 | Claims/provenance gate passes. | NO | Required `gate:claims` and `data/citations.json` are absent. |
| G1.12 | Route/state register gate and titled tests pass. | NO | `docs/route-register.json` exists; required `gate:routes` and complete route/state E2E coverage do not. |
| G1.13a | Full axe tag matrix passes on every registered route. | NO | `e2e/a11y.spec.ts` does not yet cover the complete tag/route/auth/viewport matrix. |
| G1.13b | Reflow, target size, keyboard order, and alternatives pass. | NO | Named Playwright coverage for the complete non-axe matrix is absent from `e2e/a11y.spec.ts`. |
| G1.14 | Lighthouse passes exact route and threshold contract. | NO | `scripts/lighthouse-check.ts` does not yet implement per-category thresholds and authenticated exact-final-URL checks. |
| G1.15 | Template integrity gate passes without baseline loss. | YES | `pnpm gate:templates`; `scripts/validate-templates.ts` validates 151 templates and genotype/citation structure. |
| G1.16 | Pull-request CI runs every mandated gate and E2E; integration CI is green. | NO | `.github/workflows/ci.yml` runs build, template, secret, local Supabase, seed, and E2E, but the complete G1.8–G1.12 command set does not yet exist. |
| G1.17 | Repository/history secret gate passes with explicit fixture allowlist. | YES | `pnpm gate:secrets`; `scripts/secret-gate.ts`; exact local-only values and paths in `scripts/secret-allowlist.json`; accepted ADR 0006; the current tree, all authored non-merge commits after the baseline, `.env.production` paths, and three tracked genome fixtures are checked. CI uses a full-history checkout. |
| G2.1 | Route register exactly represents the required product hierarchy. | NO | `docs/route-register.json` exists, but several Family/Embryo routes still render `src/components/capability-unavailable.tsx`. |
| G2.2 | Every route declares and tests every required state. | NO | `docs/route-register.json` is not backed by one substantive E2E per required route/state pair. |
| G2.3 | Every pre-existing route has a verified kept/redirect/gone disposition. | NO | Required `gate:routes` is absent; `docs/route-register.json` is not fully live-verified. |
| G2.4 | Reachability and instrumented task-depth limits pass. | NO | No complete action-count suite exists under `e2e/`. |
| G2.5 | Numeric white-space and density budgets pass against baseline. | NO | `docs/density-baseline.json` exists; complete `e2e/density.spec.ts` route and viewport enforcement is absent. |
| G2.6 | All four upload-subject paths work end to end under TEST-LOCAL. | NO | `e2e/adult-subject-invitation.spec.ts` covers reservation/acceptance only; `src/app/api/uploads/route.ts` still accepts only the self subject and embryo paths are unavailable. |
| G2.7 | Frozen visual identity and all-new-route theme checks pass. | NO | Baseline tokens remain in `src/app/globals.css`, but every new route is not yet covered in both themes by unmodified assertions. |
| G3.1 | Thirty-persona comprehension harness exists and records raw runs. | NO | Required `scripts/comprehension/` and `docs/comprehension-runs/` are absent. |
| G3.2 | Ten comprehension tasks are bound to exact fixtures/surfaces. | NO | Required `docs/comprehension-protocol.md` is absent. |
| G3.3 | Scored comprehension thresholds pass twice. | NO | No runnable comprehension command or committed run exists under `scripts/comprehension/`. |
| G3.4 | Human comprehension round is recorded without fabricated evidence. | NO | No consented human-run artifact exists under `docs/comprehension-runs/`; this remains an operator obligation. |
| G3.5 | Failed comprehension produces a blocking release state. | NO | Required release integration is absent from `docs/release-checklist.md` (file absent). |
| G4.1 | Every result uses the complete plain-language result anatomy. | NO | Result surfaces under `src/app/(app)/genome/` predate the full G4 contract. |
| G4.2 | Risk figures include absolute values and required uncertainty. | NO | No full gate/test maps every risk figure in `docs/figures-register.json` (file absent). |
| G4.3 | Single-variant and carrier claims follow the bounded vocabulary. | NO | Required claim/language gates are absent from `package.json`. |
| G4.4 | Polygenic estimates satisfy coverage and portability rules. | NO | Existing PRS tests do not prove every rendered surface against the full G4.4 contract. |
| G4.5 | Ancestry outputs satisfy geographic and comparability bounds. | NO | `src/app/(app)/genome/[subject]/ancestry/page.tsx` lacks complete registered-figure proof. |
| G4.6 | Embryo comparison obeys non-ranking, uncertainty, and QC rules. | NO | `src/app/(app)/embryos/compare/page.tsx` is unavailable. |
| G4.7 | Future-child preview obeys bounded population-level presentation. | NO | Required implementation and E2E contract are absent from Family routes. |
| G4.8 | Copilot passes the adversarial output contract. | NO | Required `e2e/fixtures/copilot-redteam.json` and ≥40-prompt shipped-path E2E are absent. |
| G5.1 | Jurisdiction is server-enforced for every restricted capability. | NO | `data/jurisdictions.json` is fail-closed, but no complete resolver/gate protects every data-returning route. |
| G5.1a | User-declared jurisdiction cannot be inferred or race-changed. | NO | Complete declared-prohibited/unreviewed/change-between-load-and-submit E2E is absent. |
| G5.1b | Actor and every subject jurisdiction must all permit access. | NO | Cross-jurisdiction subject enforcement and E2E are absent. |
| G5.2 | Versioned consent documents and re-consent contract pass. | NO | `consent_artifacts` exists, but complete routes, summaries, re-consent, and E2E are not implemented. |
| G5.3 | Third-party upload stays quarantined until subject confirmation. | NO | `e2e/adult-subject-invitation.spec.ts` proves no file exists at invitation acceptance; it does not implement or prove quarantined upload/purge. |
| G5.3a | Revocation is immediately inaccessible and fully purged in seven days. | NO | Existing account purge tests do not cover the full subject-revocation table/storage list. |
| G5.4 | Accountless subject/future-person rights routes and retention work. | NO | `/withdraw/[token]` is a partial adult invitation mechanism; the complete access, future-person, and retention mechanisms are absent. |
| G5.5 | Structural human-review gate defaults all unreviewed capabilities off. | NO | `data/jurisdictions.json` defaults real jurisdictions to unreviewed and `next.config.ts` rejects TEST-LOCAL on Vercel production, but the required structural review gate is absent. |
| G5.6 | Free exports are complete and correctly subject-scoped. | NO | `e2e/deletion-export.spec.ts` covers the original export but not every new subject/embryo scope. |
| G5.7 | No fee path exists and the legal gate proves it. | NO | No payment code is present, but the required route-wide origin/submission and legal-copy gate is not implemented. |
| G5.8 | Protective legal anchors exist and are tested by id. | NO | Existing `e2e/legal.spec.ts` does not prove every required stable anchor across every consent document. |
| G5.9 | Future-child preview satisfies all bounded-harm assertions. | NO | Future-child preview implementation and named E2E assertions are absent. |
| G6.1 | Whole-tree and new-commit name scan passes. | YES | `pnpm gate:names` scans tracked and untracked non-ignored files plus every reachable commit message with a committer timestamp after the baseline. `scripts/name-gate-fixtures.json` proves lowercase-domain and camelCase detection. |
| G6.2 | External-name allowlist has only the permitted categories. | YES | `data/allowed-external-names.json`; the gate rejects unknown categories, orphaned provider entries, non-exact provider reasons, missing evidence paths, and incomplete provider source/date fields. |
| G6.3 | Out-of-tree denylist and provider carve-out are enforced in CI. | YES | Accepted ADR 0007; `.github/workflows/ci.yml` fails when the encrypted `NAME_DENYLIST` secret is absent, writes it only under `RUNNER_TEMP`, and exports `NAME_DENYLIST_FILE`; unit tests prove carve-out and override behavior. |
| G6.4 | End-state scan is clean and all 16 providers remain sourced. | YES | `pnpm gate:names` returns zero findings; all 16 rows retain their source arrays and expose matching canonical `source_url` and `last_verified` fields refreshed on 2026-09-01. Fourteen live link pairs resolved directly and two automation-blocked pages were confirmed from current official indexed pages. |
| G6.5 | Provider names have no evaluative proximity. | YES | `scripts/evaluative-tokens.json`; the gate scans all `docs/`, `src/`, and comments for a provider name within 200 characters of a registered evaluative token; boundary behavior is unit-tested. |
| G7.1 | Required gating ADRs exist from 0006 onward. | NO | `docs/adr/` lacks the complete named G7.1 decision set. |
| G7.2 | Core docs/env are current and a clean-clone run is recorded. | NO | `docs/self-hosting.md` now names `Inherit.bio`, but the full new surfaces and a current clean-clone record are incomplete. |
| G7.3 | Acceptance matrix covers every G gate with concrete evidence. | YES | This G1.1–G8.6 table in `docs/acceptance-matrix.md`; gate ids are complete and NO rows name the missing command, test, or path. |
| G7.4 | Capability and all named evidence registers exist and are current. | NO | `docs/test-diff-register.md`, `docs/retention.md`, and `docs/density-baseline.json` exist; `docs/capability-register.md`, `docs/fixture-paths.md`, `docs/figures-register.json`, and `docs/release-checklist.md` are absent. |
| G8.1 | All pre-existing E2E tests pass without weakening. | YES | `pnpm e2e` passes all 57 tests; `docs/test-diff-register.md` records the runner change and confirms no pre-existing E2E test changed. |
| G8.2 | Production routes cannot render demo/fixture data as user data. | NO | Required `docs/fixture-paths.md` and `scripts/mock-token-allowlist.json` are absent. |
| G8.3 | Every registered figure differs correctly across two seeds. | NO | Required two-seed E2E and `docs/figures-register.json` are absent. |
| G8.4 | Entire deterministic suite passes twice from clean state. | NO | One clean 57-test run is recorded; the required two consecutive full gate/build/database cycles have not run. |
| G8.5 | Every live surface/endpoint/prefix matches its register. | NO | Required comprehensive route/form/API/storage register verification is absent. |
| G8.6 | Repeated figures have one source of truth and cannot diverge. | NO | Required `docs/figures-register.json` and enforcement gate are absent. |
