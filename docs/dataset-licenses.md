# Dataset license audit

Every public dataset Inherit stores, serves derived annotations from, or
ships seed data of — each verified against the source's own terms on
**2026-08-28**. Rule: no non-commercial-licensed source may enter the
reference store or seed data.

| Dataset | License / terms | Verdict | Source |
| --- | --- | --- | --- |
| ClinVar (NCBI) | No formal license; NCBI places no restrictions on use or distribution; attribution requested ("provide attribution to ClinVar as a data source"). US-government-authored content is public domain; submitter records carry no rights transfer, so NCBI grants no affirmative license. | **Use, with attribution** | [ClinVar maintenance & use](https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/), [NCBI policies](https://www.ncbi.nlm.nih.gov/home/about/policies/) |
| dbSNP (NCBI) | Same NCBI policy: no NCBI-imposed restrictions; no affirmative grant; rare submitter claims possible. Inherit stores only rsID↔position/allele mappings (facts). | **Use, with attribution** | [NCBI policies](https://www.ncbi.nlm.nih.gov/home/about/policies/) |
| gnomAD (Broad) | **CC0 1.0** for primary exome/genome data ("free of restrictions"). Caveat: bundled third-party annotation fields inside gnomAD releases may carry their own licenses — Inherit stores only allele frequencies (primary data). | **Use** (attribution as courtesy) | [gnomAD policies](https://gnomad.broadinstitute.org/policies) |
| GWAS Catalog (NHGRI-EBI) | EMBL-EBI Terms of Use — open, no added restrictions, attribution expected; summary statistics CC0 unless stated. | **Use, with attribution** | [EMBL-EBI terms](https://www.ebi.ac.uk/about/terms-of-use/) |
| PGS Catalog (EMBL-EBI) | **Not blanket CC BY 4.0** (a common misreading): default is EMBL-EBI Terms of Use (open, attribution expected), but individual scores may carry their own licenses, including non-commercial ones, recorded per score. **Inherit policy: check the per-score `license` field before seeding; only default-terms or CC-BY-class scores ship.** Each seed in `data/prs/` records its checked license. | **Use per-score, license checked each** | [PGS Catalog FAQ](https://www.pgscatalog.org/docs/faq/), [EMBL-EBI terms](https://www.ebi.ac.uk/about/terms-of-use/) |
| 1000 Genomes (IGSR) | Open access without embargo since final publications (2015); Fort Lauderdale expectations no longer bind; EMBL-EBI Terms of Use apply to the services. Newer IGSR-hosted collections can differ — Inherit uses only phase-3 population frequencies. | **Use, with attribution** | [IGSR disclaimer](https://www.internationalgenome.org/IGSR_disclaimer), [phase 3 sample panel](https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/release/20130502/integrated_call_samples_v3.20130502.ALL.panel) (population sizes for `data/ref/regions/`) |
| Natural Earth 1:110m physical (land, geography regions) | **Public domain** — Natural Earth terms of use: all versions of its raster and vector data are in the public domain, usable in any manner including modification and commercial use; no permission needed, credit invited. Verified 2026-09-03. Inherit reads only the physical land and named-feature layers to build `public/geo/regions.topo.json`; no administrative layer is read. | **Use** (attribution as courtesy) | [Natural Earth terms of use](https://www.naturalearthdata.com/about/terms-of-use/), [LICENSE.md in the vector repository](https://github.com/nvkelso/natural-earth-vector/blob/master/LICENSE.md) |
| GIAB / NIST HG001 benchmark | U.S. government work, public data (NIST Genome in a Bottle). Shipped as the repo's VCF sample with provenance. | **Use** | [NIST GIAB](https://www.nist.gov/programs-projects/genome-bottle) |
| Ensembl (REST, assembly chain files) | Ensembl data is unrestricted/open (EMBL-EBI); the GRCh37→GRCh38 chain file ships in `data/ref/chain/` with provenance. | **Use, with attribution** | [Ensembl legal](https://www.ensembl.org/info/about/legal/index.html) |
| **SNPedia** | **CC BY-NC-SA 3.0** — non-commercial, share-alike. Incompatible with an AGPL platform serving arbitrary deployments (including commercial self-hosts). | **EXCLUDED — nothing from SNPedia may be ingested, seeded, or scraped** | [SNPedia copyrights](https://www.snpedia.com/index.php/SNPedia:Copyrights) |

Report-template citations reference the primary literature directly
(PubMed/DOI), not aggregator databases, so no template content derives from
SNPedia.

Attribution lives on the About page ("Data sources") and in report/source
footers where the relevant dataset's values render.
