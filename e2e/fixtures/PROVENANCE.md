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
  the report surfaces render has to move, plus thirteen further positions whose
  coordinates are read from the committed report and score panels. Every
  genotype in the file is invented here; none was read from any person or
  sample.
- Against seed A: `rs4988235` 0/1 where A is 1/1, `rs1815739` 1/1 where A is
  0/1, and `rs762551` 1/1 where A is 0/1.
- The further position is `rs182549` at chr2:135859184, the second position
  the lactase-persistence report reads. Seed A does not carry it, so this one
  row moves two figures at once. The input-provenance figure counts the file's
  own supported records and reads four against five: that figure describes the
  upload rather than the science, two people's files legitimately carry
  different record counts, and a differencing gate should see it move. And the
  lactase report's own coverage figure moves with it, from "read 1 of the 2
  positions this needs" under seed A to "read 2 of the 2" here.
- It replaced an unnamed SNV at chr11:66561000 that no template used. That row
  moved the record count and nothing else, leaving the lactase coverage figure
  identical under both seeds; registering it as seed-invariant would have
  recorded a limitation of these fixtures as a property of the product.
- The remaining twelve positions are drawn from the three PGS panels shipped
  under `data/prs/`: three from PGS000011 (rs515135, rs2028900, rs2252641),
  four from PGS000115 (rs11553746, rs1367117, rs17189743, rs1062062) and five
  from PGS004602 (rs10188334, rs11680058, rs7558413, rs34845373, rs72803684).
  Each row takes its chromosome, GRCh38 position and the two alleles from that
  panel's own entry — REF is the panel's other allele and ALT its effect
  allele — and is called 0/1 here, so each counts once towards that panel's
  matched positions. Seed A carries none of them, so `/genome/me/data` reads
  "read 0 of the 50", "read 0 of the 223" and "read 0 of the 424" under seed A
  against 3, 4 and 5 here. Without them all three figures were identical under
  both genomes, and no honest register entry covers that: panel coverage can
  move, these two files simply never made it. The twelve are chosen to be
  unambiguous and disjoint — no palindromic effect/other pair, since the score
  engine skips those; no position used by a report template, a personal-preview
  trait or another of the three panels; and at least 50 kb from every other
  position in the file, so no locus window in the variant browser holds two of
  them.
- `rs671` is 0/0 in both, and that is deliberate rather than an oversight. It
  is read rather than dropped: `user_variants` holds no homozygous-reference
  row, but the report surfaces read the canonical prepared source, which keeps
  reference calls, so both seeds read `rs671` as G/G. It therefore renders the
  same alcohol-flush preview and the same "read 1 of the 1 positions this
  needs" under either seed. That figure is listed in `docs/figures-register.json`
  for the reason it cannot move — a one-position report's coverage is 1 of 1
  whenever it renders at all, because an unread position removes the preview and
  the figure with it — not because these two fixtures happen to agree. Giving
  `rs671` a called genotype under one seed only would change that report's prose
  without moving any figure.
- Repository SHA-256:
  `6f1ea0c90496530e772b50b9291fd77ea1dde3d55a84196e080bdfc4b2156a5a`.

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
