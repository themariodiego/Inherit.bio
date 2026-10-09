import assert from "node:assert/strict";

/** Derive only from the committed two-sample synthetic VCF. The first sample
 * stays byte-identical; alternate calls of the second become explicit no-calls.
 * No parent, reference or sibling genotype is copied or estimated. */
export function mixedQcVcf(source: string): string {
  assert(source.includes("##source=Inherit deterministic synthetic fixture; no real person;"),
    "Only the committed synthetic embryo source is admitted");
  let records = 0;
  const lines = source.split("\n").map(line => {
    if (line.startsWith("#CHROM")) assert(line.split("\t").length === 11, "Exactly two synthetic samples required");
    if (!line || line.startsWith("#")) return line;
    const fields = line.split("\t");
    assert(fields.length === 11 && fields[8].split(":")[0] === "GT", "Closed synthetic call layout required");
    if (records++ % 2 === 0) {
      const sample = fields[10].split(":");
      sample[0] = "./."; fields[10] = sample.join(":");
    }
    return fields.join("\t");
  });
  assert(records > 1000, "The actual committed source must contain its complete measured call set");
  return lines.join("\n");
}
