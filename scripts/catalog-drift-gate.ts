/**
 * Does the report catalog a deployment serves say what this repository says?
 *
 * D-134. On 2026-09-25 production served `57d6b4e` against a reference
 * catalog that still held the pre-correction text of all eight reviewed
 * corrections in `data/report-scientific-corrections.json` (ADORA2A, APC,
 * FGFR2, ALDH2, TREM2, APOE, TCF7L2, Factor V). The application recognises
 * exactly that text as superseded, so every one of those reports rendered the
 * historical-wording notice over the wording it had just been served, and
 * every new canonical run captured the old text into a completed result that
 * a trigger then keeps immutable. Nothing could see it: deploying code never
 * refreshes `public.report_templates`, and CI seeds that table from
 * `data/templates/*.json` on every run, so the suite compared the repository
 * with itself and stayed green.
 *
 * That is D-106's shape moved from the schema to the content, and this check
 * is `gate:schema-drift`'s counterpart for it. It is not a CI gate for the
 * same reason: in CI the catalog was seeded from these same files seconds
 * earlier. It belongs against a DEPLOYED environment, after a deploy and after
 * any reference refresh — `SUPABASE_DB_URL=... pnpm gate:catalog-drift`.
 *
 * IT FAILS WHEN IT CANNOT CHECK, for the reason `schema-drift-gate.ts` gives.
 * It reads published rows only and prints slugs and field names, never
 * report text.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { seedLayerAndKind } from "./seed-layer";
import type { EstimateKind, FindingLayer } from "../src/lib/genome/taxonomy";
import {
  reportScientificCorrections,
  type ScientificCorrectionTemplate,
} from "../src/lib/genome/report-scientific-corrections";

const TEMPLATES = "data/templates";
const CORRECTIONS = "data/report-scientific-corrections.json";

/**
 * The columns a report is built from, and nothing else. They are the ones
 * `private.capture_own_report_catalog_v1` snapshots into a completed run, so a
 * difference in any of them is a difference a person can be shown. Dates and
 * `status` are not content: `published_at` records when a row was seeded, and
 * only published rows are read at all.
 */
export const CATALOG_FIELDS = [
  "category",
  "title",
  "summary",
  "evidence",
  "layer",
  "estimate_kind",
  "variants",
  "pgs_id",
  "citations",
] as const;

export type CatalogField = (typeof CATALOG_FIELDS)[number];
export type CatalogRow = { slug: string } & Record<CatalogField, unknown>;

/** A template as a seed file carries it: layer and estimate kind are optional there. */
interface SeedFileTemplate {
  slug: string;
  category: string;
  title: string;
  summary: string;
  evidence: string;
  layer?: FindingLayer;
  estimate_kind?: EstimateKind | null;
  variants: unknown;
  pgs_id: string | null;
  citations: unknown;
}

export interface CatalogDriftResult {
  findings: string[];
  expectedCount: number;
  deployedCount: number;
}

/**
 * The rows `scripts/seed.ts` would write, built the same way: the layer and
 * estimate kind through the seed's own `seedLayerAndKind`, citations
 * verbatim. A template the seed refuses to publish is not expected either.
 */
export function expectedCatalog(repositoryRoot: string): Map<string, CatalogRow> {
  const rows = new Map<string, CatalogRow>();
  const dir = path.join(repositoryRoot, TEMPLATES);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const templates = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as SeedFileTemplate[];
    for (const template of templates) {
      // The seed refuses these outright and `gate:templates` reports them.
      if (template.evidence === "insufficient") continue;
      if (rows.has(template.slug)) throw new Error(`${file}: duplicate template slug ${template.slug}`);
      rows.set(template.slug, {
        slug: template.slug,
        category: template.category,
        title: template.title,
        summary: template.summary,
        evidence: template.evidence,
        ...seedLayerAndKind(template),
        variants: template.variants,
        pgs_id: template.pgs_id,
        citations: template.citations,
      });
    }
  }
  return rows;
}

/**
 * Registered pre-correction wording in a deployed row, through the same
 * matcher the report page and Copilot use. A row that does not have the shape
 * the matcher reads is simply not classified; it is still reported as drift.
 */
function preCorrectionMatches(row: CatalogRow): number {
  if (typeof row.summary !== "string" || !Array.isArray(row.variants)) return 0;
  const variants = row.variants.filter(
    (variant): variant is ScientificCorrectionTemplate["variants"][number] =>
      typeof variant === "object" && variant !== null &&
      typeof (variant as { rsid?: unknown }).rsid === "number" &&
      typeof (variant as { interpretations?: unknown }).interpretations === "object" &&
      (variant as { interpretations?: unknown }).interpretations !== null,
  );
  return reportScientificCorrections({
    slug: row.slug,
    title: typeof row.title === "string" ? row.title : undefined,
    summary: row.summary,
    variants,
  }).length;
}

/**
 * Every way the two catalogs can disagree, said in the direction that matters.
 *
 * MISSING is a report the deployed code offers and cannot build. EXTRA is a
 * published report this repository cannot account for, which no review in it
 * covers. CHANGED is the D-134 case, and when the deployed text is wording the
 * corrections register records as superseded the finding says so, because
 * that is the case a person already sees: the notice, over the old text.
 * Equality is structural, not textual: `jsonb` reorders object keys, so two
 * identical catalogs never share a byte-for-byte rendering.
 */
export function catalogFindings(
  expected: ReadonlyMap<string, CatalogRow>,
  deployed: readonly CatalogRow[],
): string[] {
  const findings: string[] = [];
  const deployedBySlug = new Map<string, CatalogRow>();
  for (const row of deployed) {
    if (deployedBySlug.has(row.slug)) findings.push(`the deployment publishes ${row.slug} more than once`);
    deployedBySlug.set(row.slug, row);
  }

  const missing = [...expected.keys()].filter((slug) => !deployedBySlug.has(slug)).sort();
  const extra = [...deployedBySlug.keys()].filter((slug) => !expected.has(slug)).sort();
  if (missing.length) {
    findings.push(
      `the deployment does not publish ${missing.length} template(s) ${TEMPLATES} ships; the deployed code ` +
        `offers reports it cannot build: ${missing.join(", ")}`,
    );
  }
  if (extra.length) {
    findings.push(
      `the deployment publishes ${extra.length} template(s) this repository cannot account for, so no review ` +
        `in it covers what they say: ${extra.join(", ")}`,
    );
  }

  for (const [slug, want] of [...expected].sort(([a], [b]) => a.localeCompare(b))) {
    const have = deployedBySlug.get(slug);
    if (!have) continue;
    const changed = CATALOG_FIELDS.filter((field) => !isDeepStrictEqual(have[field] ?? null, want[field] ?? null));
    if (!changed.length) continue;
    const superseded = preCorrectionMatches(have);
    findings.push(
      `${slug}: ${changed.join(", ")} differ from ${TEMPLATES}` +
        (superseded
          ? `; ${superseded} deployed field(s) are wording ${CORRECTIONS} records as superseded, so the report ` +
            `shows the historical-wording notice over that text and each new report captures it permanently`
          : ""),
    );
  }

  // A reader that silently found nothing must not read as a clean deployment.
  if (!expected.size) findings.push(`no templates were read from ${TEMPLATES}`);
  if (!deployed.length) findings.push("the deployment publishes no templates at all");
  return findings;
}

async function deployedCatalog(url: string): Promise<CatalogRow[]> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
  try {
    // JSON travels as text and is parsed here, so the comparison never depends
    // on which JSON types a driver happens to decode.
    const rows = await sql<(Omit<CatalogRow, "variants" | "citations"> & { variants: string; citations: string })[]>`
      select slug, category, title, summary, evidence::text as evidence, layer::text as layer,
             estimate_kind, variants::text as variants, pgs_id, citations::text as citations
        from public.report_templates
       where status = 'published'
       order by slug
    `;
    return rows.map((row) => ({
      ...row,
      variants: JSON.parse(row.variants) as unknown,
      citations: JSON.parse(row.citations) as unknown,
    }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runCatalogDriftGate(repositoryRoot: string, url: string): Promise<CatalogDriftResult> {
  const expected = expectedCatalog(repositoryRoot);
  const deployed = await deployedCatalog(url);
  return {
    findings: catalogFindings(expected, deployed),
    expectedCount: expected.size,
    deployedCount: deployed.length,
  };
}

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  // Read from the environment and never from a file in the repository: this
  // string carries a database password.
  const url = process.env.SUPABASE_DB_URL ?? process.env.SUPABASE_MIGRATION_DB_URL;
  if (!url) {
    console.error(
      "CATALOG DRIFT GATE DID NOT RUN\n" +
        "  Set SUPABASE_DB_URL to the deployed database this build talks to, then run it again.\n" +
        "  Not running is a failure on purpose (D-106, D-134): deploying code never refreshes the\n" +
        "  catalog and CI seeds it from these files, so a skipped check looks exactly like a healthy one.",
    );
    process.exitCode = 1;
    return;
  }

  let result: CatalogDriftResult;
  try {
    result = await runCatalogDriftGate(repositoryRoot, url);
  } catch (error) {
    console.error(`CATALOG DRIFT GATE COULD NOT READ THE DEPLOYED CATALOG: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (result.findings.length) {
    console.error(`CATALOG DRIFT GATE FAILED (${result.findings.length})`);
    for (const finding of result.findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `catalog drift gate passed: ${result.expectedCount} templates in ${TEMPLATES}, ` +
      `${result.deployedCount} published by the deployed database, every report field identical`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  // Not top-level `await`, for the loader reason `schema-drift-gate.ts` gives.
  void main().catch((error: unknown) => {
    console.error(`CATALOG DRIFT GATE FAILED TO RUN: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
