# Report template seed format

Each file in this directory is `<category-slug>.json`: an array of report
templates seeded into `public.report_templates`.

```jsonc
[
  {
    "slug": "caffeine-metabolism-cyp1a2", // unique, kebab-case
    "category": "lifestyle-wellness",     // one of the category slugs below
    "title": "Caffeine metabolism · CYP1A2",
    "summary": "Plain-language effect summary (1-3 sentences).",
    "evidence": "emerging",               // clinical | established | emerging | preliminary | insufficient
    "layer": "estimate",                  // optional: variant_call | estimate (default estimate)
    "estimate_kind": "single_locus",      // optional: single_locus | polygenic_score (default from pgs_id)
    "variants": [
      {
        "rsid": 762551,                    // numeric rsID
        "gene": "CYP1A2",
        "chrom": 15,                       // 1-22, 23=X, 24=Y, 25=MT
        "pos38": 74749576,                 // GRCh38 position
        "ref": "A",                        // reference allele (GRCh38)
        "alt": "C",
        "interpretations": {
          // Keyed by sorted genotype; every possible genotype MUST be present.
          "AA": "Faster caffeine metabolizer …",
          "AC": "Intermediate …",
          "CC": "Slower caffeine metabolizer …"
        }
      }
    ],
    "pgs_id": null,                        // set instead of variants for PRS templates
    "citations": [
      { "pmid": "16522833", "label": "Cornelis et al., JAMA 2006" },
      { "doi": "10.1093/aje/kwq162", "label": "…" },
      // optional ISO date the source was read (required on Medicines templates)
      { "pmid": "28198005", "label": "…", "accessedOn": "2026-09-03" }
    ],
    // optional seed-file provenance, one entry per outside source the facts
    // were read from; validated, not seeded into the database
    "source": {
      "guideline": { "name": "CPIC", "licence": "CC0 1.0, attribution requested", "url": "https://…", "accessedOn": "2026-09-03" }
    }
  }
]
```

Rules (enforced by `scripts/validate-templates.ts` and CI):

- Every template carries ≥1 citation with a real PMID or DOI.
- `evidence` is one of the five rubric levels: `clinical`, `established`,
  `emerging`, `preliminary`, `insufficient`. Seeds are always published and an
  `insufficient` template is never published, so the gate rejects it in seed
  files. (The pre-rubric values `established` and `moderate` were both
  re-mapped to `emerging`; `clinical` and `established` are reachable only by
  review.)
- `layer` and `estimate_kind` are derived at seed time when absent:
  `layer = "estimate"`, `estimate_kind = pgs_id ? "polygenic_score" :
  "single_locus"`. They may be set explicitly. The gate mirrors the database
  checks: an `estimate` needs a known `estimate_kind`; a `variant_call` needs
  `variants` and no `pgs_id`; a `polygenic_score` needs a `pgs_id` and cannot
  ship at `preliminary` or `insufficient`.
- Every slug resolves to one of the nine user-facing categories via
  `categoryFor` in `src/lib/genome/taxonomy.ts` (per-slug exceptions first,
  then the per-category default).
- `interpretations` covers all genotypes derivable from ref/alt (both
  homozygotes + heterozygote; for chrom 24/25 haploid calls use single-letter
  keys). Genotype keys use alphabetically sorted allele order.
- A citation may carry `accessedOn`, an ISO date (`YYYY-MM-DD`) on which the
  cited source was read. A template may carry `source`: an object whose
  entries each name an outside source (`name`), its `url` (https), the
  `accessedOn` date and optionally its `licence`. `source` is validated and
  stays in the seed file; `scripts/seed.ts` does not store it.
- Medicines templates (`category: "pharmacogenomics"`, ADR 0021) are
  `layer: "variant_call"` with `estimate_kind: null`, carry `accessedOn` on
  every citation and a `source` object, and pass the Medicines-only rows of
  `MEDICINES_BANNED_PATTERNS`: no metabolizer phenotype, no response language,
  no dose direction and no drug choice. They say which letters the file shows
  at one position a prescribing guideline names, which named forms carry that
  letter, and what the position cannot tell the reader.
- No diagnostic or medical-advice language: reports describe association and
  effect size in plain terms and always in an informational register.
- Coverage honesty is handled by the renderer: when a user's file lacks the
  variant, the report shows "your file does not cover this variant" — the
  template does not need to encode it.

Category slugs (≥12 required at launch):
`heart-cardiovascular`, `cancer-risk`, `brain-health`, `neurodegenerative`,
`autoimmune`, `mental-health`, `longevity`, `metabolic-obesity`,
`gastrointestinal`, `environmental-sensitivity`, `addiction`,
`reproductive-family`, `aesthetic-cosmetic`, `basic-traits`,
`lifestyle-wellness`, `pharmacogenomics` (the Medicines category, ADR 0021).
