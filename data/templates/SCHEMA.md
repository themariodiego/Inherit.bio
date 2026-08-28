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
    "evidence": "moderate",               // established | moderate | preliminary
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
      { "doi": "10.1093/aje/kwq162", "label": "…" }
    ]
  }
]
```

Rules (enforced by `scripts/validate-templates.ts` and CI):

- Every template carries ≥1 citation with a real PMID or DOI.
- `interpretations` covers all genotypes derivable from ref/alt (both
  homozygotes + heterozygote; for chrom 24/25 haploid calls use single-letter
  keys). Genotype keys use alphabetically sorted allele order.
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
`lifestyle-wellness`.
