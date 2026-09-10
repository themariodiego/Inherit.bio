# Browser-test genome fixture provenance

These fixtures are synthetic test data or explicitly identified public reference
benchmarks. Synthetic fixtures describe no real person; the public HG001
benchmark is not synthetic. Never substitute private customer, patient, or
personal genome data.

## HG001_GRCh38_chr20_1000000-1100000.vcf.gz

- Classification: public GIAB / NIST HG001 (NA12878) reference benchmark window,
  not invented genotypes. The checked-in parent and upstream source hashes,
  retrieval date and terms are recorded in `data/samples/PROVENANCE.md` and
  `docs/dataset-licenses.md`.
- `scripts/generate-giab-browser-window.mts --check` reproduces all original
  headers and all 144 chr20 records at inclusive positions 1000000–1100000,
  retaining every field and original order. It makes no genotype or ID edits.
- The bounded window is 7,011 compressed bytes / 100,410 decoded bytes. Its
  receipt records the parent hash, decoded hash, 127 supported calls and 17
  unsupported records. Browser rsID/gene positive assertions use the separate
  synthetic `tiny-grch38.vcf`; canonical parent lineages remain uncomputed.
- Repository SHA-256:
  `4b9accc049c47395dacdf0dc6f3a78234819aa83aef1abb0fe4096940c2b8ecd`.

## behavior-scope-grch38.vcf

- Classification: hand-written synthetic single-sample GRCh38 VCF. It
  describes no real person: FAAH AA, BDNF CT and COMT AG were invented to
  exercise the three revised reports. No genotype came from a person.
- Coordinates and reference/alternate letters match the existing template
  positions, independently checked against Ensembl on 2026-09-06; see
  `docs/sources/reviews/batch-02/independent-correction-review.md`.
- The browser test uses the actual upload, processing and report routes,
  including the existing mental-health opt-in. It checks the resulting
  letters, interpretation, source context and source-read dates.
- Repository SHA-256:
  `91995e8a7754eba9e8d9bd6c04aa543cbf58f748be819a437d5eda10712bfaaa`.

## observed-reference-grch38.vcf and observed-reference-grch38.txt

- Classification: hand-written synthetic VCF and consumer-array representations
  of five public report positions with invented homozygous reference calls.
  They describe no real person and contain no customer or personal genome.
- The browser test compares actual processing, report previews and ALDH2
  detail; VCF `0/0` must match the equivalent array base genotype without
  creating variant rows or changing variant-only analyses.
- Repository SHA-256, VCF:
  `492f53687668cf19561a6ab0402e2d189bf0018f908baa04fdd77bb898fea7cf`.
- Repository SHA-256, array:
  `9a6b68acfd4d3f3086b9f735f7765e03cfa97a2fa25d3c29a13ac928e2eb4f2b`.

## personal-previews-grch38.vcf

- Classification: hand-written synthetic single-sample GRCh38 VCF with five
  public report positions and invented genotype calls. The four reviewed
  trait calls exercise dry earwax, adult lactase activity and the form at
  the bitter-taste position, plus an ALDH2 AG call; caffeine supplies another covered report for
  the library filter. No genotype was read from a real person or sample.
- The production-browser test runs the actual upload and processing path
  before reading the cards and their linked reports.
- Repository SHA-256:
  `3a7d4c51e5fea9a241909c24f83433b601289ad3f032128c87c6dd229128b361`.
- The caffeine row now uses the verified forward GRCh38 REF C / ALT A.
  This corrects the former swapped alleles without changing its AC call.

## tiny-grch38.vcf

- Classification: synthetic VCF assembled solely from four public variant
  coordinates and invented genotype calls.
- Repository SHA-256:
  `6f661a97271720aada0b5caf2a9193986d9c9d9c4449c85cb6244ed0c024d423`.
- The caffeine row uses forward GRCh38 REF C / ALT A, correcting swapped
  labels while preserving the invented heterozygous A/C call.

## tiny-b-grch38.vcf

- Classification: synthetic single-sample GRCh38 VCF, the second seed for
  G8.3's two-seed differencing on the report surface. It describes no real
  person, and describes a different one from `tiny-grch38.vcf`: it carries the
  same four positions with genotypes chosen here by hand so that every figure
  the report surface renders has to move, plus one further record so the file's
  own record count differs too. No genotype was read from any person or sample.
- Against seed A: `rs4988235` 0/1 where A is 1/1, `rs1815739` 1/1 where A is
  0/1, and `rs762551` 1/1 where A is 0/1.
- The fifth row is an unnamed SNV at chr11:66561000, a position no report
  template uses. It is here so the input-provenance figure — which counts the
  file's own supported records — differs between the seeds. That figure
  describes the upload rather than the science, and two people's files
  legitimately carry different record counts, so a differencing gate should see
  it move; registering it as seed-invariant would have recorded a limitation of
  these fixtures as a property of the product.
- `rs671` is 0/0 in both, and that is deliberate rather than an oversight. The
  VCF parser drops homozygous-reference rows, so the position is uncovered
  under either seed and renders no figure to compare. Giving it a called
  genotype under one seed only would make the two surfaces differ in which
  figures exist, which is a structural difference and not the value difference
  this gate is about.
- Repository SHA-256:
  `964643cb6ec643c1e4d948cb998ff4f46394b79aa968b1c8946bb9f413aa8fc8`.

## aims-mixed-grch38.vcf

- Classification: synthetic single-sample GRCh38 VCF with one row at every
  position of the shipped ancestry marker panel (`data/ref/aims.json`), so
  the ancestry page's shown state has a browser test. It describes no real
  person: every genotype is drawn by a seeded pseudo-random generator
  (mulberry32, seed 13) that picks a reference superpopulation per allele
  copy by fixed mixing weights and then ALT with that population's public
  panel frequency. No genotype was read from any person or sample.
- Generated by `pnpm exec tsx e2e/fixtures/generate-aims-vcf.ts`, which
  rewrites the file byte-identically and refuses to write it unless the real
  parser and estimator, run over the output, report at least the minimum
  usable markers for a map and at least one region below the well-supported
  threshold.
- Repository SHA-256:
  `7ac14bf840bcc6cc16c3865479f35e834be563640efbdc546600a8c24a7771b6`.

## aims-mixed-b-grch38.vcf

- Classification: synthetic single-sample GRCh38 VCF, the second seed for
  G8.3's two-seed differencing. It describes no real person, and describes a
  different one from `aims-mixed-grch38.vcf`: the genotypes are drawn by the
  same seeded generator (mulberry32) at seed 21 under different mixing
  weights, then ALT with each population's public panel frequency. No
  genotype was read from any person or sample.
- Both the seed and the weights differ from seed A on purpose. Redrawing the
  same mixture at a new seed lands near the same proportions, and two seeds
  that agree to the decimal the page renders would let a differencing gate
  pass while proving nothing. Under this draw all five regions differ: AFR
  5.7 against seed A's 25.5, AMR 44.8 against 65.2, EAS 19.6 against 8.8,
  EUR 0.0 against 0.5, and SAS 29.9 against 0.0.
- It also carries only 154 of the panel's 168 positions, dropping every
  twelfth, so the coverage figures differ between the seeds too rather than
  reading "168 of 168" under both and having to be registered as
  seed-invariant in `docs/figures-register.json`.
- Generated by `pnpm exec tsx e2e/fixtures/generate-aims-vcf.ts`, which
  writes both seeds byte-identically and refuses to write either unless the
  real parser and estimator, run over the output, report at least the minimum
  usable markers for a map and at least one region below the well-supported
  threshold. This seed reports 74 usable markers against a minimum of 42.
- Repository SHA-256:
  `add39a3f8e744214b5ef8447472396d08adfd29bbfafd1e7401b312e06dce5a1`.

## carrier-pair-grch38.vcf

- Classification: synthetic single-sample GRCh38 VCF written by hand for the
  Family health-picture spec. It describes no real person: every coordinate
  and every genotype is invented here, and the seven classified positions use
  reserved synthetic rsIDs (999999001–999999007) that exist in no public
  catalogue. No genotype was read from any person or sample.
- It carries three kinds of row and nothing else: the seven synthetic
  positions (four with one changed copy, one with two changed copies, and
  two with a changed copy of a letter other than the classified one, so the
  file covers them without showing the classified change); one run of
  homozygosity by the cited definition (McQuillan et al. 2008,
  doi:10.1016/j.ajhg.2008.08.007) — thirty rows called homozygous for the
  reference, 60 kb apart, spanning 1.74 Mb — so the file is measurable at
  all and its measure sits below both thresholds the brief states; and the
  four positions of `tiny-grch38.vcf`, so the side-by-side table has covered
  reports.
- Generated by `pnpm exec tsx e2e/fixtures/generate-carrier-pair-vcf.ts`,
  which rewrites the file byte-identically and refuses to write it unless the
  real VCF parser reads build GRCh38 and the intended genotype at all seven
  positions, and the real runs measure reports the file measured, holding at
  least one run, and below both thresholds. The spec checks the committed file against the generator's
  output and the stored runs measure against the same real measure.
- Also ingested for both accounts of `e2e/portrait.spec.ts`, which
  classifies the same seven positions under its own synthetic gene names
  (`PTGENE1`–`PTGENE7`) and removes them in `afterAll`.
- Repository SHA-256:
  `b9c5f7d77c8ea9e094869d41189e5198e74e481a72698066074f5d9c312c9f8c`.
- The shared caffeine row and its generator use forward GRCh38 REF C / ALT A;
  all genotype calls and the measured run of homozygosity are unchanged.

## tiny.bam

- Classification: synthetic 14 MiB compressed byte stream used only to test
  interrupted and resumed upload transport. It is not a biological alignment.
- The file is intentionally ignored by Git and generated afresh in
  `e2e/tier2-upload.spec.ts`; there is no committed binary fixture to hash.

## medicines-grch38.vcf

- Classification: synthetic single-sample GRCh38 VCF generated for the
  Medicines tests in `e2e/report-skeleton.spec.ts` (ADR 0021). It describes
  no real person: it carries one row at each of the eleven positions of
  `data/templates/medicines.json` — the GRCh38 coordinates, rsIDs, reference
  and CPIC alternate alleles the research pass verified from Ensembl, dbSNP
  and CPIC on 2026-09-03 — with every genotype invented as one changed copy
  (GT 0/1), and nothing else. No genotype was read from any person or sample.
- Generated by `pnpm exec tsx e2e/fixtures/generate-medicines-vcf.ts`, which
  rewrites the file byte-identically from the seed and refuses to write it
  unless the real VCF parser reads build GRCh38, skips nothing, and reports one
  changed copy at all eleven positions. The spec checks the committed file
  against the generator's output and runs the same check.
- Repository SHA-256:
  `d2994858a68262e3fcc9320e8d228ae5b88eb8266eceb2a28db7af3a05182e89`.
