# Variant evidence binding — 2026-09-05

This correctness slice changes no clinical conclusion and imports no new
dataset. It prevents legacy reference labels from being promoted to personal
findings. It does not complete clinical annotation or the whole-project gates.

## Findings and decisions

- The refresh route copied an rsID-wide clinical label into an allele-shaped
  reference row. The worker joined only chromosome and position, including
  different ALT alleles and absent genotypes. The old test explicitly expected
  two clinical hits for different alleles at one position; that expectation
  was scientifically wrong, not a safety assertion to preserve.
- Refresh now clears legacy clinical labels, including absent source records.
  It never converts the variation endpoint's clinical-significance list into
  an allele assertion. Database read/write errors return failures.
- Population frequencies require the requested rsID, one GRCh38 placement,
  forward strand, exact chromosome/position/REF and literal single-base ALT.
  Only frequencies naming that ALT are retained. Genome and exome groups
  are never mixed; contradictory or invalid values are withheld. Existing
  unrelated provenance is preserved and the binding is stored with the check
  time. This is source-reported frequency, not a personalized risk estimate.
- Worker reference matches require a known GRCh38 header, exact locus/REF,
  and an actually called ALT in a valid haploid/diploid GT. Missing calls,
  failed filters and ambiguous sample columns cannot match. The result states
  `allele_matches_only`; unknown or conflicting builds state
  `unavailable_build` without querying GRCh38 references.
- Personal ClinVar hits remain empty. A newly invented marker in `sources`
  would not validate an assertion. The carrier-pair production reader also
  remains empty regardless of legacy stored labels; its pure evaluation rule
  and synthetic rule tests remain intact. Both Family and Portrait mark the
  clinical section unavailable and explicitly say it is not a negative
  carrier screen. Browser fixtures prove that labels inserted in the old
  table cannot bypass this boundary. Chat read guards are coordinated in
  the separate score-serialization change, not this commit.
- VCF build declarations are checked together, including contig assembly and
  chromosome-one length. Conflicting or unsupported explicit array builds
  become unknown; existing vendor-profile defaults remain unchanged.
- Processing an unknown build clears only this file's old variants, ancestry
  and scores, then fails without ready mail or new derivative rows. Source
  bytes remain. Cleanup failures are explicit and leave the file failed for
  retry; the three deletes are not an atomic database transaction. A failed
  deletion can leave old derivatives requiring reconciliation.
- GRCh37 point liftover now carries strand and complements single-base calls
  on reversed blocks. Arrays retain null REF/ALT rather than inventing them.
  Non-SNV transformations are withheld and counted among unmapped records:
  point mapping alone cannot normalize complex alleles safely. `genome_files`
  retains the original source build; `user_variants` remains GRCh38, and the
  processing response names both builds.

## Remaining work

The reviewed clinical importer needs normalized allele identity, condition and
assertion identity, germline classification, review/conflict state and source
release/evaluation dates. The rsID-primary-key reference schema does not supply
that contract. Complex-allele normalization and verified reference-aware
liftover are still missing. Older processed files and saved worker outputs need
explicit reconciliation; no hosted data was changed here. Incremental refresh
is not proof that every historical reference row was cleared.

## Verification scope

Focused regressions cover exact and different ALT, multiallelic GT indexing,
missing/malformed/haploid/phased calls, failed filters, mismatched REF, unsupported
and conflicting builds, both frequency-allele ordering directions, inconsistent
population duplicates, source disappearance, database failures, unknown-build
cleanup and reverse-strand processing through the actual route with mocked
storage/database boundaries. The chain mapping uses the existing independently
recorded Ensembl truth coordinate fixture. These are automated correctness
tests, not a clinical validation or production migration audit.

Verified on this branch: typecheck, lint with zero warnings, production build,
1,423 unit tests across 97 files, readability, secrets, template and private
name gates. The two focused Family/Portrait browser suites pass 20/20 tests;
the JSON report confirms zero skips and zero retries. Next emitted four
destination-stream-closed messages during browser navigations; tests passed,
but this is not a zero-runtime-error claim. No hosted migration or data change
was performed. The React review of the two state attributes found no new
client boundary, hook, fetching or serialization change.

## Primary references

- [Ensembl variation POST contract](https://rest.ensembl.org/documentation/info/variation_post):
  identifier-level variation response and optional population allele data.
- [ClinVar variant page](https://www.ncbi.nlm.nih.gov/clinvar/docs/variation_report/):
  variant versus variant-condition aggregates, versioned accession and review
  status. An rsID-wide label does not establish those bindings.
- [VCF 4.5 specification](https://samtools.github.io/hts-specs/VCFv4.5.pdf):
  GT indexes refer to REF/ALT alleles, and a missing GT is not an ALT call.
- Existing `data/ref/chain/` provenance and `liftover.test.ts` truth pairs.
