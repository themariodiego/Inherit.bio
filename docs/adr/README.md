# Architecture Decision Records

Every gating or architectural decision lives here, dated, with alternatives
considered. Features must conform to accepted ADRs; changing one means
writing a superseding ADR, not silently drifting.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-gating-decision-large-files-and-compute.md) | Gating Decision: large-file upload path, size caps, compute placement | Accepted |
| [0002](./0002-stack-and-boring-defaults.md) | Stack: Next.js App Router + Supabase + Resend, boring defaults | Accepted |
| [0003](./0003-no-imputation.md) | No imputation in v1; array reports limited to genotyped variants | Accepted |
| [0004](./0004-llm-copilot-privacy-model.md) | Copilot privacy model: BYOK, local-first, per-provider consent grants | Accepted |
| [0005](./0005-annotation-reference-store.md) | Server-side annotation reference store; no third-party calls with user data | Accepted |
| [0006](./0006-secret-fixture-allowlist.md) | Local credential fixtures and secret scanning | Accepted |
| [0007](./0007-private-name-denylist.md) | Private external-name denylist and provider carve-out | Accepted |
| [0008](./0008-readability-contract.md) | Readability scoring and vocabulary contract | Accepted |
| [0009](./0009-statistical-presentation-contract.md) | Statistical presentation contract: one figure vocabulary, claim blocks, denominator ladder | Accepted |
| [0010](./0010-overview-information-architecture.md) | Overview information architecture: hub that informs nothing, nine boxes, five-item navigation | Accepted |
| [0011](./0011-report-taxonomy-and-evidence-rubric.md) | Report taxonomy and evidence rubric: two layers, five levels, nine categories, disclosed remap | Accepted |
| [0012](./0012-jargon-register-everyday-words.md) | Everyday words leave the jargon register; nine genuine terms join it | Accepted |
| [0013](./0013-offline-map-rendering.md) | Offline map rendering: Natural Earth reduced at build time, committed TopoJSON, server-side decode, inline SVG | Accepted |
| [0014](./0014-third-party-adult-consent-and-revocation.md) | Third-party adult subject: consent, sharing and revocation model | Accepted |
| [0015](./0015-future-child-preview-scope.md) | Future-child preview (Portrait): scope, the closed trait allow-list and the refusals | Accepted |
| [0017](./0017-family-health-picture.md) | The Family health picture: people side by side without arithmetic between them | Accepted |
| [0016](./0016-supersede-large-file-transport-and-compute.md) | Supersede large-file transport, formats, and compute placement (supersedes 0001) | Accepted |
| [0018](./0018-pharmacogenomics-withheld.md) | Pharmacogenomics is withheld; the Medicines category ships as a stated absence | Superseded by 0021 |
| [0019](./0019-embryo-comparison-presentation-model.md) | The embryo comparison presentation model: a matrix in file order, never a ranking | Accepted |
| [0020](./0020-embryo-ingest-and-cohort-lifecycle.md) | Embryo ingest and cohort lifecycle: ordinal identity, whole-cohort publication, no file until the parties have signed | Proposed |
| [0021](./0021-pharmacogenomics-per-position-reports.md) | The Medicines category ships as per-position reports from CPIC, dbSNP and PubMed (supersedes 0018) | Accepted |
| [0022](./0022-accurate-estimate-layer-copy.md) | Accurate estimate-layer definition and unavailable-score count | Accepted |
