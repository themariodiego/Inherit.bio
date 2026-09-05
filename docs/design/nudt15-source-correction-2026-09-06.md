# NUDT15 source correction — 2026-09-06

This dated correction supersedes the earlier research/ADR wording that NUDT15
*3 requires a second change. The historical notes remain visible and point here.
The correction changes no dose, phenotype, clinical action, evidence label or
report eligibility. It preserves the useful reading of C/T at rs116855232 and
does not identify a reader's *3 allele or pair of gene forms.

## Exact primary-source check

The [compact source receipt](./nudt15-source-receipt-2026-09-06.json) records
selected fields from CPIC's live API, read on 2026-09-06 Europe/Copenhagen
(2026-09-05 UTC). These are CPIC curated facts, CC0; no individual data or
external interpretation corpus is included. CPIC content is subject to updates;
confirm the current content at ClinPGx before reuse.

| Definition | ID / record version | rs116855232, location 779060 | rs746071566, location 949529 |
| --- | --- | --- | --- |
| *1, reference sequence | 779064 / 187 | C | `GAGTCG(3)` |
| *3 | 779068 / 187 | T | `GAGTCG(3) or GAGTCG(4)` |
| *2 | 8361554 / 1 | No location-value rows returned | No location-value rows returned |

Sources: [allele definitions](https://api.cpicpgx.org/v1/allele_definition?genesymbol=eq.NUDT15),
[*1 values](https://api.cpicpgx.org/v1/allele_location_value?alleledefinitionid=eq.779064),
[*3 values](https://api.cpicpgx.org/v1/allele_location_value?alleledefinitionid=eq.779068),
[*2 values](https://api.cpicpgx.org/v1/allele_location_value?alleledefinitionid=eq.8361554),
and [sequence locations](https://api.cpicpgx.org/v1/sequence_location?genesymbol=eq.NUDT15).

The *3 allowed repeat states include the same three-repeat state as reference
*1. Therefore a second **change** is not required. The earlier pass mistook a
second defining position for a required non-reference state. A sparse definition
row count is not a count of changes. The empty current *2 location response does
not establish its sequence, deletion, equivalence to another allele or phenotype;
none is filled in from historical assumptions.

The template summary and CT/TT readings now say that T occurs in CPIC's *3
definition, while the other positions and the pair of forms are not read here.
The CC reading and exact GRCh38 locus/alleles remain unchanged. No repeat reader,
haplotype caller, missing-position inference or additional user gate is added.

## Version correction

The API exposes per-record versions: *1/*3 definition 187, current *2 definition
1, the four recorded location-value rows 1, and sequence locations 107 and 99.
These are not one unified content version. The earlier blanket statement that
the endpoint exposed no version number is not supported by this reread.
All eleven seed-only CPIC version notes now distinguish the unrecorded unified
version from exposed per-record versions. The other ten templates' report copy
and every original guideline citation/access date are unchanged. The original
2026-09-03 provenance dates are not silently replaced; this fresh allele check
and its actual record versions are separately dated above.

## Regression and publication

The regression reads the receipt, proves that *3 permits the reference repeat
state, binds the two locations and their actual values, and rejects the old
second-change prose in every NUDT15 report field. It also pins missing *2 values
as unknown and distinguishes record versions from a unified version.

Publication of the eleven-template set remains a separate reviewed rollout;
this correction itself does not seed local or hosted databases. A rollout
prepared from the old source hash must not be used after this correction.
