import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPatterns, normalise, prohibitedHit } from "./prohibited";

/**
 * G3.2 says a task must be bound to a named account, a named fixture and the
 * exact surface and content that count as success, because an unbound task
 * cannot be graded. A binding written in prose decays silently: a fixture is
 * regenerated, a template is renamed, a route moves, and the protocol still
 * reads correctly while pointing at nothing.
 *
 * So every binding in `bindings.json` is resolved here against the repository
 * it names, and the coverage claims - which is the whole reason T1 and T3 are
 * gradeable at all - are re-measured rather than trusted.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Coverage { fixture: string; rsids?: string[]; covered?: boolean; aimsCovered?: number }
interface Task {
  id: string; prompt: string; account: string; fixtures: string[]; routes: string[];
  templateSlugs: string[]; success: string; prohibitedClass: string | null;
  coverage?: Coverage[]; copyAnchors?: string[]; regionLabels?: string[];
  figureSources?: string[]; maxActions?: number; requiresCapability?: string;
  withheldVariant?: { prompt: string; when: string; routes: string[] };
}
interface Bindings {
  schemaVersion: number; measuredOn: string;
  measurement: Record<string, number | string>;
  accounts: { id: string; role: string; files: string[] }[];
  tasks: Task[];
}

const bindings = JSON.parse(
  readFileSync(path.join(ROOT, "scripts/comprehension/bindings.json"), "utf8"),
) as Bindings;

/** rsid -> genotype, for either committed fixture shape. */
function genotypedRsids(relativePath: string): Set<string> {
  const text = readFileSync(path.join(ROOT, relativePath), "utf8");
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    // 23andMe array export: rsid, chromosome, position, genotype.
    // VCF: chrom, pos, id, ref, alt, ...  The id column is the third.
    if (relativePath.endsWith(".vcf")) {
      if (fields.length > 2 && fields[2].startsWith("rs")) ids.add(fields[2]);
    } else if (fields.length >= 4 && fields[0].startsWith("rs")) {
      ids.add(fields[0]);
    }
  }
  return ids;
}

function templateSlugs(): Map<string, string> {
  const dir = path.join(ROOT, "data/templates");
  const slugs = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as unknown;
    if (!Array.isArray(parsed)) continue;
    for (const template of parsed as { slug?: string }[]) {
      if (template.slug) slugs.set(template.slug, name);
    }
  }
  return slugs;
}

const registerPaths = new Set(
  (JSON.parse(readFileSync(path.join(ROOT, "docs/route-register.json"), "utf8")) as {
    routes: { path: string; kind: string }[];
  }).routes.filter((r) => r.kind === "page").map((r) => r.path),
);

describe("every comprehension task is bound to something that exists", () => {
  it("carries exactly the brief's ten tasks, in order", () => {
    expect(bindings.tasks.map((t) => t.id)).toEqual(
      ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"],
    );
  });

  it("names an account for every task and no account the protocol does not define", () => {
    const accounts = new Set(bindings.accounts.map((a) => a.id));
    for (const task of bindings.tasks) expect(accounts, task.id).toContain(task.account);
  });

  it("names only fixtures that exist, on tasks and on accounts alike", () => {
    const referenced = [
      ...bindings.tasks.flatMap((t) => t.fixtures),
      ...bindings.accounts.flatMap((a) => a.files),
    ];
    expect(referenced.length).toBeGreaterThan(0);
    for (const fixture of referenced) {
      expect(existsSync(path.join(ROOT, fixture)), fixture).toBe(true);
    }
  });

  it("names only routes the register declares as pages", () => {
    for (const task of bindings.tasks) {
      for (const route of [...task.routes, ...(task.withheldVariant?.routes ?? [])]) {
        expect(registerPaths, `${task.id} -> ${route}`).toContain(route);
      }
    }
  });

  it("names only report templates that are seeded", () => {
    const slugs = templateSlugs();
    for (const task of bindings.tasks) {
      for (const slug of task.templateSlugs) {
        expect([...slugs.keys()], `${task.id} -> ${slug}`).toContain(slug);
      }
    }
  });

  it("names only copy constants that are still exported", () => {
    const strings = readFileSync(path.join(ROOT, "src/copy/reports/strings.ts"), "utf8");
    for (const task of bindings.tasks) {
      for (const anchor of task.copyAnchors ?? []) {
        expect(strings, `${task.id} -> ${anchor}`).toContain(`export const ${anchor}`);
      }
    }
  });

  it("names only source files that still emit the figure a task depends on", () => {
    for (const task of bindings.tasks) {
      for (const source of task.figureSources ?? []) {
        const text = readFileSync(path.join(ROOT, source), "utf8");
        expect(text, `${task.id} -> ${source}`).toContain('kind: "absolute"');
      }
    }
  });
});

describe("the coverage claims that make T1 and T3 gradeable are re-measured", () => {
  it("holds every declared covered / not-covered claim", () => {
    for (const task of bindings.tasks) {
      for (const claim of task.coverage ?? []) {
        if (claim.rsids === undefined) continue;
        const present = genotypedRsids(claim.fixture);
        for (const rsid of claim.rsids) {
          expect(present.has(rsid), `${task.id}: ${claim.fixture} ${rsid}`).toBe(claim.covered);
        }
      }
    }
  });

  it("holds the eleven not-covered templates as the whole not-covered set, not a chosen sample", () => {
    const sample = genotypedRsids("data/samples/synthetic_23andme.txt");
    const uncovered: string[] = [];
    const dir = path.join(ROOT, "data/templates");
    let total = 0;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const template of parsed as { slug: string; variants?: { rsid: number }[] }[]) {
        total += 1;
        const rsids = (template.variants ?? []).map((v) => `rs${v.rsid}`);
        if (!(rsids.length > 0 && rsids.every((r) => sample.has(r)))) uncovered.push(template.slug);
      }
    }
    expect(total).toBe(bindings.measurement.templatesTotal);
    expect(uncovered.length).toBe(bindings.measurement.templatesNotCoveredBySample);
    const t3 = bindings.tasks.find((t) => t.id === "T3")!;
    expect([...t3.templateSlugs].sort()).toEqual([...uncovered].sort());
  });

  it("holds the ancestry panel counts that decide which file T2 runs against", () => {
    const aims = (JSON.parse(readFileSync(path.join(ROOT, "data/ref/aims.json"), "utf8")) as
      { rsid: string | number }[]).map((m) => (String(m.rsid).startsWith("rs") ? String(m.rsid) : `rs${m.rsid}`));
    expect(aims.length).toBe(bindings.measurement.aimsPanelSize);
    const sample = genotypedRsids("data/samples/synthetic_23andme.txt");
    const mixed = genotypedRsids("e2e/fixtures/aims-mixed-grch38.vcf");
    expect(aims.filter((r) => sample.has(r)).length).toBe(bindings.measurement.aimsInSample);
    expect(aims.filter((r) => mixed.has(r)).length).toBe(bindings.measurement.aimsInAimsMixedFixture);
  });

  /**
   * Both directions, because the first draft of T2 named the five 1000 Genomes
   * superpopulation labels, four of which the product deliberately refuses to
   * print. Checking only that a label exists somewhere would not have caught
   * it; checking it against the denylist the product enforces does.
   */
  it("names every ancestry region the product labels, and none it forbids", () => {
    const regions = (JSON.parse(
      readFileSync(path.join(ROOT, "data/ref/regions/regions.json"), "utf8"),
    ) as { regions: { display_name: string }[] }).regions.map((r) => r.display_name);
    const denied = (JSON.parse(
      readFileSync(path.join(ROOT, "data/ref/regions/label-denylist.json"), "utf8"),
    ) as { words: string[] }).words.map((w) => w.toLowerCase());
    const t2 = bindings.tasks.find((t) => t.id === "T2")!;
    expect([...(t2.regionLabels ?? [])].sort()).toEqual([...regions].sort());
    for (const label of t2.regionLabels ?? []) {
      const words = label.toLowerCase().split(/[^a-z]+/).filter(Boolean);
      for (const word of words) expect(denied, `T2 -> ${label}`).not.toContain(word);
    }
  });
});

describe("the deterministic prohibited-answer path grades its own worked examples", () => {
  const patterns = loadPatterns(ROOT);

  it("defines exactly the three classes the brief names, and the tasks that carry them agree", () => {
    expect(patterns.classes.map((c) => c.id)).toEqual(["T5", "T6", "T7"]);
    const carrying = bindings.tasks.filter((t) => t.prohibitedClass).map((t) => t.prohibitedClass);
    expect(carrying).toEqual(["T5", "T6", "T7"]);
  });

  it("compiles every pattern as the file says it will be compiled", () => {
    let count = 0;
    for (const klass of patterns.classes) {
      for (const list of [klass.patterns, klass.relativePatterns, klass.absolutePatterns]) {
        for (const pattern of list ?? []) {
          expect(() => new RegExp(pattern, patterns.matching.flags)).not.toThrow();
          count += 1;
        }
      }
    }
    expect(count).toBeGreaterThan(20);
  });

  it("fires on every answer the file records as prohibited", () => {
    for (const klass of patterns.classes) {
      const examples = klass.prohibitedExamples ?? [];
      for (const answer of examples) {
        expect(prohibitedHit(klass, answer), `${klass.id}: ${answer}`).not.toBeNull();
      }
    }
    // T5 and T6 state their prohibited answers as the definition rather than a
    // list, so their firing is checked against answers written here.
    const t5 = patterns.classes.find((c) => c.id === "T5")!;
    for (const answer of [
      "It tells me I will get diabetes.",
      "I will definitely develop this.",
      "It says I am safe.",
      "It ruled it out, so I don't have to worry.",
    ]) expect(prohibitedHit(t5, answer), answer).not.toBeNull();
    const t6 = patterns.classes.find((c) => c.id === "T6")!;
    for (const answer of [
      "Inherit recommends the second embryo.",
      "Embryo B is the better one according to the table.",
      "It picked embryo A because it had fewer findings.",
    ]) expect(prohibitedHit(t6, answer), answer).not.toBeNull();
  });

  it("stays silent on every answer the file records as acceptable", () => {
    for (const klass of patterns.classes) {
      for (const answer of klass.notProhibited ?? []) {
        expect(prohibitedHit(klass, answer), `${klass.id}: ${answer}`).toBeNull();
      }
    }
  });

  it("normalises exactly what the file says it normalises, and nothing else", () => {
    expect(normalise("  It  DOESN’T   say. ")).toBe("it doesn't say.");
    // Punctuation and digits survive, because the patterns depend on both.
    expect(normalise("7 in 100 (about 7%)")).toBe("7 in 100 (about 7%)");
  });
});
