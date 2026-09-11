// Generates e2e/fixtures/lineage-grch38.vcf: a synthetic single-sample GRCh38
// VCF that yields a real, deterministic haplogroup call on BOTH parent lines,
// so the populated lineage card (haplogroup, path, matched-of-tested markers,
// tree + version, no-range statement, resolution limit — G4.4) becomes
// reachable instead of only unit-tested.
//
//   pnpm exec tsx e2e/fixtures/generate-lineage-vcf.ts
//
// It describes no real person. Every position and every allele below is
// copied verbatim out of the shipped defining-marker trees
// (data/ref/haplogroups/mtdna.json, y.json; provenance in the PROVENANCE.md
// beside them). Nothing here was read from anyone and nothing was invented:
// the generator never writes a literal coordinate or base of its own, it only
// selects which of each marker's two tree alleles the synthetic sample
// carries.
//
// ---------------------------------------------------------------------------
// What `classify` (src/lib/genome/haplogroups.ts) actually decides on
// ---------------------------------------------------------------------------
// 1. `getBase(chrom, pos)` returns the sample's base at a marker, or null when
//    the position is not covered. A null is *not* evidence of anything.
// 2. The walk starts at the roots (`parent: null`). At a node it counts, over
//    that node's own markers, `tested` (a base was returned) and `matched`
//    (that base equals `der`). A node with `matched < 1` is abandoned and its
//    whole subtree with it — so a branch is entered only on positive derived
//    evidence, never on absence, and a covered-but-ancestral marker actively
//    keeps the walk out.
// 3. Every node it does enter becomes a candidate carrying the cumulative
//    matched/tested of the root-to-here path.
// 4. The winner is the DEEPEST candidate (longest path). Ties break on
//    matched/tested ratio, then on matched count.
// 5. `covered` is counted separately: distinct marker positions anywhere in
//    the tree that returned a base, whether or not the walk reached them.
//    Fewer than 3 forces support "insufficient"; otherwise support is
//    "strong" when matched >= 3 and ratio >= 0.8, else "partial".
// 6. For Y only, a sample with no covered Y marker at all short-circuits to
//    haplogroup null with the "female, or Y not covered" note.
//
// ---------------------------------------------------------------------------
// Why every row here is a called variant, and not a `0/0` row
// ---------------------------------------------------------------------------
// The process route feeds `classify` from `parsed.records` only, and the VCF
// parser puts homozygous-reference rows in `referenceCalls`, never in
// `records` (src/lib/genome/parsers/vcf.ts). So a marker at which the sample
// matches the file's REF is invisible to the classifier — it is not "tested
// ancestral", it is not tested at all.
//
// This fixture is therefore not "a person aligned to GRCh38"; it is a marker
// panel readout. Each row states, at one defining-marker position, which of
// that marker's two tree alleles the synthetic sample carries: the carried
// allele is ALT with a haploid `GT 1`, and REF is set to the marker's other
// tree allele purely so the row survives the parser as a variant record. Both
// letters on every row are the tree's own `anc`/`der` for that position; the
// REF column carries no claim about the real GRCh38 reference base and must
// not be read as one. (For the mitochondrion that claim would be false on the
// rCRS-backbone rows anyway: rCRS *is* the GRCh38 chrM reference, so at L3,
// N, R, HV and H the reference base is the derived allele.)
//
// ---------------------------------------------------------------------------
// The two branches, and why each is unambiguous under the rule above
// ---------------------------------------------------------------------------
// mtDNA — L3 > N > R > U > K > K1.
//   The deepest chain the shipped tree offers is six nodes, and only two exist
//   (…U>K>K1 and …HV>H>H1). The fixture carries the derived allele at all 17
//   markers of this one and the ancestral allele at HV's two, so H1's chain is
//   cut at HV and K1 is the sole depth-6 candidate; every shallower candidate
//   is a prefix of the winner. K has five defining markers, so the call is
//   well supported rather than resting on a single site. No position on the
//   chosen path is shared with any other node in the tree (the tree's only
//   shared positions are 16362, 15607, 11251 and 3010, none of them on it), so
//   no competing branch can be entered by an allele meant for this one.
//
// Y — I > I2.
//   The Y tree is two deep, so depth 2 wins outright. I2's only sibling, I1,
//   is excluded by the ancestral allele at M253, and every other subtree is
//   cut at its root by an ancestral allele, so I2 is the only depth-2
//   candidate. All 31 Y marker positions in the tree are distinct, so no
//   collision is possible. I was also chosen because GRCh38's chrY is an R1b
//   individual (PROVENANCE.md): at I and I2 markers the derived allele really
//   is a non-reference allele, so these rows are shaped like a real call.
//
// Exclusions are written down rather than left implicit: at every node on a
// chosen path, each sibling that is not on the path gets the ancestral allele
// at its own markers, so the walk is kept out by evidence instead of by
// missing data. Markers whose alleles are not single bases are skipped —
// mtDNA B's 8281 has `der: "-"`, a deletion this VCF cannot encode as a SNV,
// and B is still excluded by its other marker, 16217.
//
// After writing, the script parses its own output with the real VCF parser,
// rebuilds `getBase` exactly as src/app/api/files/[id]/process/route.ts does,
// runs the real `classify` over it, and refuses to leave a file behind whose
// call is not the expected one. The output is byte-identical across runs:
// there is no timestamp, no randomness and no filesystem order in it.
import crypto from "node:crypto";
import fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  classify,
  loadTree,
  type HaplogroupCall,
  type HaplogroupNode,
  type Lineage,
} from "../../src/lib/genome/haplogroups";
import { parseVcf } from "../../src/lib/genome/parsers/vcf";

export const FIXTURE_NAME = "lineage-grch38.vcf";

/** The chosen root-to-leaf branches. Both are argued in the header above. */
export const LINEAGE_BRANCHES: Readonly<Record<Lineage, readonly string[]>> = {
  mtDNA: ["L3", "N", "R", "U", "K", "K1"],
  Y: ["I", "I2"],
};

/** What the real `classify` must return over the real parse of this file. */
export const EXPECTED_CALLS: Readonly<
  Record<Lineage, { haplogroup: string; path: readonly string[]; matched: number; tested: number; support: string }>
> = {
  mtDNA: { haplogroup: "K1", path: LINEAGE_BRANCHES.mtDNA, matched: 17, tested: 17, support: "strong" },
  Y: { haplogroup: "I2", path: LINEAGE_BRANCHES.Y, matched: 4, tested: 4, support: "strong" },
};

/** src/lib/genome/types.ts numbering; the names `chromToNumber` maps back. */
const CHROM = { mtDNA: { number: 25, name: "chrM" }, Y: { number: 24, name: "chrY" } } as const;

/** Emission order: GRCh38 contig order puts chrY before chrM. */
const LINEAGES: readonly Lineage[] = ["Y", "mtDNA"];

const SINGLE_BASE = /^[ACGT]$/;

export interface FixtureRow {
  lineage: Lineage;
  chrom: number;
  chromName: string;
  pos: number;
  /** The allele the sample carries: ALT, so the parser keeps the row. */
  carried: string;
  /** The marker's other tree allele: REF, so the row is a called variant. */
  other: string;
  state: "derived" | "ancestral";
  /** Haplogroups whose marker list contains this position, in tree order. */
  nodes: string[];
}

function nodesByName(tree: readonly HaplogroupNode[]): Map<string, HaplogroupNode> {
  return new Map(tree.map((node) => [node.haplogroup, node]));
}

/** Fails loudly rather than emitting a file for a branch that is not one. */
function checkBranch(tree: readonly HaplogroupNode[], branch: readonly string[]): void {
  const byName = nodesByName(tree);
  if (branch.length === 0) throw new Error("a branch must name at least one haplogroup");
  let parent: string | null = null;
  for (const name of branch) {
    const node = byName.get(name);
    if (!node) throw new Error(`unknown haplogroup ${name}`);
    if (node.parent !== parent) throw new Error(`${name} is not a child of ${parent ?? "the tree root"}`);
    parent = name;
  }
  const leaf = branch[branch.length - 1];
  if (tree.some((node) => node.parent === leaf)) throw new Error(`${leaf} is not a leaf`);
}

/**
 * One row per distinct marker position: the derived allele at every marker of
 * every node on the branch, then the ancestral allele at every marker of every
 * off-branch sibling of a branch node. A position claimed twice must be
 * claimed identically — the shipped trees do repeat positions across nodes.
 */
export function rowsFor(lineage: Lineage): FixtureRow[] {
  const tree = loadTree(lineage);
  const branch = LINEAGE_BRANCHES[lineage];
  checkBranch(tree, branch);
  const onBranch = new Set(branch);
  const byPos = new Map<number, FixtureRow>();

  const claim = (node: HaplogroupNode, state: FixtureRow["state"]) => {
    for (const marker of node.markers) {
      // A deletion ("-") is not a base this SNV row can carry; skipping it
      // loses no exclusion, because such a node is excluded by its others.
      if (!SINGLE_BASE.test(marker.anc) || !SINGLE_BASE.test(marker.der)) continue;
      const carried = state === "derived" ? marker.der : marker.anc;
      const other = state === "derived" ? marker.anc : marker.der;
      const existing = byPos.get(marker.pos);
      if (existing) {
        if (existing.carried !== carried || existing.other !== other) {
          throw new Error(
            `position ${marker.pos} is claimed as ${existing.carried} by ${existing.nodes.join("/")} and as ${carried} by ${node.haplogroup}`,
          );
        }
        existing.nodes.push(node.haplogroup);
        continue;
      }
      byPos.set(marker.pos, {
        lineage,
        chrom: CHROM[lineage].number,
        chromName: CHROM[lineage].name,
        pos: marker.pos,
        carried,
        other,
        state,
        nodes: [node.haplogroup],
      });
    }
  };

  const byName = nodesByName(tree);
  for (const name of branch) claim(byName.get(name)!, "derived");
  // Every sibling of a branch node that is not itself on the branch. The first
  // branch node is a root, so the other roots are its siblings.
  const branchParents = new Set<string | null>([null, ...branch]);
  for (const node of tree) {
    if (onBranch.has(node.haplogroup) || !branchParents.has(node.parent)) continue;
    claim(node, "ancestral");
  }

  return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

function row(entry: FixtureRow): string {
  // ID stays "." on purpose: an rsID would make src/lib/genome/observed-calls.ts
  // record a literal REF/ALT observation for that rsID, and this file's REF is
  // a parser convention (see the header), not a reference-base claim.
  return [entry.chromName, String(entry.pos), ".", entry.other, entry.carried, "50", "PASS", ".", "GT", "1"].join("\t");
}

/** The fixture's lines (no trailing newline on the last line). */
export function buildLineageVcf(): string[] {
  const rows = LINEAGES.flatMap((lineage) => rowsFor(lineage));
  const summary = LINEAGES.map(
    (lineage) => `${lineage} ${LINEAGE_BRANCHES[lineage].join(">")}`,
  ).join("; ");
  return [
    "##fileformat=VCFv4.2",
    "##source=Inherit deterministic synthetic fixture; no real person; generated by e2e/fixtures/generate-lineage-vcf.ts",
    "##reference=GRCh38",
    `##inheritLineageBranches=${summary}`,
    "##inheritMarkerSource=data/ref/haplogroups/mtdna.json and y.json; every POS/REF/ALT is a shipped defining marker",
    "##inheritAlleleEncoding=ALT is the allele the sample carries, REF the marker's other tree allele; REF is not a claim about the GRCh38 reference base",
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO", "FORMAT", "SAMPLE1"].join("\t"),
    ...rows.map(row),
  ];
}

async function* asLines(lines: readonly string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

export interface FixtureClassification {
  build: string;
  skipped: number;
  variantCount: number;
  /** The two guards the process route puts in front of `classify`. */
  hasMt: boolean;
  hasY: boolean;
  calls: Record<Lineage, HaplogroupCall>;
}

/**
 * What the process route would compute from this fixture: the real parser,
 * then the same `byPos`/`getBase`/`hasMt`/`hasY` construction as
 * src/app/api/files/[id]/process/route.ts, then the real `classify`.
 */
export async function classifyFixture(lines: readonly string[]): Promise<FixtureClassification> {
  const parsed = await parseVcf(asLines(lines));
  const byPos = new Map(parsed.records.map((record) => [`${record.chrom}:${record.pos}`, record]));
  const getBase = (chrom: number, pos: number) => {
    const genotype = byPos.get(`${chrom}:${pos}`)?.genotype;
    if (!genotype) return null;
    const alleles = genotype.split("/");
    return /^[ACGT]$/.test(alleles[0]) ? alleles[0] : null;
  };
  const hasMt = parsed.records.some((record) => record.chrom === 25);
  const hasY = parsed.records.some((record) => record.chrom === 24);
  return {
    build: parsed.build,
    skipped: parsed.skipped,
    variantCount: parsed.records.length,
    hasMt,
    hasY,
    calls: {
      mtDNA: hasMt ? classify("mtDNA", getBase) : { haplogroup: null, path: [], matched: 0, tested: 0, support: "insufficient", note: "no mitochondrial records" },
      Y: hasY ? classify("Y", getBase) : { haplogroup: null, path: [], matched: 0, tested: 0, support: "insufficient", note: "no Y records" },
    },
  };
}

export interface FixtureCheck {
  ok: boolean;
  reasons: string[];
  classification: FixtureClassification;
}

export async function verify(lines: readonly string[]): Promise<FixtureCheck> {
  const classification = await classifyFixture(lines);
  const reasons: string[] = [];
  if (classification.build !== "GRCh38") reasons.push(`build parsed as ${classification.build}, not GRCh38`);
  if (classification.skipped !== 0) reasons.push(`${classification.skipped} rows were skipped by the parser`);
  if (!classification.hasMt) reasons.push("no chrM variant record: the route would not call classify('mtDNA')");
  if (!classification.hasY) reasons.push("no chrY variant record: the route would not call classify('Y')");
  for (const lineage of LINEAGES) {
    const call = classification.calls[lineage];
    const want = EXPECTED_CALLS[lineage];
    if (call.haplogroup !== want.haplogroup) reasons.push(`${lineage} called ${call.haplogroup ?? "null"}, expected ${want.haplogroup}`);
    if (call.path.join(">") !== want.path.join(">")) reasons.push(`${lineage} path ${call.path.join(">")}, expected ${want.path.join(">")}`);
    if (call.matched !== want.matched || call.tested !== want.tested) {
      reasons.push(`${lineage} matched ${call.matched}/${call.tested}, expected ${want.matched}/${want.tested}`);
    }
    if (call.support !== want.support) reasons.push(`${lineage} support ${call.support}, expected ${want.support}`);
  }
  return { ok: reasons.length === 0, reasons, classification };
}

async function main() {
  const lines = buildLineageVcf();
  const check = await verify(lines);
  if (!check.ok) {
    console.error(`fixture check failed:\n  - ${check.reasons.join("\n  - ")}`);
    process.exitCode = 1;
    return;
  }
  const text = `${lines.join("\n")}\n`;
  const target = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), FIXTURE_NAME);
  fs.writeFileSync(target, text);
  const sha256 = crypto.createHash("sha256").update(text).digest("hex");
  console.log(
    `wrote ${nodePath.relative(process.cwd(), target)} (${text.length} bytes, ${check.classification.variantCount} rows)`,
  );
  for (const lineage of LINEAGES) {
    const rows = rowsFor(lineage);
    const derived = rows.filter((entry) => entry.state === "derived").length;
    console.log(
      `${lineage}: ${rows.length} rows (${derived} derived along ${LINEAGE_BRANCHES[lineage].join(" > ")}, ${rows.length - derived} ancestral at competing branches)`,
    );
    console.log(`  call: ${check.classification.calls[lineage].note}`);
  }
  console.log(`sha256: ${sha256}`);
}

if (process.argv[1] && pathToFileURL(nodePath.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
