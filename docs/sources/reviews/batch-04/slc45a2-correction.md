# SLC45A2 correction: agent implementation review

Status: implemented for independent review, not publication approval. Access date: 2026-09-06, after actual primary-source reading. No hosted changes.

Scope: only `data/templates/environmental-sensitivity.json`, object `skin-uv-sensitivity-slc45a2`, fields `summary`, `variants[0].interpretations.{CC,CG,GG}`, and `citations`. Report identity, title, GRCh38 locus, allele keys, evidence level and access rules remain unchanged.

## Primary evidence and exact claim bindings

- [Ensembl VEP, rs16891982](https://rest.ensembl.org/vep/human/id/rs16891982?content-type=application/json), read 2026-09-06 at 01:21:09 UTC: GRCh38 chromosome 5 position 33951588; forward C/A/G; negative-strand transcript ENST00000296589; alternate G maps L/F at protein position 374. This supports the existing C/Leu and G/Phe binding, not changing reference and alternate to repair the reversed prose. The additional A allele is outside this template's existing C/G scope.
- [Le et al. 2020, PMID 32966160](https://pubmed.ncbi.nlm.nih.gov/32966160/), [primary full paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC7927184/), DOI 10.1091/mbc.E20-03-0200. Read Introduction, allele-specific Results, Figures 7–8 and Discussion on 2026-09-06. These support the corrected lighter/darker direction in the summary and CC/GG interpretations and the new third citation context. The cell comparison is not an observed human genotype gradient. Population-frequency claims were removed instead of using a single result to infer ancestry.
- [Han et al. 2008, PMID 18483556](https://pubmed.ncbi.nlm.nih.gov/18483556/), [primary full paper](https://journals.plos.org/plosgenetics/article?id=10.1371/journal.pgen.1000074), DOI 10.1371/journal.pgen.1000074. Abstract read 2026-09-06 at 01:20:20 UTC; relevant full Results and Methods also read that day. The SLC45A2/MATP paragraph supports associations with hair color, skin color and tanning after adjustment for three other same-gene sites (rs28777, rs26722 and rs13289). The site's analysis uses skin-cancer controls; the larger European-ancestry US/Australia study size is not attributed to this subanalysis. This is distinct from the paper's IRF4 finding. No direction is inferred from that IRF4 result.
- [Hernando et al. 2018, PMID 29974532](https://pubmed.ncbi.nlm.nih.gov/29974532/), DOI 10.1111/phpp.12412. Complete abstract read 2026-09-06 at 01:20:52 UTC. Methods and Results support the 456-person Spanish questionnaire study and association at this site. The abstract does not provide the C/G contrast; no genotype-specific sun-sensitivity direction is claimed from it. Full genotype tables were not verified.

No new publication quotations are reproduced here; existing batch receipts retain their bounded excerpts. The correction is original paraphrase. Neither a heterozygote midpoint, a personal skin-color prediction, inferred ancestry, a UV-tolerance threshold nor a clinical conclusion is established. Limitation locators explicitly distinguish study scope from a paper's own measured result.

## Regression evidence

`src/lib/genome/slc45a2-study-scope.test.ts` pins all three letter/protein mappings and corrected pigment directions, rejects the old population assertions, preserves no-call behavior, and checks each source context through seed serialization and the real citation renderer. These tests prevent editorial regression; they do not independently verify science.

Local verification on 2026-09-06: 38 tests passed across this new test, `study-context.test.ts` and `behavior-study-scope.test.ts`; the template gate passed all 162 seeds; the readability gate and scoped ESLint passed. A comparison against HEAD confirmed all 10 other objects in the edited JSON file unchanged. No browser, database or hosted writes were performed. Whole-catalog acceptance remains separate.
