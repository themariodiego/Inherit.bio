# Inherit v2 canonical artifacts

Status: binding
Baseline application SHA: `864736979c92a08ba77e8580d61946eba6864918`
Brief SHA-256: `2914f42bba3ccdb34816f07c23b4cffdee14f3328b4fa5f2a0f231133be9abbe`
Platform: GitHub `themariodiego/Inherit.bio`; canonical domain `www.inherit.bio`; Supabase project **Inherit** (`zuvloczwgrayonqabnss`); Vercel project `sequence` (`prj_K7bVowhjFr0uIapXraH41hthJkgy`) pending a separately reviewed platform rename.

This file is the index required by X0.2. An item has one authority. Generated code, tests, seed files and rendered copy may consume an authority, but may not redefine it. A differing second definition is a defect.

## Precedence and conflict decisions

The order is legality, accuracy, comprehension, accessibility, simplicity, aesthetics. When accuracy and simplicity collide, ship fewer claims. Later binding rules govern earlier drafts unless that would violate the precedence order.

| Conflict | Canonical decision | Authority |
| --- | --- | --- |
| Copilot dock versus route | One registered `copilot.scope` route; no floating dock. | `docs/route-register.json`, X1.2 |
| Legacy 307 redirects versus G2.3 | Permanent 308 redirects for every legacy user-facing page. | `docs/route-register.json`, G2.3 |
| Example-result routes versus the no-fixture completion gate | No production example, demo or fixture-derived result surface. The conflicting proposal is permanently rejected by later G8.2, anti-pattern 2 and C6; synthetic values remain test-only. | `docs/route-register.json`, G8.2 |
| Direct-to-Storage cohort upload versus “embryo sex data is never stored” | Accepted ADR-0016 supersedes ADR-0001 in full: self and other-adult uploads may use only the registered private, session-bound staging insert; embryo/cohort bytes are transport-only through the registered bounded same-origin streaming autosomal sanitizer, and only the validated autosomal canonical source may enter persistent Storage. | `docs/adr/0016-supersede-large-file-transport-and-compute.md`, `docs/route-register.json#payloadBoundaryContract`, `docs/route-register.json#policyContracts.genetic-file-ingest-v1`, `docs/route-register.json#storageAccessContracts.genomes-server-mediated-v1`, X10.2, C1 |
| Per-embryo QC partial success versus atomic cohort publication | The brief requires `split_cohort_vcf` to continue after one embryo fails QC. Each ordinal therefore creates either a worker-only pending source or a worker-only provisional QC marker. Neither is visible before the terminal whole-ordinal transaction. That transaction publishes the complete successful member set under one revision, promotes failed markers to closed no-source columns, finalizes each ordinal’s own Card/retention branch, and enqueues analysis only for the published normalized set. A stale, cancelled or exhausted attempt first denies and then deletes every pending source and provisional marker. | `docs/route-register.json#policyContracts.canonical-source-publication-v1`, `docs/route-register.json#policyResolvers.embryo-ingest-session-v1.workerCompletion`, A.10 partial-failure rule |
| Authenticated direct Storage or PostgREST reads versus operation-scoped consent | The `genomes` bucket and raw variant tables are server-mediated. Authenticated clients cannot list or select originals, `user_variants`, or `embryo_variants` directly; a server route must join the exact database-owned file and subject/cohort rows and re-evaluate the exact live grant before creating a chunk session, reading a bounded Storage range, or projecting data. A reports or analysis-computation grant never implies raw access. | `docs/route-register.json#storageAccessContracts.genomes-server-mediated-v1`, X11.3 |
| Embryo laboratory PDF acceptance versus later refusal | Every genetic-file flow rejects PDFs. The UI performs a `%PDF` magic-byte preflight before transport. A bypassed self/adult direct upload is re-sniffed by its processor, which deletes the uploaded object and row and returns HTTP 415 before parsing. Embryo ingest rejects a PDF in the first chunk before any durable byte. No OCR, redaction or `pdf_report` genome-file type is built; signed consent evidence remains a separate document flow. | `docs/route-register.json#policyContracts.genetic-file-ingest-v1`, A.6, X10.2 |
| Original embryo lab/sample labels versus a sex-safe stable identity | Sex-safety takes precedence over preserving source identifiers. Original lab identifiers, sample headers and source labels may be used only transiently to associate rows during bounded-memory parsing; they are never persisted, logged, rendered or exported. The server assigns a stable neutral sample ordinal and a display label resolved from the product-copy authority. | `docs/route-register.json#policyContracts.embryo-autosomal-only-v1`, `src/copy/**`, X2.4, X10.2, X10.3, C1 |
| `gate:language` versus `gate:readability` | `gate:language` is the one script; it implements and evidences the G1.10 readability contract. | `package.json`, `scripts/language-gate.ts`, X14 |
| Redirect table duplication | Redirects are route records, not a second table. | `docs/route-register.json` |
| Natural-frequency variants | One denominator per claim block, selected only by the canonical natural-frequency algorithm and bounds. | `src/lib/figures/natural-frequency.ts`, X4.1 |
| Figure vocabularies | Only the X4 `data-figure-kind` and `data-figure-class` values are valid. | `src/lib/figures/contract.ts`, X4 |
| Density variants | X6 measurement exclusions, caps and CIEDE2000 basis govern. | `docs/density-baseline.json`, `scripts/density-gate.ts` |
| Navigation structure versus navigation wording | The route register owns membership, order, copy IDs and reachability. Product wording is owned by `src/copy/**`; any resolved label, description, heading or accessible name present in the route register is generated/check-only drift evidence and does not define copy. | `docs/route-register.json#navigationContract`, `src/copy/**` |
| Future Person custody versus the X2 minimum `subjects` shape | The Future Person Charter cannot be implemented by leaving an approved claimant’s record owned by a parent. The schema-requirements ledger must extend, rather than silently contradict, the X2 minimum: add `claimed_unbound` and `claimed_bound` lifecycle values plus `claimant_principal_id`; permit `owner_account_id` to be null only for `claimed_unbound` with exactly one claimant principal; require the claimant account as both owner and subject account for `claimed_bound`. Parent policies and account purge check lifecycle before ownership. These narrow additions take precedence over X2’s earlier non-null-owner/minimal-enum wording, while every other X2 column and constraint remains binding. | `docs/schema-requirements.md`, `docs/route-register.json#policyContracts.future-person-claimant-authority-v1`, Future Person Charter |
| Record Key identification versus claimant authentication | A Record Key satisfying the canonical length, alphabet and hashing contract alone identifies and disambiguates the one embryo record, exactly as the Charter says. It is not a bearer authorization to release a lifelong genome. Because release must also establish that the requester is the adult person described by the record, the Record-Key branch requires named-human review of a government photo identity document and a distinct birth record; it does not use the keyless profile match, owner notice, or candidate search. The documents authenticate the claimant, not the record. | `docs/route-register.json#tokenSecurityContract.futurePersonRecordKey`, `docs/route-register.json#lifecycleDispositionContracts.future-person-claim-resolution-v1`, Charter right 1, legality/security precedence |
| Export `GET` wording versus safe creation semantics | A scanner, prefetch, retry or link open must not create a durable genome archive or a download session. The one-click UI performs an explicit same-origin `POST` with a one-time export nonce. `GET` on registered routes `api.export` and `api.subject-export` only polls ready or pending metadata and has zero enqueue, session, credential or write effects. Archive bytes are available only through `api.download-chunk` after a separate nonce-protected `POST` operation `open-ready` creates the principal-bound revocable chunk session. This safety decision supersedes the earlier shorthand that described GET as creation or streaming while preserving the same one-click user task and artifact set. | `docs/route-register.json#largeExportDeliveryContract`, A.11, security precedence |
| Immediate third-party upload wording versus recipient non-enumeration | Path A and both Path B evidence branches reserve only a non-genetic adult draft before recipient activation. No upload session, source byte, file row or upload revision exists until the recipient accepts with an account for Path A, or completes the current subject artifact with an account or rights session for Path B. Path B reviewed evidence permits issuing the hidden recipient invitation but does not itself authorize upload. This equivalent primary/secondary journey preserves G2.6 and G5.3 while preventing an inviter from probing a recipient refusal bar through upload availability. | `docs/route-register.json#policyContracts.adult-subject-confirmation-v1`, `docs/route-register.json#policyResolvers.upload-class-v1`, G2.6, G5.3, privacy/security precedence |
| Invitation auto-purge versus the global refusal bar | Silence and delivery failure do not prove recipient refusal. Expiry terminalizes and purges only the exact invitation and draft; it cannot cancel another account's invitation, bar a victim's address globally, or block an established subject's uploads. The global HMAC bar governed by `invitation.refusal-hash-365d` starts only from an explicit current-recipient refusal or an established Path B subject's explicit revocation/deletion and applies only to new preactivation invitations. This narrow safety correction supersedes the earlier `auto-purge` trigger while preserving the global protection after an affirmative refusal. | `docs/retention.md#invitation-pending-30d`, `docs/retention.md#invitation-refusal-hash-365d`, `docs/route-register.json#lifecycleDispositionContracts.global-contact-refusal-bar-v1`, security and data-subject-control precedence |
| One notice for every blocked attempt versus harassment resistance | Every blocked attempt is atomically counted, but protective email is coalesced to at most one minimal notice per contact-HMAC window under the registered quota authority. The notice may report only the aggregate attempt count and never identify inviters, targets or data. This preserves visibility without turning the protective mechanism into an email-flood primitive. | `docs/route-register.json#lifecycleDispositionContracts.global-contact-refusal-bar-v1.quotaAuthority`, security/accessibility precedence |
| `audit-log.json` versus `legal-audit.json` export names | Both exact top-level members ship. `audit-log.json` is the A.11 closed partition index; `legal-audit.json` is the L-34 requesting-principal legal-ledger slice. Neither is a second audit store, and the manifest records their distinct schemas and row counts. | `docs/route-register.json#exportLayouts.subject-partitioned-archive-v1`, A.11, L-34 |
| In-place audit-identifier replacement versus a verifiable append-only hash chain | Accuracy, tamper evidence and the deletion right are all preserved by storing random stable audit-principal pseudonyms in `legal_audit_log` from insertion and keeping every live account/subject association only in a separate envelope-encrypted link. Subject or account deletion crypto-shreds and deletes that link under `audit.pseudonymize-on-deletion`; the ledger row and `row_hash` remain byte-identical, no live `actor_user_id` or `subject_id` survives, and L-49’s externally observable tombstoning requirement still holds. Mutating identifiers inside already-hashed rows is rejected because it would either break L-33 chain verification or require rewriting the retained chain. Ledger rows themselves remain subject to the independent 7-year maximum in `audit.legal-log-7y`. | `docs/retention.md#audit-pseudonymize-on-deletion`, `docs/retention.md#audit-legal-log-7y`, `docs/route-register.json#lifecycleDispositionContracts.sensitive-purge-target-registry-v1`, X3.1, L-33, L-49, accuracy and legality precedence |
| Generic claim resolution versus the mandatory post-match owner-notice period | The competing literal clocks cannot all finish inside the generic shorthand once documentary review and provider delivery take non-zero time. Legality and the Future Person objection right take precedence. Every claim follows `future-person.claim-review`; Record-Key and claimant-Recovery-Key branches resolve within that row. A positive keyless determination is not a resolution: delivery and owner notice follow `future-person.keyless-notice-release-62d` and `future-person.owner-notice-30d`, while an objection follows `future-person.claim-objection-review-30d`. The encrypted two-document package remains operation-specific reviewer-only until the applicable persisted terminal deadline, then is crypto-shredded. | `docs/retention.md#future-person-claim-review`, `docs/retention.md#future-person-keyless-notice-release-62d`, `docs/retention.md#future-person-owner-notice-30d`, `docs/retention.md#future-person-claim-objection-review-30d`, `docs/route-register.json#lifecycleDispositionContracts.future-person-claim-resolution-v1`, §5 claim route, L-48, legality/privacy precedence |
| Upload-time Record Key Card versus A.7’s rejected per-embryo token proposal | The later Future Person Charter and X11.1 control: each embryo receives a printable Record Key Card satisfying `tokenSecurityContract.futurePersonRecordKey` during `api.embryo-cohorts` finalization, before genetic bytes are required, with the public claim URL and current closing date in words and ISO. Only the hash persists. A transfer rotates the hash and returns a replacement card with the transferred claim-window date; donated, discarded, deleted or claimed records revoke it. A consented non-transfer deadline renewal preserves the key and must commit a date-only addendum before the new date. | `docs/route-register.json#tokenSecurityContract.futurePersonRecordKey`, §5 claim route, X11.1, L-21 |
| Fixed transferred closing date versus notices that “block deletion” | G5.4’s fixed maximum and the date promised on the Record Key Card control. The age-based, near-deadline and pre-deletion notices owned by `embryo.transferred-claim-window` are mandatory operational duties, but failed mail cannot create indefinite genome retention. Each campaign follows that row’s one fixed delivery/retry outcome window and ends in committed delivery or reviewed permanent undeliverability; neither outcome changes the Charter closing date. At that date the normal lifecycle/hold recheck deletes an unclaimed record. | `docs/retention.md#embryo-transferred-claim-window`, Future Person Charter, G5.4, X11.2 |
| Claimed-but-unbound custody versus the blanket non-account-holder cap | Once a named human approves the adult claimant, the record is no longer a parent-controlled non-account-holder record: it is subject-controlled through a random durable claimant principal in lifecycle `claimed_unbound`. The cap owned by `future-person.claimed-unbound-24mo` applies to encrypted contact, delivery copies and working authentication material, not the claimed genome or Charter rights. A keyed identity HMAC and optional Recovery Key hash remain until account binding or claimant deletion; fresh two-document review is always required, and an exact-one HMAC recovery path prevents a lost or never-issued key from orphaning custody. This narrow post-claim exception supersedes G5.4/X11.2’s blanket wording while preserving their limit for every unclaimed adult and embryo record. | `docs/retention.md#future-person-claimed-unbound-24mo`, `docs/retention.md#future-person-claimant-reverification-until-request`, `docs/route-register.json#policyContracts.future-person-claimant-authority-v1`, Future Person Charter |
| Non-self Copilot local-only Charter rule versus A.9 cohort cloud-consent wording | The later Charter/legal rule and data-minimization hierarchy control. No third-party adult, Family, embryo or cohort genetic context may be sent to a cloud model, even with a contributor toggle. Those scopes are available only through a verified user-device/local transport that sends no genome or provider credential through Inherit/Vercel; until that transport exists they render an honest unavailable state rather than silently falling back to cloud. Self-subject cloud use remains separately consented per exact provider/model/origin revision. | `docs/route-register.json#policyContracts.cloud-model-consent-v1`, `docs/route-register.json#policyContracts.model-endpoint-v1`, §9.3, A.9, legality/privacy precedence |
| Conflicting T9 rights-task ceilings | Use the stricter bound already selected by `navigationContract.taskDepthActions.ceilings.T9`. The rights page may still render all required information, but every route and comprehension fixture derives that single ceiling; no second T9 maximum is permitted. | `docs/route-register.json#navigationContract.taskDepthActions.ceilings`, G2.4, G3.3 |
| Liability cap | No amount is invented. Implementation and tests may continue, but production release is blocked until counsel/operator supplies the real non-zero cap and the reviewed legal artifact. | `docs/release-checklist.md`, X12.4, G5.8, C5 |

## Registries and documents

| Dimension | Single authority | Consumers and generated mirrors |
| --- | --- | --- |
| Page, endpoint and redirect paths; auth; operation policies; absolute response contracts; dispositions; route states | `docs/route-register.json` | Next.js routes, `next.config.ts`, navigation, route/API E2E, `src/lib/primary-routes.ts` |
| Primary navigation membership and order, Overview entry-box membership, route reachability and task-depth budgets | `docs/route-register.json#navigationContract` | navigation components and route/task-depth E2E; wording resolves through copy IDs from `src/copy/**`, and any resolved literal in the register is generated/check-only |
| Export archive layout and per-actor data scope | `docs/route-register.json#exportLayouts` and `#exportContracts` | export handlers and deletion/export E2E |
| Storage object prefixes | `docs/route-register.json#storagePrefixes` | upload sessions, Storage policies, download and purge helpers |
| Bounded embryo source labels (`source_laboratory`, `source_assay`, `amplification_method`, `allelic_dropout_method`) | `data/embryo/source_labels.json` (closed; withheld and empty until reviewed organisation and assay names are registered) | `src/lib/embryos/source-labels.ts`, the `qc` closed shape in `src/lib/embryos/policy.ts`, the QC table and block renderers; an original laboratory label never passes the shape and is never rendered |
| Serverless body, ingest/evidence/download chunk, and session-capacity limits | `docs/route-register.json#payloadBoundaryContract` | every request, response, ingest, evidence, download and export contract consumes explicit property references; numeric restatement is a gate failure |
| Pending embryo source and provisional-QC publication/readability invariant | `docs/route-register.json#policyContracts.canonical-source-publication-v1` | database RLS/RPC, Storage metadata, file/cohort lists, raw reads, downloads, exports, normalization, analysis, model retrieval and workers; no pending source, marker, status, reason, ID or metadata is visible outside the exact active sanitization attempt |
| Embryo legal-basis case and five independent authority/notice/Card sets | `docs/route-register.json#policyResolvers.embryo-basis-authority-v1` | every embryo draft/finalization, legal-evidence decision, upload, result, disposition, notice, Record-Key Card, export, download, Copilot, worker, retention and account-deletion consumer; no local parent/uploader/owner shortcut is authoritative |
| Optional identified-donor attribution and its non-parent boundary | `docs/route-register.json#policyContracts.embryo-donor-attribution-v1` | invitation, acceptance, revocation, cohort finalization, purpose-derived output, Copilot, worker and export consumers; an identified donor can enter only `attributionPrincipals`, never the other four embryo authority sets |
| Scheduled retention phase identity, clocks, ordering and execution classification | `docs/route-register.json#lifecycleDispositionContracts.retention-due-phase-v1` with dispositions from `docs/retention.md` | scheduler, mail worker, purge worker, review closure, ingest unwind and exact `(retention row, phaseId, phaseRevision)` idempotency tests |
| Closed sensitive purge classes, ordered table/object targets and zero-residual proof | `docs/route-register.json#lifecycleDispositionContracts.sensitive-purge-target-registry-v1` | revocation purge, scheduled retention purge, account deletion, inline physical dispositions, schema ledger/introspection, service-role verifiers and crash/race tests |
| Seven-year legal-audit prefix retention, serialized database-owned sequence/time, immutable checkpoint and chain proof | `docs/retention.md#audit.legal-log-7y` plus `docs/route-register.json#lifecycleDispositionContracts.sensitive-purge-target-registry-v1` manifest class `audit-chain-retention-only` | the sole unexposed append and retention functions, monotonic `seq`/`occurred_at` database invariant, scheduler/retention worker, contiguous-prefix manifest, checkpoint verification and no-subject-selector tests |
| Revocation purge claim, phase separation and frozen-manifest execution | `docs/route-register.json#lifecycleDispositionContracts.revocation-disposition-purge-v1` | revoke-purge job enqueue/claim/batches, exact subject/pair/cohort-purpose/donor tuples, source holds and delete-start concurrency gates |
| Scheduled retention purge claim and frozen-manifest execution | `docs/route-register.json#lifecycleDispositionContracts.retention-purge-v1` | `jobs.retention`, claim/transfer/renewal/hold race gates, ordered bounded deletion and terminal control-row handling |
| Live authenticated-session authorization, database helper profile and authenticated-derived capability revocation | `docs/route-register.json#authContracts.authenticated-session-v1` | every authenticated/private page and endpoint, reviewer operation, RLS/RPC decision, `inherit_upload_only` Storage insert, service-role follow-on, upload/ingest/evidence/export/download/model capability and sign-out/reset/account-finalization path; a JWT, cookie or capability never survives loss of its originating live Supabase `session_id` authority |
| Security rate-bucket key shape, first-attempt clock, HMAC rotation, non-enumeration and deletion | `docs/route-register.json#securityRateLimitContract` | every registered public, token, authenticated-abuse-control and machine bucket; route-specific ceilings consume this authority and retention ID `security.rate-limit-hmac-24h` without storing a raw network, contact, key, token, credential, principal or target value |
| Worker-job idempotency tuple and conflict equality | `docs/route-register.json#policyContracts.worker-job-enqueue-v1` | worker-job migration, every enqueue/claim resolver and tests for all three embryo score outputs, revoke/regrant and intentional computation-version reprocessing |
| Directional purpose-grant endpoints and one-use presentation-token binding | `docs/route-register.json#policyContracts.directional-purpose-grant-v1` | permissions RSC tokens, `api.consents`, family columns/pairs, reports, workers, exports, downloads, share links, Copilot and raw-export authorization; a no-account Path-B subject is the signer/data subject and the immutable current uploader or grantee account is the recipient; no client recipient ID or family-wide grant is valid |
| Copilot subject/cohort context and stale-turn deletion boundary | `docs/route-register.json#policyContracts.copilot-context-v1` | Copilot route, turn/context/history persistence, local/cloud transport guards, exact purpose/pair/five-set/donor checks and response filtering |
| Future Person Record-Key and no-account Card delivery authority | `docs/route-register.json#tokenSecurityContract.futurePersonRecordKey` and `#tokenSecurityContract.futurePersonRecordKeyNoAccountDelivery` | cohort finalization, current recipient print rights, authenticated and no-account Card routes, transfer/addendum rotation, claim intake and credential purge |
| Global sensitive-data observability sink boundary and allowed slot classes | `docs/route-register.json#observabilitySinkContract` | every page, endpoint, redirect, worker, background task and external-provider adapter; raw request, response, error, PII, genetic, embryo, evidence, consent, claim and model values never reach logs, traces, analytics or error capture |
| Named observability event templates and their recursively closed typed slots | `docs/route-register.json#observabilityEventTemplates` | `src/lib/observability/events.ts` is the generated enforcement wrapper; its absence and any direct production `console`, provider-error-message or unregistered sink call are explicit release blockers |
| Observability event slot code values | `docs/route-register.json#observabilityCodeRegistries` | every `enumFrom` slot in the named template registry and the generated wrapper; copied or unregistered values fail before the sink |
| Self-hosted genetic worker claim and execution entrypoint | `scripts/worker.ts` with `docs/route-register.json#workerExecutionBindings.self-hosted-worker-claim-and-execution` | `jobs.run`, queue claims, embryo sanitization, analytic workers and worker tests |
| Public security-contact document | `content/security.txt` | registered route `public.security`, incident-response links and `security-text-v1`; runtime interpolation is forbidden |
| Canonical-artifact index | `docs/canonical-artifacts.md` | `gate:canon` |
| Schema requirements before migration authoring | `docs/schema-requirements.md` | Supabase migrations only |
| Jurisdiction statuses, capabilities and `TEST-LOCAL` | `data/jurisdictions.json` | `src/lib/legal/jurisdictions.ts`, settings picker, jurisdiction E2E |
| Citation metadata | `data/citations.json` | report templates, legal/science surfaces, provenance gate |
| Claim text, quantity, population, portability and evidence bindings | `data/claims.json` | result renderers, claim and science gates |
| Report templates | `data/templates/*.json` under `data/templates/SCHEMA.md` | seed and template gate |
| Reference-build inference algorithm, minimum comparison count, agreement threshold and challenge outcome | `docs/route-register.json#policyContracts.genome-build-inference-v1` | `src/lib/genome/build-inference.ts`, `data/ref/build-discriminating-sites.json`, file and embryo ingest routes, self-hosted worker and ingest tests |
| Genetic-ingest rejection IDs and user-facing messages, and the subject target's cohort-shaped-source refusal (`upload.subject.single-sample-required`) | `src/copy/upload/errors.ts` | today: the uploader's browser preflight, the per-embryo QC reasons (`src/copy/embryos/qc.ts` spreads the halves), `src/lib/genome/ingest-errors.ts` (the brief's path, a re-export) and `src/copy/upload/errors.test.ts`; when E0 wires them: the file processor's server-side re-sniff, the embryo ingest routes and their API/RSC states. Every A.6 code is defined once here |
| Laboratory-table header synonyms and the forbidden sex, gender and karyotype headers | `data/ref/lab-tables/column-synonyms.json` (exact equality after lower-casing and stripping non-alphanumerics; substring and fuzzy matching forbidden) | `src/lib/genome/parsers/pgt-table.ts` (the header rule and the mapping plan), `sniffV2`, the browser preflight, the future `api.embryo-ingest-mapping` route and `pgt-table.test.ts` |
| Embryo-ingest payload and session limits | `docs/route-register.json#payloadBoundaryContract` | `src/lib/genome/ingest-limits.ts` is the tested runtime mirror (`ingest-limits.test.ts` asserts equality); the `too_large` sentence's `{n}` reads it for an embryo ingest and `src/lib/limits.ts` for a subject file |
| Provider directory | `data/providers/providers.json` | registered route `marketing.providers`; this is the only competitor-name carve-out |
| Counsellor directory | `data/counsellors/directory.json` | counselling surfaces and mail |
| Short-string vocabulary | `data/plain-vocabulary.json` | copy registry and language gate |
| Jargon requiring an inline definition | `data/jargon.json` | first-glance and language gates |
| Allowed external organisation names | `data/allowed-external-names.json` | names gate |
| Evaluative proximity tokens | `scripts/evaluative-tokens.json` | names gate |
| Anti-patterns | `docs/anti-patterns.md` | tests, code comments and review checklist cite ids only |
| Ancestry region definitions, population mappings and minimum-marker thresholds | `data/ref/regions/regions.json` | ancestry computation and map |
| Ancestry region geometry (quantized TopoJSON) and its build provenance | `public/geo/regions.topo.json`, `public/geo/GEOMETRY_PROVENANCE.md` | the ancestry map, decoded and projected on the server by `src/lib/geo/`; regenerated only by `scripts/build-region-geometry.ts` (ADR 0013) |
| Forbidden ancestry label words (demonyms and ethnonyms; never a company or product name) | `data/ref/regions/label-denylist.json` | region unit tests and the ancestry E2E |
| Retention clocks and artifact dispositions | `docs/retention.md` | route disposition IDs, purge jobs, export/deletion UI and legal copy |
| Legal artifacts and exact versions | `content/legal/{artifact_key}/v{n}.md` | legal routes, the consent artifact seed (the migration repeats the body verbatim, single-quoted, because a migration cannot read a file; `content/legal/legal-content.test.ts` fails when seed and file differ), signatures |
| Embryo operation nonce and CSRF token contract (claims, contexts, lifetime, placement) | `src/lib/embryos/operation-token.ts` | every embryo route; `embryo_operation_nonces` records the consumed digests |
| Record Key alphabet and length | `src/lib/embryos/record-key-cards.ts` (`RECORD_KEY_ALPHABET`, `RECORD_KEY_PATTERN`) | `private.embryo_record_key_v1` is the generating mirror; pgTAP asserts the format |
| Embryo artifact statement keys | `src/lib/embryos/basis.ts` | `private.embryo_statement_keys_v1` mirrors them; `content/legal/legal-content.test.ts` asserts equality; the bodies number the statements in the same order |
| Legal rendered-string anchors and review status | `docs/legal-register.json` | legal gate and review checklist |
| Attestation statements | `content/attestations/<kind>/<version>.md` | server signing routes |
| Legal/human review records | `docs/reviews/` | jurisdiction resolver and release gate |
| Copy-review findings, reviewer metadata and status only | `docs/copy-review.md` | release checklist; it never defines a rendered string |
| User-visible product copy outside versioned legal/science/attestation artifacts | `src/copy/**` | components, API message renderers, mail templates, Copilot guards and language gate consume copy IDs |
| Science positions | `content/science/positions/*.md` | registered route `science.positions`, science gate |
| Figures reused across surfaces | `docs/figures-register.json` | differencing and cross-surface gates |
| Baseline and post-change viewport measurements | `docs/density-baseline.json` | density gate |
| Fixture-bearing production paths | `docs/fixture-paths.md` | mock-token allowlist and G8.2 |
| Permitted mock-token paths | `scripts/mock-token-allowlist.json` | mock-token gate |
| Permitted secret-pattern paths | `scripts/secret-allowlist.json` | secrets gate |
| Capability ship/withhold status | `docs/capability-register.md` | release checklist and comprehension variants |
| Withheld-capability evidence | `docs/withheld/<capability>.md` | capability register |
| Gate blockers | `docs/blocked/<gate-id>.md` | acceptance matrix and release checklist |
| Acceptance evidence | `docs/acceptance-matrix.md` | release decision; A1–A18 are append-only |
| Gate run evidence and exit codes | `docs/protocol/gates.md` | release decision |
| Test changes | `docs/test-diff-register.md` | G8.1 |
| Test seed paths and identities | `docs/fixture-paths.md` | E2E and comprehension harness |
| Comprehension tasks and grading | `docs/comprehension-protocol.md` | `scripts/comprehension/` |
| Raw comprehension runs | `docs/comprehension-runs/<date>/` | G3 evidence |
| Release obligations and human sign-offs | `docs/release-checklist.md` | release decision |
| Architecture decisions | `docs/adr/NNNN-*.md` | implementation and acceptance evidence |
| Multi-workstream path ownership | `docs/protocol/ownership.md` | contributors and migration owner |
| Append-only approach, defect, decision and gate ledgers | `docs/protocol/approaches.md`, `docs/protocol/defects.md`, `docs/protocol/decisions.md`, `docs/protocol/gates.md` | adversarial loop |

## Database schema and enums

`docs/schema-requirements.md` is the pre-migration request ledger. Once a requirement is implemented, the ordered SQL in `supabase/migrations/` is authoritative. Generated Supabase TypeScript types are a mirror, never a schema authority. The Platform workstream is the sole migration author.

| Item | Canonical home |
| --- | --- |
| `subjects`, `subject_demographics` | ordered Supabase migration series; exact required columns originate in X2 |
| Consent artifacts, signatures, purposes, grants, subject consents, invitations and attestations | ordered Supabase migration series; X3; `subject_consents.jurisdiction` is mandatory |
| `embryo_cohorts`, `embryos`, `embryo_qc` | ordered Supabase migration series; X3/X10 |
| The only audit table, `legal_audit_log` | ordered Supabase migration series; X3.1 |
| Finding layer and estimate kind | `report_templates.layer`, `report_templates.estimate_kind` constraints |
| Evidence-level vocabulary | ordered Supabase migration constraint; values are not restated here |
| Chat-scope vocabulary | ordered Supabase migration constraint; values are not restated here |
| Subject-kind vocabulary | ordered Supabase migration constraint; values are not restated here |
| Upload-class vocabulary | ordered Supabase migration constraint; values are not restated here |
| Subject-lifecycle vocabulary | ordered Supabase migration constraint; values are not restated here |
| Attestation-kind vocabulary | ordered Supabase migration constraint; values are not restated here |
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
| `data-figure-kind` vocabulary | `src/lib/figures/contract.ts`; values are not restated here |
| `data-figure-class` vocabulary | `src/lib/figures/contract.ts`; values are not restated here |
| Provenance-attribute vocabulary | `src/lib/figures/contract.ts`; values are not restated here |
| Natural-frequency algorithm | `src/lib/figures/natural-frequency.ts` |
| Reference-group vocabulary and term definitions | `src/copy/figures/reference-groups.ts`; `src/lib/figures/copy.ts` is a generated/re-exporting consumer |
| Fixed report headings | `src/copy/reports/headings.ts`; `src/components/reports/report-skeleton.tsx` is the renderer |
| Ancestry surface copy: headings, map caption, toggle, chips, table headers, panel, grey state, lineage and Neanderthal sentences | `src/copy/ancestry.ts`; `src/components/results/ancestry/*` and `src/app/(app)/genome/[subject]/ancestry/page.tsx` are the renderers; the panel constants they name come from `src/lib/ancestry/panel.ts` |
| Evidence labels and accessible words | `src/copy/reports/evidence.ts`; glyph selection and renderers consume the copy IDs |
| Family surface copy: hub tiles and card state lines, the Tier-2 gate, the person-page states, the two permission columns and their five rows, pause/stop/tombstone and the invitation screen | `src/copy/family/{index,person,permissions,invite}.ts`; `src/app/(family-hub)/family/`, `src/app/(app)/family/**` and `src/components/family/*` are the renderers |
| Family people graph: the handle, its data subject, the two grant directions and the pause flag | `src/lib/family/graph.ts`; `src/lib/family/{access,subject-route}.ts` and every Family surface are consumers, and `src/lib/subjects.ts` carries the `dataSubjectId` it resolves |
| Portrait and future-child trait allowlist | `data/family-trait-allowlist.json`; TypeScript is a generated consumer |
| Embryo autosomal-only ingest, persistence, computation and export prohibition | `docs/route-register.json#policyContracts.embryo-autosomal-only-v1`; `src/lib/embryos/policy.ts`, upload handlers, parser filters, database constraints and export guards are enforcement consumers |
| Embryo QC metric definitions, X10.4 thresholds, null handling and interval-widening behavior | `src/lib/embryos/qc-policy.ts` | `embryo_qc` constraints, worker computations, detail/comparison RSC DTOs, exports, science disclosure and exact-threshold tests; no consumer may restate the numbers |
| Embryo non-ranking presentation rules | `src/lib/embryos/policy.ts`; database constraints and renderers are enforcement mirrors |
| Copilot refusal strings | `src/copy/copilot/refusals.ts` |
| Embryo upload flow copy: the three questions and their options, the class attestations, the basis screens and their sentences, the step and still-to-come lines, the honest terminal | `src/copy/embryos/upload.ts`; `src/components/embryo/upload/*` and `src/app/(app)/embryos/upload/page.tsx` are the renderers; `src/lib/embryos/upload-flow.ts` is the flow's one reducer |

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
| Transactional template IDs, payload schemas and required/optional delivery | `src/lib/mail/registry.ts`; rendered words resolve from `src/copy/mail/**` |
| Durable delivery requests | canonical database mail outbox |
| Local/test mail capture | `src/lib/mail/test-adapter.ts` |
| Sender domain and addresses | `src/lib/mail/registry.ts`; deployment environment supplies credentials only |
| Supabase machine binding | project ref `zuvloczwgrayonqabnss` |
| Vercel machine binding | project id `prj_K7bVowhjFr0uIapXraH41hthJkgy` |
| GitHub machine binding | repository `themariodiego/Inherit.bio` |

The Resend sender domain must not be assumed from a project name. It ships only after the actual domain is verified and the registry/configuration agree.

## Gate commands

`package.json` is the sole command-name registry. Concern-gate command names are not restated here; documentation and workflows resolve them from that registry.

Build, typecheck, lint, unit, E2E and seed/reset commands are workflow commands rather than concern gates. `gate:language` supplies the evidence requested under the G1.10 label `gate:readability`; no second alias is created.

## Change rule

Change an authority and its consumers in one reviewed change. When a generated mirror differs, the authority wins and the mirror is regenerated. Creating a second list, enum, copy constant, route table, threshold or gate alias to avoid updating the authority is prohibited.
