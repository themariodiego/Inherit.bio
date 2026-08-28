# Haplogroup defining-marker seed data

Curated 2026-08-28. Breadth over depth: macro-haplogroups and major branches
only, 1-6 defining markers per node. Consumed by
`src/lib/genome/haplogroups.ts` (`classify`).

Encoding (both files): array of `{haplogroup, parent, lineage, markers}`.
`parent: null` marks a walk root. Markers are `{pos, anc, der}` (plus
`name`/`rsid` for Y). `der` is the base a sample carries when it belongs to
the branch; `anc` the base it carries when it does not.

## mtdna.json (chrom 25; rCRS == GRCh38 chrMT, 16569 bp)

- Topology and defining positions taken from PhyloTree Build 17
  (van Oven & Kayser, mtDNA tree Build 17, https://www.phylotree.org/), read
  from the machine-readable copy shipped with HaploGrep:
  https://github.com/seppinho/haplogrep-cmd
  (`data/phylotree/phylotree17_FU1a.xml`, Phylotree 17 Forensic Update 1a,
  which is rCRS-rooted; on-path edges were re-oriented to the true
  RSRS-rooted direction as described below). Classic markers cross-checked
  against HaploGrep documentation (https://haplogrep.readthedocs.io/).
- Every marker was verified against the GRCh38 chrMT sequence fetched from
  Ensembl REST (`/sequence/region/human/MT:1..16569`, 2026-08-28): for
  ordinary markers `anc` equals the rCRS base; for nodes on the rCRS lineage
  path (L3, N, R, HV, H — rCRS itself is H2a2a1) `der` equals the rCRS base
  and `anc` is the pre-mutation base from PhyloTree (e.g. N is defined by
  G8701A, C9540T, C10873T; rCRS carries the derived state).
- Deliberate simplifications (intermediate PhyloTree nodes elided; the elided
  node's markers folded into the child where useful):
  - L0, L1, L2, L4, L5 are roots (L backbone nodes L1'2'3'4'5'6 etc. elided);
    L3 is also a root and the parent of M and N.
  - C, Z (parent M; M8/CZ elided), D (M80'D elided), E (M9 elided),
    G (M12'G elided), Q (M29'Q elided).
  - I (N1a1b chain elided), W (N2 elided), Y (N9 elided; N9's 5417A folded
    in), X, A, R under N.
  - HV under R (R0 elided; R0's 73A folded in), V under HV (HV0/HV0a elided;
    HV0's 72C/16298C folded in), H under HV, H1 under H.
  - J and T directly under R (JT elided; JT's 11251G folded into both),
    F under R (R9 elided; R9's 3970T/13928C folded in), P under R
    (single defining marker 15607G in Build 17 — weak by nature),
    B = B4'5 under R: defined in PhyloTree solely by the 8281-8289 9-bp
    deletion, encoded here as pos 8281 der "-" (matches only if the caller's
    getBase reports deletions as "-"), plus 16217C which marks the common
    B4 branch.
  - U under R, U5 under U, K under U (U8b'c/U8b elided; U8b's 9055A folded
    in), K1 under K.
  - Hypervariable-region and homoplasic positions were avoided where a
    coding-region alternative existed; insertions (e.g. 459.1C, 249d) were
    excluded.

## y.json (chrom 24; GRCh38 positions)

- Marker names, haplogroup assignments, mutations, and rsIDs taken from the
  ISOGG 2016 SNP index as shipped with 23andMe's yhaplo
  (https://github.com/23andMe/yhaplo,
  `yhaplo/data/variants/isogg.2016.01.04.txt`); see also
  https://isogg.org/tree/ and https://ybrowse.org/.
- GRCh38 positions and alleles for all 31 markers were fetched from Ensembl
  REST on 2026-08-28 (batch `POST /variation/homo_sapiens` with the rsIDs);
  every marker mapped to chromosome Y and its Ensembl allele string contains
  both the ISOGG ancestral and derived alleles. Note GRCh38's chrY is an
  R1b individual, so for R/R1b markers the reference base is the derived
  allele.
- Deliberate simplifications:
  - Major branches are walk roots (parent null); the Y backbone (BT, CT, CF,
    F, K, NO, P, ...) is not encoded.
  - "A" is encoded via L419 (ISOGG A1b1), the clade containing most extant
    haplogroup-A lineages. A1-level SNPs (P305, V168) were rejected because
    A1 contains BT, i.e. every non-African-root lineage.
  - B via M181 (M60 is an indel, skipped). O via P186/P191/P196 (M175 is a
    5-bp deletion, skipped). R1a includes M198 (ISOGG R1a1a); R1b includes
    M269 (ISOGG R1b1a2, the dominant R1b branch). H via M69 (ISOGG 2016
    labels it H1; classically haplogroup H). E1b1a via M2 (ISOGG E1b1a1),
    E1b1b via M215 + M35.1 (ISOGG E1b1b1). Indel markers (M17, M91) were
    skipped in favor of SNPs.

## Terms

- PhyloTree: free for academic/non-commercial use with citation
  (van Oven M, Kayser M. 2009. Hum Mutat 30:E386-E394).
- ISOGG tree/SNP index: publicly available, citation requested.
- yhaplo data files: MIT-licensed repository. HaploGrep phylotree XML:
  MIT-licensed repository.
- Ensembl data: open access without restriction
  (https://www.ensembl.org/info/about/legal/disclaimer.html).
