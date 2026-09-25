# Recorded local first run — 23 September 2026

The documented local setup reached a working app on a fresh GitHub-hosted
Ubuntu 24.04 checkout. This record closes G7.2 on the candidate when combined
with the [four-document review](core-docs-review.md). It does not close the
other release rows or establish production readiness.

## Source and method

- [Workflow run 35836543091](https://github.com/themariodiego/Inherit.bio/actions/runs/35836543091),
  attempt 1; job `107101256398`, completed successfully at 08:25:21 UTC.
- PR head: `5061cedee32f899a3c254fb8571a4926d2234d59`.
- Tested merge: `b659df57f072763704219b20e92b049d0cef461a`, with parents
  `109089d143e2efd723f7461cf7e493eac45fb4ae` and the PR head.
- Both commits have the same complete Git tree:
  `46aab78aedc95ee4654ee928e709939ded8d52a2`.
- Node 22.17.0, pnpm 10.33.0 and the pinned dependencies; stock local
  Supabase, Auth, Storage and Mailpit. No hosted credentials or provider
  proxy were used. No existing installation was reset.

The workflow followed the guide's installation, fresh key preparation,
stack startup, configuration, explicit-env seed and development-server
commands. Its browser performed the ordinary forms and file flow; it did
not create a user, consent, report or provider response directly in the
database. Reference seeding and the fresh deployment's upload configuration
are the documented setup operations. The separate full CI runs are not
evidence for this guide and are not claimed by this record.

## Observations

All 13 browser stages passed from 08:23:31.338 to 08:24:30.344 UTC:
preflight, signup, email confirmation, adult account completion, separate
upload consent, stock Storage upload, normalization, report choices,
report generation, a covered report, an absent report, stored ancestry
fallback and unconfigured Copilot. All 11 named checks were true. The final
checks require no unexpected browser requests or page errors; there were
zero continuation rejections.

The file was the committed synthetic
`data/samples/synthetic-pipeline-grch38.vcf.gz`, SHA-256
`46c46da43500f3b1ad5f01524c4ac9bcb52b2bd9a1dcc5b3c33aa8dbbc6a2b44`.
It contains no person's DNA. Its covered report matched the file's call;
its absent position displayed an explicit file limitation. Its three
usable ancestry markers were below the required 168: the page kept a grey
map and a stored support note, with unreliable raw estimates hidden in a
closed disclosure. The expected raw values reproduce the existing
source-bound estimator and presentation, not an independent accuracy study.
Copilot exposed its unconfigured state and settings path; no inference ran.

All eight job outcomes passed: dependency installation, browser installation,
key preparation, stack startup, local configuration, seed, journey and
cleanup. The app's owned process group stopped after TERM. Stock
`supabase stop --no-backup` succeeded, followed by empty project-labelled
container and volume inventories. The browser receipt deliberately has
`shutdownVerified: false`; only the later job receipt attests shutdown.
This local stack disposal does not measure user-data deletion deadlines.

The preceding [run 35834865975](https://github.com/themariodiego/Inherit.bio/actions/runs/35834865975)
passed through the absent report and failed during the ancestry stage;
cleanup succeeded. Source review found its zero-figure assertion contradicted
the retained, hidden partial-result disclosure. The sanitized receipt did
not identify the exact subassertion, so that diagnosis remains an inference.
The corrected run above verifies the stronger closed/hidden/raw-value
contract. Earlier failed attempts are not represented as successful runs.

## Durable evidence and limits

- [Browser receipt](artifact/self-host-first-run.json) and
  [job receipt](artifact/self-host-first-run-job.json): original artifact
  bytes, unchanged. They contain no credentials, emails or raw calls.
- [Independent verification](independent-verification.json): run and source
  identity, artifact metadata, exact file hashes, observations and limits.
- [Reconciliation](reconciliation.json): the tested and final core-document
  hashes. The post-run README and guide edits change proof-status prose;
  every guide command block is unchanged.
- [Core-document review](core-docs-review.md): the remaining half of G7.2.

The Actions artifact has a 14-day lifetime; these copies keep the proof
after it expires. Private startup, seed and app logs, generated keys and
environment files are not included.

This is one fresh local run with one synthetic VCF on Ubuntu. It does not
prove hosted sections 3/4, optional annotation or preparation workers,
external application mail, cron operation, sufficient-marker ancestry,
scientific validity, live local/cloud inference, other browsers or operating
systems, every format or size, resumability, export/deletion contracts or
the full 65-row release. The local 50 MiB upload setting is an admission
bound, not measured capacity. The original hosted 768 MiB proof and any
production activation remain separate work.
