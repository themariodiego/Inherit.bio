# Carrier assertions: provenance

Built on 28 September 2026 by `scripts/build-carrier-assertions.ts` for the
carrier importer (`docs/carrier-importer-design.md`). These files are public
reference facts about genetic changes. They hold no person's genome, genotype
or result.

## What is here

| File | What it holds |
| --- | --- |
| `conditions.json` | The proposed starter list: eight autosomal recessive conditions, one gene each, with the ClinGen curation each rests on. Awaiting the owner's final nod. |
| `clinvar-assertions.json` | 2,850 ClinVar assertions for those eight genes that meet the evidence bar, each keyed by its exact allele on GRCh38 and GRCh37. |
| `manifest.json` | Every source's URL, retrieval time, SHA-256 and size; the output hashes; and, per condition, how many ClinVar rows were read and why each left-out row was left out. |

## Sources

All were downloaded only from their official hosts on 28 September 2026 (UTC).

| Source | URL | Release | Retrieved | SHA-256 |
| --- | --- | --- | --- | --- |
| ClinVar monthly tab-delimited release | `https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/archive/variant_summary_2026-09.txt.gz` | 2026-09 (published 3 September 2026; 442,495,433 bytes; 9,049,133 rows) | 08:40:57 | `186ad2838a138f0bc7a79b1b7b6dde5533b105175d293e1131652889529804c9` |
| ClinGen gene-disease validity summary | `https://search.clinicalgenome.org/kb/gene-validity/download` | File created 2026-09-28 (3,679 curations) | 08:41:06 | `2851dedb7bae1cbee71fb8e6589f2e1ffb99e44e2244a7785af744c562263dff` |
| ACMG carrier-screening practice resource (Gregg et al., Genet Med 2021; PMID 34285390), PMC full text | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=8488021&rettype=xml` | PMC8488021 | 08:41:26 | `242878d46bcf7822fcc56ad7db3a76ba1de47ab7edfe5ee5c0064de1e07e7d90` |
| NCBI RefSeq reference sequence, 16 windows (each gene on GRCh38 and GRCh37, 1 kb past its outermost key) | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&…` on the chromosome accession ClinVar names | NC_0000NN.* | 09:03:49 to 09:04:00 | per window in `manifest.json` |

ClinGen's download has no archive of past snapshots, so the pinned snapshot is
this file's SHA-256 and its "FILE CREATED" date. A later build that reads a
different snapshot records a different hash.

## Licences and attribution

- **ClinVar**: NCBI places no restriction on use or distribution and asks for
  attribution to ClinVar as a data source. See the ClinVar row of
  `docs/dataset-licenses.md`. Attribution: *ClinVar, National Center for
  Biotechnology Information, monthly release 2026-09.*
- **ClinGen**: curated content is released under CC0 1.0; ClinGen asks for
  attribution and the date accessed. Read on 28 September 2026 at
  `https://clinicalgenome.org/docs/terms-of-use/` (page SHA-256
  `5452384cd504bc24ddd0b4332822271edb3fc5801c1a9a1308bfb297174a58ae`).
  Attribution: *Gene-disease validity classifications from the Clinical Genome
  Resource (ClinGen), www.clinicalgenome.org, accessed 28 September 2026.*
- **NCBI reference sequence**: public NCBI molecular data under the same NCBI
  policy. Only the letters needed to check each key are used; no sequence file
  is committed.
- **ACMG practice resource**: cited, not copied. Only the gene symbols of its
  Tables 1 to 5 are read, to check that each starter gene is on them.

## The evidence bar, applied at import

The brief's rule (lines 1193 and 1452), chosen by the owner on 28 September:

1. ClinVar's germline classification is Pathogenic, Likely pathogenic or
   Pathogenic/Likely pathogenic (a trailing "drug response" or "other" term is
   allowed; any other trailing term is not).
2. The origin is germline.
3. No conflicting classification.
4. Two review stars or more, by ClinVar's own table of review statuses.
5. ClinVar names the condition's MONDO disease on the variant.
6. ClinGen rates the gene-disease link Definitive or Strong, for autosomal
   recessive inheritance.

The database reader applies the same rule again
(`private.carrier_assertion_rule_v1`), so nothing below it can be read even if
it were stored.

## Allele keys

- The key is GRCh38 chromosome, position, REF and ALT, in ClinVar's own
  VCF-style spelling (`PositionVCF`, `ReferenceAlleleVCF`,
  `AlternateAlleleVCF`). ClinVar's GRCh37 placement of the same allele is kept
  beside it as the evidence that ties the two builds together.
- Only single-letter changes and simple insertions or deletions that share
  exactly one anchor letter are keyed. They must be left-aligned; every one in
  this release is.
- Each key's reference letters were checked against the NCBI reference window
  on both builds; none disagreed.
- An insertion or deletion inside a repeat can be spelt several ways. The
  other GRCh38 spellings are listed with each key (601 assertions have at
  least one), so a file whose caller did not left-align still matches. For
  example, ClinVar keys CFTR c.1521_1523del (F508del) as
  `7:117559590 ATCT>A`, and the same change written `7:117559591 TCTT>T` is
  listed as its other spelling.

## Counts

| Condition | Gene | ClinVar GRCh38 rows read | Imported | Left out |
| --- | --- | ---: | ---: | --- |
| Cystic fibrosis (MONDO:0009061) | CFTR | 6,165 | 781 | 4,673 not pathogenic; 177 not germline; 505 below two stars; 17 condition not named; 1 no GRCh38 key; 11 not a simple change |
| Tay-Sachs disease (MONDO:0010100) | HEXA | 1,351 | 135 | 1,017 not pathogenic; 35 not germline; 164 below two stars |
| Phenylketonuria (MONDO:0009861) | PAH | 1,700 | 706 | 800 not pathogenic; 37 not germline; 151 below two stars; 1 no GRCh38 key; 5 not a simple change |
| MCAD deficiency (MONDO:0008721) | ACADM | 1,079 | 166 | 703 not pathogenic; 41 not germline; 167 below two stars; 2 not a simple change |
| Canavan disease (MONDO:0010079) | ASPA | 517 | 76 | 333 not pathogenic; 15 not germline; 92 below two stars; 1 not a simple change |
| Wilson disease (MONDO:0010200) | ATP7B | 3,692 | 386 | 2,852 not pathogenic; 99 not germline; 349 below two stars; 1 condition not named; 5 not a simple change |
| Smith-Lemli-Opitz syndrome (MONDO:0010035) | DHCR7 | 1,158 | 133 | 856 not pathogenic; 20 not germline; 147 below two stars; 2 not a simple change |
| Pompe disease (MONDO:0009290) | GAA | 3,622 | 467 | 2,767 not pathogenic; 53 not germline; 325 below two stars; 10 not a simple change |

"Not pathogenic" includes ClinVar's "Conflicting classifications of
pathogenicity", which is checked before the review status.

## Reproduce and check

```sh
# Offline: hashes, counts and every invariant of the committed files.
pnpm exec tsx scripts/build-carrier-assertions.ts --check

# From the official sources (a cache directory outside the checkout).
pnpm exec tsx scripts/build-carrier-assertions.ts --fetch /absolute/cache

# The guarded import statement and its dry run, for the integrator.
pnpm exec tsx scripts/build-carrier-assertions.ts --emit-sql /absolute/output
```

The unit tests (`scripts/build-carrier-assertions.test.ts`) run the importer
against 21 real lines of the same ClinVar release, three ClinGen curations and
two 101-base reference windows, in `scripts/fixtures/carrier/`.
