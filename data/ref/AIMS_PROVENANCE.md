# AIMs panel provenance (`aims.json`)

Built: 2026-08-28

## What this is

168 autosomal ancestry-informative SNPs (AIMs) used by
`src/lib/genome/admixture.ts` for continental admixture estimation. The panel
is the union (deduplicated) of two published, freely usable AISNP marker
lists:

- **Kidd lab 55 AISNP panel** — Kidd KK, Speed WC, Pakstis AJ, et al.
  "Progress toward an efficient panel of SNPs for ancestry inference."
  *Forensic Sci Int Genet* 2014;10:23-32. doi:10.1016/j.fsigen.2014.01.002
- **Seldin 128 AISNP panel** — Kosoy R, Nassir R, Tian C, ... Seldin MF.
  "Ancestry informative marker sets for determining continental origin and
  admixture proportions in common populations in America."
  *Hum Mutat* 2009;30(1):69-78. doi:10.1002/humu.20822

## Method

1. **Marker list.** The combined, deduplicated list of the two panels
   (55 + 128 - 13 shared = 170 rsIDs, with per-SNP panel membership) was taken
   from Supplementary Table S3 of Pakstis AJ, et al. "Population relationships
   based on 170 ancestry SNPs from the combined Kidd and Seldin panels."
   *Sci Rep* 2019;9:18874. doi:10.1038/s41598-019-55175-x (open access,
   CC BY 4.0; file `41598_2019_55175_MOESM2_ESM.xlsx` retrieved via the
   Europe PMC supplementary-files API for PMC6906462 on 2026-08-28).
   Membership in that table: 42 Kidd-only + 115 Seldin-only + 13 shared.
2. **Coordinates, alleles, frequencies.** Every rsID was queried against the
   Ensembl REST API (`https://rest.ensembl.org/variation/human/<rsid>?pops=1`)
   on 2026-08-28. From each response:
   - `chrom`/`pos38`/`ref`: the unique GRCh38 chromosome mapping
     (`assembly_name == "GRCh38"`, `coord_system == "chromosome"`); `ref` is
     the first allele of `allele_string` (the reference-genome allele,
     forward strand).
   - `alt`: the unique non-reference single-base allele observed in the
     1000 Genomes phase-3 superpopulation entries (dbSNP's `allele_string`
     often lists additional rare alleles never seen in 1000 Genomes; those are
     ignored).
   - `freqs`: **ALT-allele** frequencies from the population entries named
     `1000GENOMES:phase_3:AFR|AMR|EAS|EUR|SAS`; where only the REF entry was
     reported for a superpopulation, ALT freq = 1 - REF freq.
3. **Drops.** A marker was dropped unless it had exactly one GRCh38 chromosome
   mapping, a single-base REF, exactly one observed 1000G ALT allele, and a
   frequency for all five superpopulations. 2 of 170 were dropped:
   - `rs10954737` (Seldin): no 1000 Genomes phase-3 population entries in
     Ensembl.
   - `rs1871534` (Kidd): only the reference allele is reported in 1000
     Genomes phase-3 entries (the polymorphism there is an indel).

## Schema

```
[{ rsid, chrom (1-22), pos38 (GRCh38), ref, alt,
   freqs: { AFR, AMR, EAS, EUR, SAS } }]  // freqs are ALT-allele frequencies
```

## Licensing notes

Both AISNP panels are published marker lists in the open literature. The
1000 Genomes Project phase-3 frequency data are open access (Fort
Lauderdale/Toronto principles), retrieved via Ensembl REST, which serves them
without restriction. The combined 170-SNP table comes from a CC BY 4.0
publication (cited above).
