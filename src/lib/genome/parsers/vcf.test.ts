import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toLines } from "./lines";
import { parseVcf, streamVcf } from "./vcf";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function* fromString(text: string): AsyncIterable<string> {
  for (const line of text.split("\n")) yield line;
}

const HEADER =
  "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tS1\n";

describe("parseVcf: fixture", () => {
  it("parses sample.vcf", async () => {
    const result = await parseVcf(toLines(createReadStream(fixture("sample.vcf"))));
    expect(result.build).toBe("GRCh38");
    expect(result.skipped).toBe(1); // the ./. row
    expect(result.records).toEqual([
      { rsid: 1, chrom: 1, pos: 100, ref: "A", alt: "G", genotype: "A/G" },
      // multiallelic 1/2: only GT-referenced alts, sorted genotype
      { rsid: 2, chrom: 1, pos: 200, ref: "C", alt: "T,G", genotype: "G/T" },
      { rsid: null, chrom: 1, pos: 300, ref: "G", alt: "A", genotype: "A/A" },
      // haploid GT 1 on Y
      { rsid: 6, chrom: 24, pos: 600, ref: "C", alt: "T", genotype: "T" },
      // rs5 (0/0) and rs7 (haploid 0) are reference rows: not variants, not counted
    ]);
    // ...but kept as reference calls, with the reference allele each carries (D-040).
    expect(result.referenceCalls).toEqual([
      { chrom: 1, pos: 500, genotype: "A/A", ref: "A" },
      { chrom: 25, pos: 700, genotype: "A", ref: "A" },
    ]);
  });

  it("parses sample.g.vcf, skipping reference blocks", async () => {
    const result = await parseVcf(
      toLines(createReadStream(fixture("sample.g.vcf")))
    );
    expect(result.build).toBe("GRCh37"); // contig ID=1 length pins build 37
    expect(result.skipped).toBe(1); // the ./. block row
    expect(result.records).toEqual([
      { rsid: 10, chrom: 1, pos: 300, ref: "G", alt: "A", genotype: "A/G" },
      // indel alt with trailing <NON_REF>, 1/1
      { rsid: 11, chrom: 1, pos: 500, ref: "C", alt: "CT", genotype: "CT/CT" },
    ]);
  });
});

describe("parseVcf: build detection", () => {
  it.each([
    "##reference=GRCh380",
    "##reference=GRCh38\n##reference=GRCh37",
    "##reference=GRCh37\n##reference=GRCh38",
    "##reference=custom.fa\n##reference=GRCh38",
    "##reference=GRCh38\n##contig=<ID=1,length=249250621>",
    "##contig=<ID=1,length=248956422>\n##reference=GRCh37",
    "##contig=<ID=1,length=248956422,assembly=GRCh37>",
    "##contig=<ID=1,length=248956422,assembly=whoknows>",
  ])("keeps unsupported or conflicting build claims unknown: %s", async (header) => {
    expect((await parseVcf(fromString(header))).build).toBe("unknown");
  });
  it("reads ##reference for GRCh37 spellings", async () => {
    for (const ref of ["GRCh37", "hg19", "b37"]) {
      const r = await parseVcf(
        fromString(`##fileformat=VCFv4.2\n##reference=${ref}.fa\n`)
      );
      expect(r.build).toBe("GRCh37");
    }
  });

  it("reads chr-prefixed contig lengths", async () => {
    const r38 = await parseVcf(
      fromString("##contig=<ID=chr1,length=248956422,assembly=GRCh38>\n")
    );
    expect(r38.build).toBe("GRCh38");
    const r37 = await parseVcf(
      fromString("##contig=<ID=chr1,length=249250621>\n")
    );
    expect(r37.build).toBe("GRCh37");
  });

  it("ignores non-chr1 contigs and returns unknown when undetectable", async () => {
    const r = await parseVcf(
      fromString("##contig=<ID=chr11,length=135086622>\n##reference=custom.fa\n")
    );
    expect(r.build).toBe("unknown");
  });
});

describe("parseVcf: rows", () => {
  it("reads GT from FORMAT position, not first field", async () => {
    const r = await parseVcf(
      fromString(HEADER + "1\t10\trs9\tA\tC\t.\t.\t.\tDP:GT\t30:0|1\n")
    );
    expect(r.records).toEqual([
      { rsid: 9, chrom: 1, pos: 10, ref: "A", alt: "C", genotype: "A/C" },
    ]);
  });

  it("counts missing GT sub-field and missing FORMAT GT as skipped", async () => {
    const r = await parseVcf(
      fromString(
        HEADER + "1\t10\t.\tA\tC\t.\t.\t.\tDP\t30\n1\t20\t.\tA\tC\t.\t.\t.\tGT\t.\n"
      )
    );
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toBe(2);
  });

  it("skips scaffolds and rows without a sample column", async () => {
    const r = await parseVcf(
      fromString(
        HEADER +
          "chrUn_gl000220\t10\t.\tA\tC\t.\t.\t.\tGT\t0/1\n1\t10\t.\tA\tC\t.\t.\t.\n"
      )
    );
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toBe(2);
  });

  it("keeps hom-ref rows as reference calls, never as variants, and drops <NON_REF>-only rows without counting", async () => {
    const r = await parseVcf(
      fromString(
        HEADER +
          "1\t10\t.\tA\t<NON_REF>\t.\t.\t.\tGT\t0/0\n1\t20\t.\tA\tC\t.\t.\t.\tGT\t0/0\n"
      )
    );
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toBe(0);
    // The 0/0 row against a real ALT is a reference call (D-040); the
    // <NON_REF>-only row describes a block, not a call.
    expect(r.referenceCalls).toEqual([{ chrom: 1, pos: 20, genotype: "A/A", ref: "A" }]);
  });

  it("skips GT indexes past the ALT list as malformed", async () => {
    const r = await parseVcf(
      fromString(HEADER + "1\t10\t.\tA\tC\t.\t.\t.\tGT\t0/2\n")
    );
    expect(r.records).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });
});

describe("streamVcf: bounded incremental consumption", () => {
  const called = "1\t10\trs9\tA\tC\t50\tPASS\t.\tGT\t0/1";

  it("emits both observations and variants without reading the next line ahead", async () => {
    let read = 0;
    let closed = false;
    async function* input() {
      try {
        for (const line of (HEADER + called + "\n" + called).split("\n")) {
          read++;
          yield line;
        }
      } finally { closed = true; }
    }
    const stream = streamVcf(input());
    expect(await stream.next()).toMatchObject({ done: false, value: { type: "observed", line: 3, call: { genotype: "A/C", usable: true } } });
    expect(read).toBe(3);
    expect(await stream.next()).toMatchObject({ done: false, value: { type: "variant", line: 3, record: { genotype: "A/C" } } });
    expect(read).toBe(3);
    await stream.return();
    expect(closed).toBe(true);
    expect(read).toBe(3);
    expect(await stream.next()).toEqual({ done: true, value: undefined });
  });

  it("keeps conflicting same-position calls separate and counts emitted events", async () => {
    const events = [];
    const rows = [called, called.replace("0/1", "1/1"), called.replace("0/1", "0/0"),
      called.replace("0/1", "./."), "1\t11\t.\tA\t<NON_REF>\t.\t.\tEND=20\tGT\t0/0"];
    for await (const event of streamVcf(fromString(HEADER + rows.join("\n")))) events.push(event);
    expect(events.filter(event => event.type === "observed").map(event => event.call.genotype)).toEqual(["A/C", "C/C", "A/A", "--"]);
    expect(events.filter(event => event.type === "variant").map(event => event.record.genotype)).toEqual(["A/C", "C/C"]);
    expect(events.filter(event => event.type === "reference").map(event => event.call.genotype)).toEqual(["A/A"]);
    expect(events.at(-1)).toEqual({ type: "summary", build: "unknown", skipped: 1,
      variantCount: 2, referenceCallCount: 1, observedCallCount: 4, observedCallsValid: true });
  });

  it("invalidates provisional observations on a late duplicate sample header", async () => {
    const text = HEADER + called + "\n" + HEADER + called;
    const events = [];
    for await (const event of streamVcf(fromString(text))) events.push(event);
    expect(events.filter(event => event.type === "observed")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "summary", observedCallCount: 1, observedCallsValid: false, variantCount: 2 });
    const collected = await parseVcf(fromString(text));
    expect(collected.observedCalls).toEqual([]);
    expect(collected.records).toHaveLength(2);
  });

  it("resolves late build conflicts only in the terminal summary", async () => {
    const events = [];
    for await (const event of streamVcf(fromString("##reference=GRCh38\n" + HEADER + called + "\n##reference=GRCh37"))) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "summary", build: "unknown" });
    expect(events.slice(0, -1).every(event => !("build" in event))).toBe(true);
  });

  it("propagates source failures without a publishable summary and closes input", async () => {
    let closed = false;
    const failure = new Error("synthetic input interrupted");
    async function* input() {
      try { yield* (HEADER + called).split("\n"); throw failure; }
      finally { closed = true; }
    }
    const types: string[] = [];
    await expect((async () => {
      for await (const event of streamVcf(input())) types.push(event.type);
    })()).rejects.toBe(failure);
    expect(types).toEqual(["observed", "variant"]);
    expect(closed).toBe(true);
  });

  it("consumes a generated distinct-row source with only incremental counters", async () => {
    const count = 20_000;
    async function* input() {
      yield* HEADER.trimEnd().split("\n");
      for (let i = 1; i <= count; i++) yield `1\t${i}\trs${i}\tA\tC\t50\tPASS\t.\tGT\t0/1`;
    }
    let variants = 0;
    let observed = 0;
    let summaries = 0;
    for await (const event of streamVcf(input())) {
      if (event.type === "variant") { variants++; expect(event.record.pos).toBe(variants); }
      if (event.type === "observed") observed++;
      if (event.type === "summary") {
        summaries++;
        expect(event).toMatchObject({ variantCount: count, observedCallCount: count, referenceCallCount: 0, skipped: 0 });
      }
    }
    expect({ variants, observed, summaries }).toEqual({ variants: count, observed: count, summaries: 1 });
  });
});
