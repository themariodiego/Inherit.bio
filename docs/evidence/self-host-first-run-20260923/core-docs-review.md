# Core-document review for G7.2

Reviewed on 23 September 2026 against tested head
`5061cedee32f899a3c254fb8571a4926d2234d59`. The brief's complete criterion is
at `docs/inherit-v2-brief.md`, G7.2: update all four core documents and record
a clean clone following the self-hosting guide to a running app with the
new surfaces. This is a documentation and engineering review, not legal,
clinical or scientific approval.

Review of base commit `ab03cc1522f89310ebcb4f87767b75be74da9194` found a seed
command that did not load the instructed environment file, no executable
fresh-local upload configuration, an unproven signer registration sequence,
an unverified sample journey, and outdated ingestion/result descriptions.
Those were engineering gaps, not a need for optional cloud activation.

| Required document | Current contract and checked correction |
| --- | --- |
| `README.md` | Describes the declared array/VCF/gVCF own-upload path, one direct Storage request, deployment limits and disabled optional preparation. Removes the previous resumable BAM/CRAM and implemented FASTQ implications. Describes captured own results, coverage-only polygenic output and separate Copilot permission. Distinguishes ordinary tests from first-run evidence and links the setup sequence. Checked against `subject-upload-contract.ts`, the browser upload path, captured own-result readers, `prs-output.ts`, the seed script and worker scope. |
| `docs/architecture.md` | Replaces the TUS diagram with the current scoped upload and server-only authority path. Distinguishes canonical analysis/preparation journals from older tables and workers. Explains captured content rather than live-template rewriting, source-bound reads, separate purposes and provider-specific cleanup. Checked against the own-upload, own-analysis, ancestry and preparation contracts; the fresh run exercises the ordinary path, not every architecture invariant. |
| `docs/self-hosting.md` | Provides the exact pinned prerequisite and prepare/start/configure/seed/dev sequence. Separate Auth and upload keys, provider public verification, safe fresh-local database setup and atomic environment publication are explicit. Seed uses `tsx --env-file=.env.local`; the full suite belongs in a separate clean checkout. The documented synthetic VCF now has a real signup-to-results journey. Optional hosted setup, annotation, inference and prepared WGS remain explicitly separate. |
| `.env.example` | Labels placeholders as incomplete setup; names the required dedicated upload signer, separate prepared-object admission and worker prerequisites, and the different hosted/non-hosted app-origin behavior. Checked against `storage-upload-token.ts`, `app-origin.ts`, the local setup contract and the bidirectional environment gate. The guide covers every operator key; runtime/test-only variables remain in their existing ledger. No credential value was copied into documentation. |

The four files all changed from base commit `ab03cc1` to the tested source.
Exact tested hashes are in `reconciliation.json`. The successful workflow
then closes the missing runtime half: ordinary signup and confirmation,
the account and permission steps, the real stock Storage upload, selected
results and honest unavailable/partial surfaces all passed.

After that run, only README and guide proof-status prose was reconciled.
The command blocks are byte-identical to the tested guide. Architecture and
the environment template are unchanged from the tested source. The guide's
tested hash remains recorded rather than being replaced with the later
prose hash. The acceptance row retains every earlier failed attempt and
adds the current bounded conclusion; the live count becomes 40 YES / 25 NO.

This satisfies the literal G7.2 criterion for the candidate. It does not
certify optional deployment routes merely because their instructions are
present. In particular, the workflow uses a development server and checks
Copilot without a provider and ancestry below its marker minimum. Full CI,
production build/deployment, scientific validation, broader format/size
coverage and the other acceptance rows retain their own evidence needs.

Local reconciliation checks passed: 35 acceptance-matrix and environment-gate
tests, `gate:env`, `gate:readability`, JSON parsing, local evidence links and
`git diff --check`. The environment gate finds 34 application reads, all 27
operator variables in the template and guide, and seven runtime-injected
variables. A separate static comparison verifies the copied receipt hashes,
the four document hashes, unchanged guide command blocks and every other
gate row. No application or provider was run again for these prose edits.
