# Citation review worklist

This is the unreviewed source-surface queue proposed for integration against
release `587007a0`. Its 59 entries are unchanged from `76927bd9`. The JSON
[claim-surface-backlog.json](claim-surface-backlog.json) is the canonical gate
input. No verdict, reviewer, date, qualification or signature has been supplied.

The owner selected personal scientific review. That intention does not satisfy
a required review, distinct external reviewer or author-independence obligation.
Read the source and rendered context, choose product wording or a claim to
register, and record only actual review metadata. A claim requires genuinely
supporting source evidence, its real access scope/date and the allowed verbatim
quotation of at most 25 words. Do not treat the extraction placeholder `fact`
as a publication quotation or infer a numerical result from it.

The marker scan is bounded: it does not classify unmarked science, runtime
values or scientific adequacy. Every section below remains pending. Emails are
scanned too; no email sentence currently carries a marker.

## copilot-context — 7 pending

### src/app/api/chat/route.ts

Source: [src/app/api/chat/route.ts](../src/app/api/chat/route.ts)

- `4661ac8ccdffcc1585dde25affc0bfb37dbe80e23af914a7a1c2928dc147cad7` — Frame everything as association and probability shift, with effect sizes where available. - Ground every substantive claim in the user's own data via the tools, and cite which report or variant it came from (e.g. "your Caffeine metabolism report (rs762551, genotype A/A)").

- `50ca227664a9b4a10671c75127c1292c7c62e15aa63e28a7bedb4a7025b0cdb2` — The rsID to look up, e.g. 'rs762551'

- `8fae27cf6edde9da682d59e51911ee8dca51dc62af9d6bc8c18755c170a88c07` — Coverage counts are not risk; do not turn them into one.

- `b68bd251517276494a7f86929dedf7deed2062462731083884acc3c390e148d3` — Never invent genotypes — only report what tools return. - Sensitive topics (cancer, neurodegeneration, mental health, reproductive decisions): extra care, remind the user this is one small factor, and suggest a clinician or genetic counselor for decisions. - Refuse requests to diagnose, prescribe, or interpret data of people other than the account holder. - Never say an embryo is better, best or recommended, never rank embryos, never advise what to do with one, and never predict or disclose an embryo's sex. - State no number that the tools did not return this turn, and cite nothing beyond the citations the tools returned. - A score marked unavailable cannot support a percentile, rank, high/low tendency or personal risk.

- `d9b7048bca4bc2ea986d012d11661b2ea42502204ba65147ddf55bfeb97d1c17` — No percentile, rank or risk is available.

### src/copy/copilot/refusals.ts

Source: [src/copy/copilot/refusals.ts](../src/copy/copilot/refusals.ts)

- `33088ab9b75fe8a6a53a0e1cc5336f0af1071ec9d4cad62e5ec886e119a66868` — I can explain what your reports say and which studies they rest on.

### src/lib/copilot/own-chat-route.ts

Source: [src/lib/copilot/own-chat-route.ts](../src/lib/copilot/own-chat-route.ts)

- `4f0c20b56b3f59e0a13734f47e6bb104f10c071a10feb8371fb6fd7cc369d6e4` — No personal score, rank, percentile or risk is available.

## embryo-card — 3 pending

### src/copy/embryos/compare.ts

Source: [src/copy/embryos/compare.ts](../src/copy/embryos/compare.ts)

- `5498f3dcd2cb8c310085a08e45ca7f6034a2592c7f264d9f94cefd6e34e9ee90` — of this score’s positions were found.

- `cba94257cb35188a7bc380b985507de208ab36a68507422e38886eb711b2b170` — Too little of this score is in the file the laboratory sent to give a number. fact of fact positions were found.

### src/copy/embryos/tradeoffs.ts

Source: [src/copy/embryos/tradeoffs.ts](../src/copy/embryos/tradeoffs.ts)

- `5a9b28b86256fd3a8e95627fd41bb067a01c0fa5a351905e1f29ef5abea71895` — fact has the lowest fact risk and the highest fact risk.

## portrait — 9 pending

### src/copy/family/health-picture.ts

Source: [src/copy/family/health-picture.ts](../src/copy/family/health-picture.ts)

- `7a592c9193c29fb4f644ec03b7229413f17ee71ba9f728373a0d78fa89131ef4` — — a 1 in 4 chance — that a child inherits both copies.

- `c8e644bf9f8fe255c8c8d584dfb70bed686a232c9b07ec5e25d6f8085c1911e0` — Each pregnancy is independent; this is not 1 in 4 of your children.

### src/copy/family/portrait.ts

Source: [src/copy/family/portrait.ts](../src/copy/family/portrait.ts)

- `09f3c1391bfe4f7a30b29c3153b389109b210ae4970dcd8f3144966b5f01da69` — Fewer than 1 in 100 — but not zero.

- `33bfe1b850d31ac39f2894429991b54116c122d106e8b224df7112e4d357a8e5` — This is routine care, not a risk to the pregnancy.

- `59161364981055095f06795c28f2c9a4fb3cbb98ca24d38039503e7b5e404af0` — A file for fact that covers more of the changes known to cause this condition.

- `71e6ff91e0d07b48827fc3956da2a8f76b3d1599e6fd7194a8130629ce5d8ef3` — This is not zero risk: your files do not cover every variant known to cause this condition.

- `897e668d59d65d595c89ceedf4eb3b90e73ae16af6b583dd628fb6d70fde243a` — Both files cover the one change known to cause this condition.

- `c4fb1c065136f2f4546bf1dfd1a5af1915cea79940a7aac5e772e8c4830e05c4` — Both files cover fact of the fact changes known to cause this condition.

- `c7ac5dcdc81c50374c382db51c1a01fab951e0ed28b2fd08f8f71172e2de740b` — Disease risk for a hypothetical child from polygenic scores.

## report-copy — 40 pending

### src/components/reports/sensitive-gate.tsx

Source: [src/components/reports/sensitive-gate.tsx](../src/components/reports/sensitive-gate.tsx)

- `934d1999f2b07693c960065fa57047f0f4828671cec3777e119812b28c70aae9` — This report may show a serious health risk.

### src/components/results/ancestry/regional-ancestry-regions.tsx

Source: [src/components/results/ancestry/regional-ancestry-regions.tsx](../src/components/results/ancestry/regional-ancestry-regions.tsx)

- `6c7075806314cc4fb0113141bc704a802f1bc624eff8937d081299e40b75095f` — This reference combines samples from study groups.

### src/copy/genome/data.ts

Source: [src/copy/genome/data.ts](../src/copy/genome/data.ts)

- `34bc3a05d1043a3fa497c6d1a1784ad4aea69d329e284270cf3f613d16300ec7` — Consumer DNA chip files also cannot rule out inherited cancer risk.

- `9c49c14694b03dd9ad91cdc7a137af5402840dd16098e5ad85db7eddb2c27b84` — Try an rsID (rs123...), a gene symbol (CYP1A2), or a position (chr15:74749576).

### src/copy/regional-ancestry.ts

Source: [src/copy/regional-ancestry.ts](../src/copy/regional-ancestry.ts)

- `0683ec9864bce178933c195bd74c7f3271d521cd7029654f532694c601986b3a` — Oceania uses only two study groups.

- `2aec964c1a2eb35e8ed94275420866239f0e3f53c3883a4d359135c47052341e` — Study groups are comparison sets, not identities.

- `d7f2be2bdb1f4c108c52aca91ae0853dbcf82c0664fb76933d9f24b888eb8f24` — The fact-marker panel uses fact reference samples from fact study groups in the gnomAD HGDP+1kGP release.

### src/copy/reports/basis.ts

Source: [src/copy/reports/basis.ts](../src/copy/reports/basis.ts)

- `a377ba1dc45606f79240cb44e34807efc14e8922fe6151ad0b2ac2a246ec74e0` — A source may be a study or a guideline.

### src/copy/reports/evidence.ts

Source: [src/copy/reports/evidence.ts](../src/copy/reports/evidence.ts)

- `33d265c584b207c902fa29283e85998cb48fc7381ea63e17e43f3a647493a19e` — Seen in only one study, or in studies that do not yet agree.

- `c1be0a637e9b80033d98e9c1decaf16555c85b2fb595ef79d3843f0b09d24c6e` — Seen in more than one study and checked by comparing brothers and sisters.

- `cc3ddf3ae4848f41c5b93f11931f28d51d58876fb6e5cfdb45866204f5509ace` — Seen in more than one study, but not yet checked by comparing brothers and sisters.

### src/copy/reports/personal-previews.ts

Source: [src/copy/reports/personal-previews.ts](../src/copy/reports/personal-previews.ts)

- `1add129659a107203ee3d3b2b9954cc84498e5825e9a79e6795784ef5bfd10f5` — Your file shows a form linked to lower activity of the enzyme that breaks down milk sugar after childhood.

- `1bb835cd87d7302dbb7f769d2165b7078024d870a4abc053de0106e30a65bbcf` — Abstract: dry earwax association and dominance of the wet type

- `203a943e29483ba8831f4872e9921b3d57db48ac8424eeef622ed5e5047174a4` — Your file shows a form linked to keeping the enzyme that breaks down milk sugar active in adulthood.

- `2705aef5da89f1d1802af9b49d69f01d9e6567ba23f211bf1a2bebc284c6c097` — Your file shows a form linked to noticing the asparagus odor less often.

- `2b8174092d45bc4136da764cd0d15fe829534f078a38df86a52e8f88d7e9bd73` — Your file shows a form linked to dry, flaky earwax.

- `56819fe8de48be55064e74e351f36b25baa641951e741e7d5a9aba6e9fc2b89d` — Your file shows the form found in a DNA pattern linked to tasting a bitter test chemical more strongly.

- `5b05f18c8683d31513e0057c9ccd1bde9b7e69f1be450e086e5278e2f56174a0` — Your file does not show the common ALDH2 change linked to alcohol flushing.

- `69ba53cd4f0b32e71d89da7de5e3ce209ba25cc5838c62fd9174f02aed1effe4` — Your file shows two copies of a form linked to less frequent reports of soapy-tasting cilantro.

- `74d11251201aa6f8b5e8bf2e43c8fba5a6d70a826af520a2996b236fbb8b0aa1` — Your file shows the form found in a DNA pattern linked to tasting a bitter test chemical less strongly.

- `78802dba3f67c2cf0fc61023868ad6d2c5881042b6c1b1ac7c7c3b9aba98080b` — The study asked about urine.

- `7d3e9eb4fdf4b97a3e573703d7dccf273e9ecbca9748457f78f9686b8a80304f` — Your file shows one copy of a form linked to more reports of sneezing in bright light.

- `8da876e6cef14b767a7a4475ad801d350f83524045bedeeef98da8d04d7291a5` — Most people with it in the study still noticed the odor.

- `9b62be5039e7120511b1525247ff857e27b194ad192681514d765604494f832d` — Your file shows a form linked to noticing an odor after asparagus.

- `9e28524e36506304154f65275f333b80e8aebe5d67614e918d5a09bef42d5ada` — It does not tell you whether dairy causes symptoms.

- `b78bd31d464b359a0370c5d7fbc1880984c220cb7d25834d80e4d31239aadc38` — Your file shows two copies of a form linked to noticing a soapy taste in cilantro.

- `c09dfe8a9024fd1753871cd174651467f0f37b462b69407628e04a2349a4657b` — Table 2 and Methods: per-A association with self-reported soapiness

- `c3ba83421eb1b941c2f9a3d07aea93a949141ca33a5217500c3867448547c963` — Your file shows one copy of a form linked to less frequent reports of soapy-tasting cilantro.

- `d69acdd281191b4b62c4204490e8b2363d9801bda3204fd8479503ff077799d7` — Abstract: association with biochemically verified lactase activity

- `de64d93c430b17b19253deaefc7e6a9c5f9c4c4d16c874ccb0d02f5844a90ccd` — Your file shows two copies of a form linked to very low ALDH2 activity.

- `e5f90f077632727fd913f4ae6ab52f8278e1e8c2800e17f67932313b5b824541` — Your file shows the form linked to fewer reports of sneezing in bright light.

- `f43b940c813fd1ddfdd582defbe6bf5356160e21fe2b9cf867c9be32d4233912` — Your file shows two copies of a form linked to more reports of sneezing in bright light.

- `fc7223ba01348e5de408d879b28f170293e72d778dfe01545d8bd9f5f7c31efe` — Your file shows a form linked to wet, sticky earwax.

### src/copy/reports/strings.ts

Source: [src/copy/reports/strings.ts](../src/copy/reports/strings.ts)

- `9173904e1c67ae82190607bc02ef0b81c84a97737d91107e38ecf74ce7f74bc8` — Links between DNA and traits found in studies.

- `c7963794388442353ff474269d47924db167ca3596993d76f87a56ddcb2a3bdc` — Common DNA changes linked to a higher or lower chance of some cancers.

### src/copy/reports/study-context.ts

Source: [src/copy/reports/study-context.ts](../src/copy/reports/study-context.ts)

- `07ce165bcd69824737ed7cd8b83ed2bb2587426fba857c255e9e928888dbe313` — What the study measured

- `5b8c391ca80c5826f5c52d330281ba21e7d775322c8b5fe2d73a210d3632db91` — People in the study

- `63303cff66be51841ae75d4e4f7154106ea44e8878e9368a34ede1091f557a51` — What the study found

- `ab93500c8b9b44e9868629b66182c4fafa4c8ea0b2fab4355d19b5338f544405` — About this study, not a personal result.

- `ed67f8c289c34a55b48a08151cbab0dc659f6e8b7c06fed4591c60c1663eb8ea` — Not recorded in this study summary.

## Already registered October source tranche — human review still pending

The [source journal](sources/reviews/primary-source-tranche-20261002.json) and
[review scope](sources/reviews/primary-source-tranche-20261002.md) record 12
actual author-abstract retrievals and 14 canonical context claims. They do not
record publisher full-text review, genotype revalidation or human sign-off.
Keep historical Medicines template dates separate from the new context receipts.

The current mechanical totals are 53 sources / 120 canonical claims, 71 of
227 template citation references and 120 of 750 prose blocks registered.
The remaining 156 template citation references and 630 prose blocks are measured
by the existing claims divergence ledger, independently of these 59 sentences.

For an actual review, bind the verdict/corrections, named reviewer/date, required
qualification and interest disclosure/signature to the exact source commit and
artifact. Keep any distinct-reviewer or external-review requirement pending until
the required people have actually completed it. None is prefilled here.

- [pmid:17952075](https://pubmed.ncbi.nlm.nih.gov/17952075/): blond-hair-kitlg-rs12821256; author abstract accessed 2026-10-02; human review pending.

- [pmid:18509540](https://pubmed.ncbi.nlm.nih.gov/18509540/): celiac-hla-dq2-tag-rs2187668; author abstract accessed 2026-10-02; human review pending.

- [pmid:18711365](https://pubmed.ncbi.nlm.nih.gov/18711365/): bipolar-association-ank3-rs10994336; author abstract accessed 2026-10-02; human review pending.

- [pmid:28198005](https://pubmed.ncbi.nlm.nih.gov/28198005/): vkorc1-rs9923231-one-position; author abstract accessed 2026-10-02; human review pending.

- [pmid:41618934](https://pubmed.ncbi.nlm.nih.gov/41618934/): nudt15-rs116855232-one-position; author abstract accessed 2026-10-02; human review pending.

- [pmid:12595690](https://pubmed.ncbi.nlm.nih.gov/12595690/): bitter-taste-tas2r38-rs713598; author abstract accessed 2026-10-02; human review pending.

- [pmid:12879365](https://pubmed.ncbi.nlm.nih.gov/12879365/): sprint-power-actn3; author abstract accessed 2026-10-02; human review pending.

- [pmid:18193043](https://pubmed.ncbi.nlm.nih.gov/18193043/): ldl-cholesterol-sort1-rs599839; author abstract accessed 2026-10-02; human review pending.

- [pmid:18199861](https://pubmed.ncbi.nlm.nih.gov/18199861/): hemochromatosis-hfe-c282y-rs1800562; author abstract accessed 2026-10-02; human review pending.

- [pmid:19934046](https://pubmed.ncbi.nlm.nih.gov/19934046/): social-sensitivity-oxtr-rs53576; author abstract accessed 2026-10-02; human review pending.

- [pmid:20541252](https://pubmed.ncbi.nlm.nih.gov/20541252/): vitamin-d-cyp2r1-rs10741657; author abstract accessed 2026-10-02; human review pending.

- [pmid:23535734](https://pubmed.ncbi.nlm.nih.gov/23535734/): longevity-telomere-terc-rs10936599; author abstract accessed 2026-10-02; human review pending.
