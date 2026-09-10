import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * G1.11: `pnpm gate:claims` exits 0.
 *
 * The brief writes the rule out in four parts (docs/inherit-v2-brief.md,
 * G1.11), and this gate is those four parts and nothing else:
 *
 *  1. "every element carrying `data-figure-kind` or `data-claim` must carry
 *     `data-provenance` resolving to a citation id in `data/citations.json`,
 *     a seeded dataset row id, or `computed:<module>`; the gate fails on any
 *     such element without one".
 *  2. "every string block on a designated surface (report bodies, consent
 *     summaries, glossary definitions, Copilot system prompts, legal pages,
 *     the future-child preview, the embryo comparison) must be emitted
 *     through the shared claim component with a mandatory `citationId` prop;
 *     a string block rendered on those surfaces outside that component
 *     fails."
 *  3. "Exempt numerals are UI chrome only: on-screen item counts, step
 *     indicators, pagination, dates, file sizes, version strings. Exempt
 *     numerals must be emitted by components that never carry `data-claim`."
 *  4. "`data/citations.json` … with the schema: `id`, `type`
 *     (`pmid|doi|statute|registry|regulator|dataset`), `identifier`, `url`,
 *     `archived_path`, `access_date`, `quote` (≤ 25 words), `claim`."
 *
 * Two constitutional rules carry the same detector and are enforced here
 * because G1.11 is named as their detection path (brief C4 §13):
 *
 *  C4. "Every external fact used in the product or its documentation is
 *      recorded in `data/citations.json` … including the exact access date
 *      and a verbatim supporting quotation of ≤ 25 words. A local snapshot of
 *      every non-permanent web source is stored under `docs/sources/`."
 *  C6. A number a user can see resolves to "a value computed from that user's
 *      own uploaded data by code covered by unit tests", "a row in a seeded
 *      dataset in `data/`", or "a cited source in `data/citations.json`" —
 *      which is what `computed:` / `seed:` / `citation:` provenance must each
 *      point at for the provenance string to mean anything.
 *
 * How the two halves are read, and why this gate is static:
 *
 *  - Half 1 is read at its source. Only three components in this repository
 *    emit these attributes at all, and every value is an expression, so an
 *    attribute-presence scan of the rendered DOM would prove almost nothing
 *    that the source does not already say. What the source does say, and what
 *    the DOM cannot, is where each provenance *expression* comes from: this
 *    gate resolves every `FigureProvenance` literal built anywhere in `src/`
 *    and fails the ones that name a citation, a table or a module that does
 *    not exist. A provenance attribute that renders `computed:embryos/carrier`
 *    when no such module exists is a provenance string, not provenance.
 *  - Half 2 is read as registration. A report body's prose is not written in
 *    the page; it is written in `data/templates/*.json` and rendered through
 *    `src/lib/claims/presentation.ts`, which returns a claim only when the
 *    canonical `text_verbatim` matches the template string exactly. So "the
 *    string block goes through the shared claim component" is decidable
 *    without a browser: the block is registered in `data/claims.json` under
 *    the key that presentation.ts looks up, or it renders as bare prose.
 *    For the six designated surfaces that are not report bodies, the same
 *    question is decided at the module graph: a page whose imports never
 *    reach `src/components/claims/claim.tsx` cannot be emitting anything
 *    through the shared claim component.
 *
 * Every check compares its findings against `docs/claims-divergence.json` in
 * both directions: an unrecorded finding fails, and a recorded finding that no
 * longer holds fails too, so registering one claim forces the ledger down with
 * it and nothing can quietly give a registration back. The ledger is read from
 * disk at run time, exactly as `scripts/route-gate.ts` reads
 * `docs/route-divergence.json`, and each entry carries what it is, where it
 * is, why it exists, what closing it needs, and — where something outside code
 * is in the way — the blocker.
 *
 * Recording a divergence measures it; it does not bless it. Acceptance is a
 * line in `docs/acceptance-matrix.md`, not an entry here. The three checks
 * whose findings carry counts rebuild their sentence from the numbers the
 * ledger holds rather than from a copied string, so a single prose block
 * gaining or losing its registration moves the count and fails in both
 * directions instead of matching a stale sentence.
 *
 * The gate starts no server and needs no database. It belongs in the static
 * half of CI beside the other gates and costs seconds.
 */

const CITATIONS = "data/citations.json";
const CLAIMS = "data/claims.json";
const REGISTER = "docs/route-register.json";
const TEMPLATES = "data/templates";
const SOURCES = "docs/sources";
const MIGRATIONS = "supabase/migrations";
const SOURCE_TREE = "src";
const APP = "src/app";
const CLAIM_COMPONENT = "src/components/claims/claim.tsx";
const LEDGER = "docs/claims-divergence.json";

/** The `type` enum, verbatim from G1.11. */
const CITATION_TYPES = ["pmid", "doi", "statute", "registry", "regulator", "dataset"] as const;

/**
 * A PMID and a DOI are permanent identifiers that resolve to a fixed record;
 * the other four types are live web pages. C4 requires a local snapshot of
 * every *non-permanent* web source, so those four must carry one.
 */
const PERMANENT_IDENTIFIER_TYPES = new Set(["pmid", "doi"]);

/** G1.11's exempt-numeral list, and the same six `src/lib/claims/collect-dom.ts` accepts. */
const CHROME_KINDS = ["item-count", "step", "pagination", "date", "file-size", "version"];

/**
 * The brief spells the claim marker `data-claim`; this repository's collector
 * (`src/lib/claims/collect-dom.ts`) reads `[data-claim],[data-claim-id]` as
 * the same marker, so both are held to the rule. `data-claim-block`,
 * `data-claim-region` and `data-claim-registration` are layout and inventory
 * attributes, are excluded there for exactly that reason, and are excluded
 * here for the same one.
 */
const CLAIM_ATTRIBUTES = ["data-claim", "data-claim-id"];
const FIGURE_ATTRIBUTE = "data-figure-kind";
const PROVENANCE_ATTRIBUTE = "data-provenance";
const CHROME_ATTRIBUTE = "data-ui-chrome-kind";

interface DesignatedSurface {
  id: string;
  /** The brief's own words for this surface. */
  name: string;
  /** Register paths that are this surface. A `[param]` segment matches any segment. */
  routes: RegExp[];
  /** Files or directories that are this surface where no route renders it. */
  modules: string[];
  /**
   * False only for a surface that is not markup — a Copilot system prompt is
   * text sent to a model, so "emitted through the shared claim component" can
   * only mean its prose is a registered claim, never that a React component
   * rendered it.
   */
  rendersMarkup: boolean;
}

/**
 * G1.11's seven designated surfaces, each bound to the routes and modules
 * that are it in this repository. Nothing is added to the brief's list and
 * nothing is dropped from it: a surface this gate cannot locate fails as
 * unlocatable rather than passing as clean.
 */
const DESIGNATED_SURFACES: DesignatedSurface[] = [
  {
    id: "report-bodies",
    name: "report bodies",
    routes: [/^\/genome\/\[subject\]\/reports\/\[slug\]$/],
    modules: [],
    rendersMarkup: true,
  },
  {
    id: "consent-summaries",
    name: "consent summaries",
    routes: [/^\/legal\/consents?(\/|$)/, /^\/settings\/consents$/],
    modules: ["src/copy/upload/consent.ts"],
    rendersMarkup: true,
  },
  {
    id: "glossary-definitions",
    name: "glossary definitions",
    routes: [/^\/glossary(\/|$)/],
    // The brief's own path for the glossary corpus (§X7.1).
    modules: ["src/copy/glossary"],
    rendersMarkup: true,
  },
  {
    id: "copilot-system-prompts",
    name: "Copilot system prompts",
    routes: [],
    modules: ["src/lib/copilot"],
    rendersMarkup: false,
  },
  {
    id: "legal-pages",
    name: "legal pages",
    routes: [/^\/legal(\/|$)/, /^\/terms$/, /^\/privacy$/],
    modules: [],
    rendersMarkup: true,
  },
  {
    id: "future-child-preview",
    name: "the future-child preview",
    routes: [/^\/family\/portrait(\/|$)/],
    modules: ["src/copy/family/portrait.ts"],
    rendersMarkup: true,
  },
  {
    id: "embryo-comparison",
    name: "the embryo comparison",
    routes: [/^\/embryos\/compare$/],
    modules: ["src/copy/embryos/compare.ts"],
    rendersMarkup: true,
  },
];

export type ClaimsLedger = Record<string, string[]>;

/**
 * A recorded divergence for the seven checks whose findings are one-off
 * sentences about a single record — a citation, a claim, a provenance
 * expression, an element. There is nothing to recount, so the sentence itself
 * is what the ledger holds and what the comparison matches.
 */
interface RecordedFinding {
  finding: string;
}

/** One template file's unregistered report-body prose, by count. */
interface ReportBodyDivergence {
  file: string;
  unregisteredBlocks: number;
  totalBlocks: number;
  reports: number;
  summaries: number;
  interpretations: number;
  studyContexts: number;
}

/** One template file's cited sources that the citation register does not hold. */
interface TemplateCitationDivergence {
  file: string;
  absentSources: number;
  citedSources: number;
}

/** One designated surface, in the one of three shapes its finding takes. */
interface DesignatedSurfaceDivergence {
  surface: string;
  kind: "unlocatable" | "outside-claim-component" | "unbound";
  /** `unlocatable` only: the modules the gate looked for and did not find. */
  modules?: string[];
  /** `outside-claim-component` only. */
  pageModulesOutsideComponent?: number;
  pageModules?: number;
}

interface ClaimsDivergenceFile {
  citationSchema?: RecordedFinding[];
  sourceSnapshot?: RecordedFinding[];
  claimEvidence?: RecordedFinding[];
  claimSurface?: RecordedFinding[];
  figureProvenance?: RecordedFinding[];
  claimAttribute?: RecordedFinding[];
  exemptNumeral?: RecordedFinding[];
  reportBodyRegistration?: ReportBodyDivergence[];
  templateCitationRegistration?: TemplateCitationDivergence[];
  designatedSurface?: DesignatedSurfaceDivergence[];
}

/**
 * One template file's report-body finding. Both the check and the ledger
 * reader build it here, so a recorded divergence and a present one are the
 * same sentence or they are not the same divergence.
 */
export function reportBodyFinding(entry: ReportBodyDivergence): string {
  return (
    `${entry.file}: ${entry.unregisteredBlocks} of ${entry.totalBlocks} report-body prose blocks across ` +
    `${entry.reports} reports are not registered canonical claims (${entry.summaries} summaries, ` +
    `${entry.interpretations} genotype interpretations, ${entry.studyContexts} study contexts)`
  );
}

/** One template file's unregistered cited sources, built in one place for the same reason. */
export function templateCitationFinding(entry: TemplateCitationDivergence): string {
  return `${entry.file}: ${entry.absentSources} of ${entry.citedSources} cited sources are absent from ${CITATIONS}`;
}

/** One designated surface's finding, in the one of three shapes its `kind` names. */
export function designatedSurfaceFinding(entry: DesignatedSurfaceDivergence): string {
  if (entry.kind === "unlocatable") {
    return (
      `${entry.surface}: no page route in ${REGISTER} and none of ${entry.modules?.join(", ") || "its modules"} ` +
      `exists, so this gate is checking nothing on a surface the brief designates`
    );
  }
  if (entry.kind === "outside-claim-component") {
    return (
      `${entry.surface}: ${entry.pageModulesOutsideComponent} of ${entry.pageModules} page modules never reach ` +
      `the shared claim component (${CLAIM_COMPONENT}), so their prose is rendered outside it`
    );
  }
  return `${entry.surface}: no claim in ${CLAIMS} is bound to it`;
}

/**
 * The committed ledger, as the label-keyed finding lists the comparison reads.
 * A group the file omits is an empty group, which fails on its first finding
 * rather than passing silently.
 */
export function readClaimsLedger(repositoryRoot: string): ClaimsLedger {
  const file = JSON.parse(
    readFileSync(path.join(repositoryRoot, LEDGER), "utf8"),
  ) as ClaimsDivergenceFile;
  const verbatim = (entries?: RecordedFinding[]) => (entries ?? []).map((entry) => entry.finding);
  return {
    "citation schema": verbatim(file.citationSchema),
    "source snapshot": verbatim(file.sourceSnapshot),
    "claim evidence": verbatim(file.claimEvidence),
    "claim surface": verbatim(file.claimSurface),
    "figure provenance": verbatim(file.figureProvenance),
    "claim attribute": verbatim(file.claimAttribute),
    "exempt numeral": verbatim(file.exemptNumeral),
    "report body registration": (file.reportBodyRegistration ?? []).map(reportBodyFinding),
    "template citation registration": (file.templateCitationRegistration ?? []).map(templateCitationFinding),
    "designated surface": (file.designatedSurface ?? []).map(designatedSurfaceFinding),
  };
}

interface Citation {
  id: string;
  type: string;
  identifier: string;
  url: string;
  archived_path: string | null;
  access_date: string;
  quote: string;
  claim: string;
}

interface ClaimEvidence {
  citation: string;
  doi_or_url?: string;
  accessed_on?: string;
  what_it_supports?: string;
}

interface CanonicalClaim {
  claim_id: string;
  text_verbatim: string;
  surfaces: string[];
  evidence: ClaimEvidence[];
}

interface RegisterRoute {
  id: string;
  path: string;
  kind: string;
}

export interface ClaimsGateResult {
  failures: string[];
  citationCount: number;
  archivedSourceCount: number;
  claimCount: number;
  claimEvidenceCount: number;
  provenanceLiteralCount: number;
  markedElementCount: number;
  chromeElementCount: number;
  scannedMarkupFileCount: number;
  reportTemplateCount: number;
  reportProseCount: number;
  registeredProseCount: number;
  templateCitationCount: number;
  registeredTemplateCitationCount: number;
  designatedSurfaceCount: number;
}

/** A word for the ≤ 25-word quote limit: a whitespace-separated token carrying a letter or digit. */
export function quoteWordCount(quote: string): number {
  return quote.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;
}

/** A real calendar date, so a February 30th cannot pass as an access date. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

/**
 * Comment bodies blanked out, so a documented example cannot be read as code.
 * `src/components/figures/relative-figure.tsx` documents its own output as
 * `<p data-figure-kind="relative">` in its header, and a scanner that reads
 * that as an element reports a figure with no provenance on a component that
 * carries one. Two narrow exceptions keep real strings intact: `//` after a
 * colon is a URL scheme, and `/*` after an asterisk is a glob.
 */
export function withoutComments(source: string): string {
  const out = [...source];
  let index = 0;
  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    if (pair === "/*" && source[index - 1] !== "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let at = index; at < stop; at += 1) if (out[at] !== "\n") out[at] = " ";
      index = stop;
      continue;
    }
    if (pair === "//" && source[index - 1] !== ":") {
      let end = source.indexOf("\n", index);
      if (end === -1) end = source.length;
      for (let at = index; at < end; at += 1) out[at] = " ";
      index = end;
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * Every JSX element in a source file, as its tag name and its attribute text.
 * The scan tracks quotes and brace depth so an arrow function or a template
 * literal inside an attribute cannot end the tag early. A type argument
 * (`useState<Record<string, string>>`) is read as a tag with attributes and
 * is harmless: nothing acts on an element that carries no data attribute.
 */
export function elementTags(input: string): { tag: string; attributes: string }[] {
  return scanTags(withoutComments(input)).tags;
}

/**
 * The scan is recursive because a JSX prop can hold markup — the report page
 * passes a whole `<div>` of summary and figures as `whatThisIs={…}` — and an
 * element that only ever appears inside a prop is still an element on the
 * page. Each tag keeps only its own attributes: a nested element's text is
 * cut out of its parent's, so a parent cannot borrow a child's provenance and
 * a child's missing one cannot be reported against its parent.
 */
function scanTags(source: string): {
  tags: { tag: string; attributes: string }[];
  spans: [number, number][];
} {
  const tags: { tag: string; attributes: string }[] = [];
  const spans: [number, number][] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "<") continue;
    const name = /^<([A-Za-z][A-Za-z0-9._-]*)/.exec(source.slice(index, index + 80));
    if (!name) continue;
    const attributeStart = index + name[0].length;
    let cursor = attributeStart;
    let depth = 0;
    let quote = "";
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (character === "\\") cursor += 1;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth <= 0) break;
    }
    if (cursor >= source.length) continue;
    const raw = source.slice(attributeStart, cursor);
    const inner = scanTags(raw);
    let attributes = "";
    let at = 0;
    for (const [start, end] of inner.spans) {
      attributes += raw.slice(at, start);
      at = Math.max(at, end);
    }
    tags.push({ tag: name[1], attributes: attributes + raw.slice(at) });
    tags.push(...inner.tags);
    spans.push([index, cursor + 1]);
    index = cursor;
  }
  return { tags, spans };
}

/** Attribute presence, refusing a longer name that merely starts with this one. */
export function hasAttribute(attributes: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_-])${name}\\s*=`).test(attributes);
}

/** The literal value of an attribute, or null when it is an expression. */
export function literalAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|[^A-Za-z0-9_-])${name}\\s*=\\s*"([^"]*)"`).exec(attributes);
  return match ? match[1] : null;
}

/**
 * Every provenance a source file builds, as the string it would serialise to
 * (`src/lib/figures/contract.ts` `provenanceAttribute`), plus the ones it
 * cannot: a `computed` module or a `citation` id given as an expression is
 * reported as `<kind>:?<expression>` because a provenance the gate cannot
 * resolve is not a provenance "resolving to a citation id … or
 * `computed:<module>`".
 *
 * A `seed` row id is exempt from that: the row is the user's own record and
 * is necessarily dynamic, so the table is what a static reader can check.
 * File-local `const NAME = "literal"` bindings are substituted first, which
 * is how the admixture module reaches its provenance.
 */
export function provenanceLiterals(input: string): string[] {
  const source = withoutComments(input);
  const constants = new Map<string, string>();
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*"([^"]*)"/g)) {
    constants.set(match[1], match[2]);
  }
  const literal = (raw: string): string => {
    const trimmed = raw.replace(/\s+/g, " ").trim();
    const quoted = /^"([^"]*)"$/.exec(trimmed) ?? /^'([^']*)'$/.exec(trimmed);
    if (quoted) return quoted[1];
    return constants.get(trimmed) ?? `?${trimmed}`;
  };
  const found: string[] = [];
  // Provenance objects, in either field order.
  for (const match of source.matchAll(/\bkind:\s*"computed"\s*,\s*module:\s*([^,}]+)/g)) {
    found.push(`computed:${literal(match[1])}`);
  }
  for (const match of source.matchAll(/\bmodule:\s*([^,}]+?)\s*,\s*kind:\s*"computed"/g)) {
    found.push(`computed:${literal(match[1])}`);
  }
  for (const match of source.matchAll(/\bkind:\s*"citation"\s*,\s*id:\s*([^,}]+)/g)) {
    found.push(`citation:${literal(match[1])}`);
  }
  for (const match of source.matchAll(/\bkind:\s*"seed"\s*,\s*table:\s*([^,}]+?)\s*,/g)) {
    found.push(`seed:${literal(match[1])}`);
  }
  // Provenance written straight into markup as a literal attribute.
  for (const match of source.matchAll(/data-provenance\s*=\s*"([^"]*)"/g)) found.push(match[1]);
  return found;
}

/** Every file under a directory, skipping tests and anything not TypeScript. */
function sourceFiles(root: string, extensions: string[]): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

/** `@/x` and `./x` to a file on disk; a package import resolves to nothing. */
function resolveImport(repositoryRoot: string, from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(repositoryRoot, SOURCE_TREE, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Whether the module graph rooted at `entry` reaches `target`. */
export function importsReach(repositoryRoot: string, entry: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file === target) return true;
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const resolved = resolveImport(repositoryRoot, file, match[1]);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return false;
}

/** The URL each `page` file in the App Router serves, route groups erased. */
function pageFilesByUrl(repositoryRoot: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (directory: string, segments: string[]) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
        const grouped = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(full, grouped ? segments : [...segments, entry.name]);
        continue;
      }
      if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        found.set(`/${segments.join("/")}`.replace(/^\/$/, "/"), full);
      }
    }
  };
  walk(path.join(repositoryRoot, APP), []);
  return found;
}

/** A concrete surface path against a registered path, where `[param]` takes any one segment. */
export function pathMatchesRoute(surfacePath: string, routePath: string): boolean {
  const surface = surfacePath.split("/");
  const route = routePath.split("/");
  if (surface.length !== route.length) return false;
  return route.every((segment, index) =>
    /^\[.+\]$/.test(segment) ? surface[index].length > 0 : segment === surface[index],
  );
}

interface ProseBlock {
  key: string;
  kind: "summary" | "interpretation" | "study-context";
  text: string;
}

/**
 * Every prose block a report template renders, keyed exactly as
 * `src/lib/claims/presentation.ts` keys it — `report.<slug>.summary`,
 * `report.<slug>.interpretation.rs<rsid>.<sorted genotype>` and
 * `report.<slug>.study.<identifier>.<field>`. A block whose key is absent
 * from `data/claims.json`, or whose canonical text differs by one character,
 * is a block the shared claim component refuses and the page renders bare.
 */
export function reportProseBlocks(template: unknown): ProseBlock[] {
  if (!template || typeof template !== "object") return [];
  const entry = template as {
    slug?: unknown;
    summary?: unknown;
    variants?: unknown;
    citations?: unknown;
  };
  if (typeof entry.slug !== "string" || !entry.slug) return [];
  const slug = entry.slug;
  const blocks: ProseBlock[] = [];
  if (typeof entry.summary === "string" && entry.summary.trim()) {
    blocks.push({ key: `report.${slug}.summary`, kind: "summary", text: entry.summary });
  }
  for (const variant of Array.isArray(entry.variants) ? entry.variants : []) {
    const value = variant as { rsid?: unknown; interpretations?: unknown };
    if (typeof value.rsid !== "number" || !value.interpretations) continue;
    for (const [genotype, text] of Object.entries(value.interpretations as Record<string, unknown>)) {
      if (typeof text !== "string" || !text.trim()) continue;
      const key = genotype.split("").sort().join("").toLowerCase();
      blocks.push({
        key: `report.${slug}.interpretation.rs${value.rsid}.${key}`,
        kind: "interpretation",
        text,
      });
    }
  }
  for (const citation of Array.isArray(entry.citations) ? entry.citations : []) {
    const value = citation as { pmid?: unknown; doi?: unknown; studyContext?: unknown };
    const identifier = typeof value.pmid === "string" ? value.pmid : typeof value.doi === "string" ? value.doi : undefined;
    if (!identifier || !value.studyContext || typeof value.studyContext !== "object") continue;
    for (const [field, held] of Object.entries(value.studyContext as Record<string, unknown>)) {
      const text = held && typeof held === "object" ? (held as { text?: unknown }).text : held;
      if (typeof text !== "string" || !text.trim()) continue;
      blocks.push({
        key: `report.${slug}.study.${identifier.toLowerCase().replaceAll("/", "-")}.${field}`,
        kind: "study-context",
        text,
      });
    }
  }
  return blocks;
}

/** The canonical source id a template citation names, as `presentation.ts` derives it. */
export function templateCitationId(
  citation: { pmid?: unknown; doi?: unknown },
  citations: Citation[],
): string {
  if (typeof citation.pmid === "string" && citation.pmid) return `pmid:${citation.pmid}`;
  const doi = typeof citation.doi === "string" ? citation.doi.toLowerCase() : "";
  const known = citations.find(
    (source) => source.type === "doi" && source.identifier.toLowerCase() === doi,
  );
  return known?.id ?? `doi:${doi}`;
}

/** Table names any migration creates, so a `seed:` provenance can be resolved. */
export function createdTables(sql: string): string[] {
  return [
    ...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)/gi),
  ].map((match) => match[1].toLowerCase());
}

/** Both directions at once: what is present, against what is recorded. */
function compareLedger(
  ledger: ClaimsLedger,
  label: string,
  present: string[],
  failures: string[],
): void {
  const recorded = ledger[label] ?? [];
  for (const entry of [...present].sort()) {
    if (!recorded.includes(entry)) failures.push(`${label}: not recorded in ${LEDGER}: ${entry}`);
  }
  for (const entry of [...recorded].sort()) {
    if (!present.includes(entry)) {
      failures.push(`${label}: recorded in ${LEDGER} but no longer present: ${entry}`);
    }
  }
}

/**
 * `ledger` exists so the both-directions comparison is testable against a
 * ledger the test controls; the gate itself always runs against the committed
 * `docs/claims-divergence.json` of the repository it is pointed at.
 */
export function runClaimsGate(
  repositoryRoot: string,
  ledger: ClaimsLedger = readClaimsLedger(repositoryRoot),
): ClaimsGateResult {
  const failures: string[] = [];
  const compare = (label: string, present: string[]) =>
    compareLedger(ledger, label, present, failures);
  const read = (relativePath: string) =>
    readFileSync(path.join(repositoryRoot, relativePath), "utf8");
  const citations = JSON.parse(read(CITATIONS)) as Citation[];
  const claims = JSON.parse(read(CLAIMS)) as CanonicalClaim[];
  const register = JSON.parse(read(REGISTER)) as {
    routes: RegisterRoute[];
    stateIds: string[];
    exportContracts: Record<string, unknown>;
  };

  // 1. The citation register's schema (G1.11's fourth bullet, C4).
  const citationSchema: string[] = [];
  const seenCitationIds = new Set<string>();
  const fields = ["id", "type", "identifier", "url", "archived_path", "access_date", "quote", "claim"];
  for (const [index, citation] of citations.entries()) {
    const at = typeof citation?.id === "string" && citation.id ? citation.id : `entry ${index}`;
    const held = citation && typeof citation === "object" ? Object.keys(citation) : [];
    for (const field of fields) if (!held.includes(field)) citationSchema.push(`${at} is missing ${field}`);
    for (const field of held) if (!fields.includes(field)) citationSchema.push(`${at} carries unknown field ${field}`);
    if (typeof citation?.id === "string" && seenCitationIds.has(citation.id)) {
      citationSchema.push(`${at} is a duplicate id`);
    }
    if (typeof citation?.id === "string") seenCitationIds.add(citation.id);
    if (!CITATION_TYPES.includes(citation?.type as (typeof CITATION_TYPES)[number])) {
      citationSchema.push(`${at} type=${String(citation?.type)} is outside ${CITATION_TYPES.join("|")}`);
    }
    for (const field of ["identifier", "url", "claim"] as const) {
      if (typeof citation?.[field] !== "string" || !citation[field].trim()) {
        citationSchema.push(`${at} has an empty ${field}`);
      }
    }
    if (typeof citation?.url === "string" && !/^https?:\/\//.test(citation.url)) {
      citationSchema.push(`${at} url is not resolvable by an independent reader: ${citation.url}`);
    }
    if (!isCalendarDate(citation?.access_date)) {
      citationSchema.push(`${at} access_date=${String(citation?.access_date)} is not a calendar date`);
    }
    if (typeof citation?.quote !== "string" || !citation.quote.trim()) {
      citationSchema.push(`${at} has no verbatim supporting quotation`);
    } else if (quoteWordCount(citation.quote) > 25) {
      citationSchema.push(`${at} quote is ${quoteWordCount(citation.quote)} words, over the 25-word limit`);
    }
  }
  compare("citation schema", citationSchema);

  // 2. The local snapshot of every non-permanent web source (C4).
  const snapshots: string[] = [];
  let archivedSourceCount = 0;
  for (const citation of citations) {
    const archived = citation?.archived_path;
    const at = typeof citation?.id === "string" ? citation.id : "unnamed citation";
    if (archived === null || archived === undefined) {
      if (!PERMANENT_IDENTIFIER_TYPES.has(citation?.type)) {
        snapshots.push(`${at} is a ${citation?.type} web source with no local snapshot under ${SOURCES}/`);
      }
      continue;
    }
    if (typeof archived !== "string" || !archived.startsWith(`${SOURCES}/`)) {
      snapshots.push(`${at} archived_path is not under ${SOURCES}/: ${String(archived)}`);
      continue;
    }
    archivedSourceCount += 1;
    if (!existsSync(path.join(repositoryRoot, archived))) {
      snapshots.push(`${at} archived_path does not exist: ${archived}`);
    }
  }
  compare("source snapshot", snapshots);

  // 3. The claim register's evidence (G1.11's second bullet, C4).
  const claimById = new Map<string, CanonicalClaim>();
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));
  const evidenceFindings: string[] = [];
  let claimEvidenceCount = 0;
  for (const [index, claim] of claims.entries()) {
    const at = typeof claim?.claim_id === "string" && claim.claim_id ? claim.claim_id : `entry ${index}`;
    if (typeof claim?.claim_id !== "string" || !claim.claim_id) {
      evidenceFindings.push(`${at} has no claim_id`);
      continue;
    }
    if (claimById.has(claim.claim_id)) evidenceFindings.push(`${at} is a duplicate claim_id`);
    claimById.set(claim.claim_id, claim);
    if (typeof claim.text_verbatim !== "string" || !claim.text_verbatim.trim()) {
      evidenceFindings.push(`${at} has no verbatim text`);
    }
    if (!Array.isArray(claim.surfaces) || claim.surfaces.length === 0) {
      evidenceFindings.push(`${at} names no surface it appears on`);
    }
    const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
    if (evidence.length === 0) {
      evidenceFindings.push(`${at} carries no citation`);
      continue;
    }
    for (const item of evidence) {
      claimEvidenceCount += 1;
      const source = citationById.get(item?.citation);
      if (!source) {
        evidenceFindings.push(`${at} cites ${String(item?.citation)}, which is not in ${CITATIONS}`);
        continue;
      }
      if (!isCalendarDate(item?.accessed_on)) {
        evidenceFindings.push(`${at} cites ${source.id} with no access date`);
      } else if (item.accessed_on !== source.access_date) {
        evidenceFindings.push(
          `${at} cites ${source.id} accessed_on=${item.accessed_on} while ${CITATIONS} ` +
            `records access_date=${source.access_date}`,
        );
      }
    }
  }
  compare("claim evidence", evidenceFindings);

  // 4. Every surface a claim names is a surface this product has.
  const templateFiles = readdirSync(path.join(repositoryRoot, TEMPLATES))
    .filter((name) => name.endsWith(".json") && name !== "SCHEMA.md")
    .sort();
  const templatesByFile = new Map<string, unknown[]>();
  for (const name of templateFiles) {
    const parsed = JSON.parse(read(`${TEMPLATES}/${name}`)) as unknown;
    templatesByFile.set(`${TEMPLATES}/${name}`, Array.isArray(parsed) ? parsed : []);
  }
  const templateSlugs = new Set(
    [...templatesByFile.values()].flat().map((template) => (template as { slug?: string })?.slug ?? ""),
  );
  const pageRoutes = register.routes.filter((route) => route.kind === "page");
  const surfaceFindings: string[] = [];
  for (const claim of claims) {
    for (const surface of Array.isArray(claim?.surfaces) ? claim.surfaces : []) {
      if (typeof surface !== "string") {
        surfaceFindings.push(`${claim.claim_id} names a surface that is not a string`);
        continue;
      }
      const [locator, ...fragments] = surface.split("#");
      const fragment = fragments.join("#");
      // A route surface is qualified by the register's own state ids; a
      // rendered mail surface is qualified by the capture fixture that
      // produced it (src/lib/claims/capture-emails.ts), which is generated
      // and so is checked for shape rather than membership.
      if (fragment && !locator.startsWith("email:")) {
        const state = /^state=(.+)$/.exec(fragment)?.[1];
        if (!state || !register.stateIds.includes(state)) {
          surfaceFindings.push(`${claim.claim_id} names surface state ${fragment}, which ${REGISTER} does not declare`);
        }
      }
      if (fragment && locator.startsWith("email:") && !/^fixture=[a-z0-9][a-z0-9-]*(#envelope=[a-z]+)?$/.test(fragment)) {
        surfaceFindings.push(`${claim.claim_id} qualifies a mail surface with ${fragment}, which names no capture fixture`);
      }
      if (locator.startsWith("export:")) {
        if (!(locator.slice("export:".length) in register.exportContracts)) {
          surfaceFindings.push(`${claim.claim_id} names ${locator}, which ${REGISTER} does not declare`);
        }
        continue;
      }
      if (locator.startsWith("email:")) {
        if (!existsSync(path.join(repositoryRoot, locator.slice("email:".length)))) {
          surfaceFindings.push(`${claim.claim_id} names ${locator}, which does not exist`);
        }
        continue;
      }
      const route = pageRoutes.find((entry) => pathMatchesRoute(locator, entry.path));
      if (!route) {
        surfaceFindings.push(`${claim.claim_id} names ${locator}, which is no page route in ${REGISTER}`);
        continue;
      }
      if (route.path === "/genome/[subject]/reports/[slug]") {
        const slug = locator.split("/").pop() ?? "";
        if (!templateSlugs.has(slug)) {
          surfaceFindings.push(`${claim.claim_id} names report ${slug}, which no template in ${TEMPLATES} publishes`);
        }
      }
    }
  }
  compare("claim surface", surfaceFindings);

  // 5. Every provenance built in src/ resolves (G1.11's first bullet, C6).
  const markupFiles = sourceFiles(path.join(repositoryRoot, SOURCE_TREE), [".ts", ".tsx"]);
  const migrationDirectory = path.join(repositoryRoot, MIGRATIONS);
  const migrationFiles = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql"));
  const tables = new Set(
    migrationFiles.flatMap((name) => createdTables(readFileSync(path.join(migrationDirectory, name), "utf8"))),
  );
  const provenanceFindings: string[] = [];
  let provenanceLiteralCount = 0;
  for (const file of markupFiles) {
    const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
    for (const value of provenanceLiterals(readFileSync(file, "utf8"))) {
      provenanceLiteralCount += 1;
      const [kind, rest] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
      const unresolvable = (what: string) =>
        provenanceFindings.push(
          `${relative} builds a ${kind} provenance whose ${what} is the expression ${rest.slice(1)}, ` +
            `which no static reader can resolve`,
        );
      if (kind === "citation") {
        if (rest.startsWith("?")) unresolvable("id");
        else if (!citationById.has(rest)) {
          provenanceFindings.push(`${relative} claims provenance ${value}, which is not in ${CITATIONS}`);
        }
        continue;
      }
      if (kind === "seed") {
        const table = rest.split("/")[0];
        if (table.startsWith("?")) unresolvable("table");
        else if (!tables.has(table.toLowerCase())) {
          provenanceFindings.push(`${relative} claims provenance ${value}, and no migration creates that table`);
        }
        continue;
      }
      if (kind === "computed") {
        if (rest.startsWith("?")) {
          unresolvable("module");
          continue;
        }
        const candidates = [rest, `${SOURCE_TREE}/lib/${rest}.ts`, `${SOURCE_TREE}/lib/${rest}/index.ts`];
        const resolved = candidates.find((candidate) => existsSync(path.join(repositoryRoot, candidate)));
        if (!resolved) {
          provenanceFindings.push(`${relative} claims provenance ${value}, and no module of that name exists`);
          continue;
        }
        // C6(a): computed means "code covered by unit tests", so an untested
        // module is not a provenance a number can rest on.
        const test = resolved.replace(/\.tsx?$/, ".test.ts");
        if (!existsSync(path.join(repositoryRoot, test))) {
          provenanceFindings.push(`${relative} claims provenance ${value}, and ${resolved} has no unit test`);
        }
        continue;
      }
      provenanceFindings.push(`${relative} claims provenance ${value}, which names no citation, seed row or module`);
    }
  }
  compare("figure provenance", provenanceFindings);

  // 6. Every claim or figure element carries provenance; 7. exempt numerals
  // are chrome and never carry a claim (G1.11's first and third bullets).
  const attributeFindings: string[] = [];
  const numeralFindings: string[] = [];
  let markedElementCount = 0;
  let chromeElementCount = 0;
  for (const file of markupFiles.filter((name) => name.endsWith(".tsx"))) {
    const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
    for (const element of elementTags(readFileSync(file, "utf8"))) {
      const claimed = CLAIM_ATTRIBUTES.filter((name) => hasAttribute(element.attributes, name));
      const figure = hasAttribute(element.attributes, FIGURE_ATTRIBUTE);
      const chrome = hasAttribute(element.attributes, CHROME_ATTRIBUTE);
      if (claimed.length || figure) {
        markedElementCount += 1;
        if (!hasAttribute(element.attributes, PROVENANCE_ATTRIBUTE)) {
          attributeFindings.push(
            `${relative} <${element.tag}> carries ${[...claimed, figure ? FIGURE_ATTRIBUTE : ""]
              .filter(Boolean)
              .join(" and ")} without ${PROVENANCE_ATTRIBUTE}`,
          );
        }
      }
      if (!chrome) continue;
      chromeElementCount += 1;
      const kind = literalAttribute(element.attributes, CHROME_ATTRIBUTE);
      if (kind === null) {
        numeralFindings.push(`${relative} <${element.tag}> sets ${CHROME_ATTRIBUTE} to an expression`);
      } else if (!CHROME_KINDS.includes(kind)) {
        numeralFindings.push(
          `${relative} <${element.tag}> claims exemption as ${kind}, outside ${CHROME_KINDS.join("|")}`,
        );
      }
      if (claimed.length || figure) {
        numeralFindings.push(
          `${relative} <${element.tag}> is exempt chrome and carries ${[...claimed, figure ? FIGURE_ATTRIBUTE : ""].filter(Boolean).join(" and ")}`,
        );
      }
    }
  }
  compare("claim attribute", attributeFindings);
  compare("exempt numeral", numeralFindings);

  // 8. Report bodies: every prose block a template renders is a registered
  // canonical claim, or the shared claim component refuses it and the page
  // renders it bare (G1.11's second bullet).
  const registrationFindings: string[] = [];
  let reportTemplateCount = 0;
  let reportProseCount = 0;
  let registeredProseCount = 0;
  let templateCitationCount = 0;
  let registeredTemplateCitationCount = 0;
  const templateCitationFindings: string[] = [];
  for (const [file, templates] of templatesByFile) {
    const unregistered = { summary: 0, interpretation: 0, "study-context": 0 };
    let total = 0;
    const slugsAffected = new Set<string>();
    let missingCitations = 0;
    let fileCitations = 0;
    for (const template of templates) {
      reportTemplateCount += 1;
      const slug = (template as { slug?: string })?.slug ?? "";
      for (const block of reportProseBlocks(template)) {
        total += 1;
        reportProseCount += 1;
        const registered = claimById.get(block.key);
        if (registered && registered.text_verbatim === block.text) {
          registeredProseCount += 1;
          continue;
        }
        unregistered[block.kind] += 1;
        slugsAffected.add(slug);
      }
      for (const citation of (template as { citations?: unknown })?.citations as
        | { pmid?: unknown; doi?: unknown }[]
        | undefined ?? []) {
        templateCitationCount += 1;
        fileCitations += 1;
        if (citationById.has(templateCitationId(citation, citations))) registeredTemplateCitationCount += 1;
        else missingCitations += 1;
      }
    }
    const missingProse = unregistered.summary + unregistered.interpretation + unregistered["study-context"];
    if (missingProse > 0) {
      registrationFindings.push(
        reportBodyFinding({
          file,
          unregisteredBlocks: missingProse,
          totalBlocks: total,
          reports: slugsAffected.size,
          summaries: unregistered.summary,
          interpretations: unregistered.interpretation,
          studyContexts: unregistered["study-context"],
        }),
      );
    }
    if (missingCitations > 0) {
      templateCitationFindings.push(
        templateCitationFinding({ file, absentSources: missingCitations, citedSources: fileCitations }),
      );
    }
  }
  compare("report body registration", registrationFindings);
  compare("template citation registration", templateCitationFindings);

  // 9. The seven designated surfaces (G1.11's second bullet).
  const pageFiles = pageFilesByUrl(repositoryRoot);
  const claimComponent = path.join(repositoryRoot, CLAIM_COMPONENT);
  const surfaceStatus: string[] = [];
  for (const surface of DESIGNATED_SURFACES) {
    const routes = pageRoutes.filter((route) => surface.routes.some((pattern) => pattern.test(route.path)));
    const modules = surface.modules.filter((module) => existsSync(path.join(repositoryRoot, module)));
    const rendered = routes.map((route) => pageFiles.get(route.path)).filter((file): file is string => !!file);
    if (rendered.length === 0 && modules.length === 0) {
      surfaceStatus.push(
        designatedSurfaceFinding({
          surface: surface.name,
          kind: "unlocatable",
          modules: surface.modules,
        }),
      );
      continue;
    }
    if (surface.rendersMarkup && rendered.length > 0) {
      const unreached = rendered.filter((file) => !importsReach(repositoryRoot, file, claimComponent));
      if (unreached.length > 0) {
        surfaceStatus.push(
          designatedSurfaceFinding({
            surface: surface.name,
            kind: "outside-claim-component",
            pageModulesOutsideComponent: unreached.length,
            pageModules: rendered.length,
          }),
        );
      }
    }
    const bound = claims.filter((claim) =>
      (Array.isArray(claim?.surfaces) ? claim.surfaces : []).some((entry) => {
        const locator = typeof entry === "string" ? entry.split("#")[0] : "";
        return routes.some((route) => pathMatchesRoute(locator, route.path));
      }),
    );
    if (bound.length === 0) {
      surfaceStatus.push(designatedSurfaceFinding({ surface: surface.name, kind: "unbound" }));
    }
  }
  compare("designated surface", surfaceStatus);

  // Floor guards. A reader that silently found nothing must not read as a
  // clean product, so each input is required to be roughly the size it is.
  if (citations.length < 15) failures.push(`citation register holds ${citations.length} sources, expected over 15`);
  if (claims.length < 50) failures.push(`claim register holds ${claims.length} claims, expected over 50`);
  if (claimEvidenceCount < 50) failures.push(`claim register holds ${claimEvidenceCount} pieces of evidence, expected over 50`);
  if (archivedSourceCount < 5) failures.push(`citation register holds ${archivedSourceCount} local snapshots, expected over 5`);
  if (reportTemplateCount < 100) failures.push(`template reader found ${reportTemplateCount} reports, expected over 100`);
  if (reportProseCount < 500) failures.push(`template reader found ${reportProseCount} report-body prose blocks, expected over 500`);
  if (templateCitationCount < 100) failures.push(`template reader found ${templateCitationCount} cited sources, expected over 100`);
  if (markupFiles.length < 200) failures.push(`source walker found ${markupFiles.length} modules, expected over 200`);
  if (markedElementCount < 3) failures.push(`source walker found ${markedElementCount} claim or figure elements, expected over 3`);
  if (chromeElementCount < 3) failures.push(`source walker found ${chromeElementCount} exempt-numeral elements, expected over 3`);
  if (provenanceLiteralCount < 10) failures.push(`source walker found ${provenanceLiteralCount} provenance expressions, expected over 10`);
  if (pageFiles.size < 50) failures.push(`page walker found ${pageFiles.size} page modules, expected over 50`);
  if (tables.size < 50) failures.push(`migration reader found ${tables.size} tables, expected over 50`);
  if (!existsSync(claimComponent)) failures.push(`the shared claim component ${CLAIM_COMPONENT} does not exist`);

  return {
    failures,
    citationCount: citations.length,
    archivedSourceCount,
    claimCount: claims.length,
    claimEvidenceCount,
    provenanceLiteralCount,
    markedElementCount,
    chromeElementCount,
    scannedMarkupFileCount: markupFiles.length,
    reportTemplateCount,
    reportProseCount,
    registeredProseCount,
    templateCitationCount,
    registeredTemplateCitationCount,
    designatedSurfaceCount: DESIGNATED_SURFACES.length,
  };
}

function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "..");
  const result = runClaimsGate(repositoryRoot);
  if (result.failures.length > 0) {
    console.error(`CLAIMS GATE FAILED (${result.failures.length})`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `claims gate passed: ${result.citationCount} cited sources with ${result.archivedSourceCount} local ` +
      `snapshots, ${result.claimCount} canonical claims on ${result.claimEvidenceCount} pieces of evidence, ` +
      `${result.registeredProseCount} of ${result.reportProseCount} report-body prose blocks registered, ` +
      `${result.registeredTemplateCitationCount} of ${result.templateCitationCount} template citations in the ` +
      `register, ${result.provenanceLiteralCount} provenance expressions and ${result.markedElementCount} claim ` +
      `or figure elements read across ${result.scannedMarkupFileCount} modules, ` +
      `${result.designatedSurfaceCount} designated surfaces checked`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
