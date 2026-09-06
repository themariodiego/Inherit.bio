# Browser-suite migration after the own-upload cutover

2026-09-06 checkpoint at `5d755c9`. The local actual-provider runner passes
**23/23 cases in eight specs**, with 16 uploads and zero skips/retries. See
[the receipt](local-upload-browser-verification.md). Standard discovery finds
**224 cases in 41 files**; that entire suite has not passed on this branch.
`ingestFileAs` still has **21 calls in 18 spec files**. An affected-file count
is not a count of demonstrated failures. Acceptance remains **18/65**.

## Migrated and verified

- Preparation, chosen own reports and two-file download/deletion/recovery.
- Three report-library recovery cases, four behavior study-scope cases,
  seven report-preview cases and five sensitive report-gate cases.
- Canonical conversion/listed-call provenance and withdrawal. Report library,
  detail and Data scores use explicit completed report purposes; raw Browser
  uses prepared-source authority. No legacy snapshots are fabricated.
- Overview exact chosen-result readiness and starter ordering are verified
  within the own-report journey. The old populated Overview spec still needs
  its explicit-purpose helper migration; its obsolete `annotated` assumption
  is not a remaining runtime readiness blocker.

Every analytic upload helper call specifies the needed purpose. Repeated
uploads validate existing-choice receipts and the exact selected source.
The array fixture now has the recognized vendor header. Local public
reference templates must be seeded from the tested source; stale templates
were corrected without changing source/interpretation assertions.

The runner still uses actual local Storage with ephemeral public trust,
loopback transport and no Auth rotation. It refuses hosted/CI execution.
A separately reviewed CI bootstrap remains required. Do not remove that
refusal and call the ordinary CI setup a real upload proof.

## Remaining prioritized work

1. **Observed reports/presentation:** report-skeleton has eight registered
   cases. Choose polygenic for estimates and monogenic for Medicines only
   when needed. Preserve all source, sensitive and screen-budget assertions.
2. **Source controls and provenance:** genome-data, network-audit browser,
   account-deletion-purge, file-deletion, deletion-export,
   observed-reference-calls and upload-vcf need actual helper migration.
   Canonical source presentation now exists, but old assertions against
   public ingest snapshots/observed hashes need equivalent exact canonical
   evidence. Do not force `annotated` or remove source/coverage assertions.
3. **Connected surfaces:** report-counts and the old Overview spec can use
   exact selected-result readiness. Copilot's legacy file/genotype loaders,
   independent cloud-model consent and source-bound tool authorization remain
   runtime work. Its 64 shared-output cases use scoped provider mocks, not
   proof of a real external model.
4. **Required notifications:** canonical synchronous generation still lacks
   the durable report-ready mail contract. Retain mail-expiry and deletion
   invalidation assertions until implemented; generation success alone does
   not prove a notice was queued or expired correctly.
5. **Ancestry and shared results:** the dispatcher supports monogenic and
   polygenic only. Ancestry/lineage, adult shared/joint results and Health
   Picture ROH computation need real authorized generation. A saved purpose
   is not a computed result. Modern own reads do not authorize recipients.
6. **Embryos and Tier-2:** existing empty/denied embryo surface cases do not
   prove either positive uploader path, QC, publication or comparisons. BAM's
   old resumable path is unsupported by canonical own declaration; do not
   restore ordinary-login Storage access to pass that test.

For same-origin transport under the proxy, use browser-native requests or
navigation response bodies. `page.request`/`route.fetch` use CONNECT and may
print cookies on failures. Preserve their SSR-denial and mutation evidence;
contexts created manually must inherit the proxy. Keep no-file recovery,
public/legal and jurisdiction-denial cases independent of analytic grants.

## Remaining helper call sites

All paths below are under `e2e/`; these are invocation lines, not imports.

```text
account-deletion-purge:22    ancestry:75
copilot-output:50           copilot-refusal:136
copilot:85                  deletion-export:23,34
family-health-picture:402   family:287
file-deletion:11,84         genome-data:55
legal:209                   mail-expiry:16
network-audit:119           observed-reference-calls:30
overview:233                portrait:339
report-counts:23            report-skeleton:208,544
```

The deliberate legacy victim in `rls.spec.ts` is an isolation fixture, not
canonical upload readiness. Preserve the legacy positive/negative tests and
migrate their runtime prerequisites in bounded batches; do not skip them to
claim a full green run.
