/** Generate the versioned seven-region table from fetched public cohort counts. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildReference, canonicalJson, REFERENCE_VERSION, REGION_CODES, SAMPLE_CAP, validateInputs } from "./seven-region-reference";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as unknown;
const sources = {
  markers: read("data/ref/aims.json"),
  frequencies: read("scripts/ancestry-resolution/hgdp-tgp-freqs.json"),
  populations: read("scripts/ancestry-resolution/hgdp-tgp-populations.json"),
};
const input = validateInputs(sources.markers, sources.frequencies, sources.populations);
const table = buildReference(input);
const json = JSON.stringify(table, null, 2) + "\n";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const manifest = {
  panelId: "aims-hgdp-tgp-168",
  referenceVersion: REFERENCE_VERSION,
  genomeBuild: "GRCh38",
  markerCount: table.length,
  populationCount: Object.keys(input.populations).length,
  referenceSampleCount: Object.values(input.populations).reduce((sum, p) => sum + p.samples, 0),
  frequency: "ALT allele copies / called allele copies, averaged across populations",
  populationWeight: `min(${SAMPLE_CAP}, called allele copies / 2), recomputed for each marker`,
  probabilityClipping: "None in this table. The estimator clips likelihood frequencies to [0.001, 0.999].",
  sourceRelease: "gnomAD v3.1.2 HGDP+1kGP",
  sourceVcfPattern: "https://storage.googleapis.com/gcp-public-data--gnomad/release/3.1.2/vcf/genomes/gnomad.genomes.v3.1.2.hgdp_tgp.chr{chrom}.vcf.bgz",
  sourceMetadataUrl: "https://storage.googleapis.com/gcp-public-data--gnomad/release/3.1.2/vcf/genomes/gnomad.genomes.v3.1.2.hgdp_1kg_subset_sample_meta.tsv.bgz",
  sourceCanonicalSha256: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, sha256(canonicalJson(value))])),
  markerSha256: sha256(JSON.stringify(table)),
  tableSha256: sha256(json),
  regions: REGION_CODES.map((region) => ({
    code: region,
    populationCount: Object.values(input.populations).filter((p) => p.region === region).length,
    referenceSampleCount: Object.values(input.populations).filter((p) => p.region === region).reduce((sum, p) => sum + p.samples, 0),
  })),
  provenance: "data/ref/AIMS_SEVEN_REGION_PROVENANCE.md",
  generator: "scripts/ancestry-resolution/generate-seven-region-reference.mts",
};
const outputs = [
  ["data/ref/aims-seven-region.json", json],
  ["data/ref/aims-seven-region-manifest.json", JSON.stringify(manifest, null, 2) + "\n"],
] as const;
if (process.argv.includes("--check")) {
  for (const [file, contents] of outputs) {
    if (fs.readFileSync(path.join(ROOT, file), "utf8") !== contents) throw new Error(`${file} differs from regenerated content`);
  }
  console.log(`Verified ${table.length} markers, seven regions, deterministic reference ${REFERENCE_VERSION}.`);
} else {
  for (const [file, contents] of outputs) fs.writeFileSync(path.join(ROOT, file), contents);
  console.log(`Generated ${table.length} markers from ${manifest.populationCount} public populations: ${manifest.tableSha256}`);
}
