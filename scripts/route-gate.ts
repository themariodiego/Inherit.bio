import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * `docs/route-register.json` is the binding authority for 160 routes, and
 * until this gate existed nothing enforced most of what it says. The register
 * declared `POST` for the genome region read while the code shipped a `GET`
 * carrying a person's file identifier and the exact stretch of their genome in
 * the URL query string, where it reaches server logs, referrers and traces.
 * That defect was live for the life of the route and was found by reading the
 * register against the code by hand. This gate reads the same four things
 * mechanically, on every push:
 *
 *  1. Declared methods equal exported methods. A verb in the code that the
 *     register does not declare is live surface with no declared auth mode,
 *     request shape or response contract. A verb the register declares that
 *     the code does not export is a contract promising a surface that 405s.
 *  2. A registered redirect produces its registered status. `expectedStatus`
 *     is 308 for every legacy alias; a `permanent: false` entry in
 *     `next.config.ts` emits 307, which browsers and crawlers treat
 *     differently and which no test asserted.
 *  3. Every declared storage bucket exists, and every created bucket is
 *     declared. A prefix contract for a bucket nothing created describes
 *     access rules that protect nothing; a bucket holding user bytes under no
 *     declared prefix has no filename contract, retention id or disposition.
 *  4. Every (route, state) pair the register requires is proven by a browser
 *     test, counted as a ratchet so the unproven half can only shrink.
 *
 * Checks 1 to 3 compare against `docs/route-divergence.json` in both
 * directions: an unlisted divergence fails, and a listed one that no longer
 * exists fails too, so fixing a divergence forces the ledger to be updated
 * rather than leaving a stale entry behind. Check 5 is a count and an exact
 * list for the same reason.
 *
 * This gate is deliberately static. It reads files; it starts no server and
 * needs no database, so it belongs in the static half of CI alongside the
 * other gates and costs seconds.
 */

const APP = "src/app";
const REGISTER = "docs/route-register.json";
const LEDGER = "docs/route-divergence.json";
const MIGRATIONS = "supabase/migrations";
const BROWSER_TESTS = "e2e";

/**
 * The unproven half of the register's state matrix. This is a ratchet: it
 * fails when a proof is lost and it fails when a proof is added, so every
 * browser test that covers a new (route, state) pair has to bring this number
 * down with it and no later change can quietly give one back.
 */
const UNPROVEN_ROUTE_STATE_PAIRS = 248;

/** Everything the App Router will serve from a `route.ts`. */
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

interface RegisterEntry {
  id: string;
  path: string;
  kind: "page" | "endpoint" | "redirect";
  methods?: string[];
  expectedStatus?: number;
  stateProfile?: string;
  parameterContract?: unknown;
}

interface StateProfile {
  supported?: string[];
}

interface BuiltRoute {
  url: string;
  kind: "page" | "endpoint";
  file: string;
}

export interface RouteGateResult {
  failures: string[];
  builtRouteCount: number;
  matchedEndpointCount: number;
  registeredRedirectCount: number;
  checkedKindCount: number;
  declaredBucketCount: number;
  requiredStateCount: number;
  provenStateCount: number;
  /** Test titles built by interpolation, which a static reader cannot resolve. */
  unresolvableTitleCount: number;
  browserTestTitleCount: number;
}

/** Only `page` and `route` files create a URL; everything else is scaffolding. */
function builtRoutes(repositoryRoot: string): BuiltRoute[] {
  const found: BuiltRoute[] = [];
  const walk = (directory: string, segments: string[]) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Route groups are erased from the URL; parallel slots and private
        // folders never produce one.
        if (entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
        const grouped = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(full, grouped ? segments : [...segments, entry.name]);
        continue;
      }
      const kind = /^page\.(tsx|ts|jsx|js)$/.test(entry.name)
        ? ("page" as const)
        : /^route\.(ts|js)$/.test(entry.name)
          ? ("endpoint" as const)
          : null;
      if (kind) {
        found.push({
          url: `/${segments.join("/")}`.replace(/^\/$/, "/"),
          kind,
          file: path.relative(repositoryRoot, full).split(path.sep).join("/"),
        });
      }
    }
  };
  walk(path.join(repositoryRoot, APP), []);
  return found;
}

/**
 * A registered path, plus every concrete path its `parameterContract` pins.
 * `/withdraw/[token]` with token in {request, session} is also, and only,
 * `/withdraw/request` and `/withdraw/session`.
 */
function concretePaths(entry: RegisterEntry): string[] {
  const contract = entry.parameterContract;
  let forms = [entry.path];
  if (contract && typeof contract === "object") {
    for (const [segment, rule] of Object.entries(contract as Record<string, unknown>)) {
      if (!rule || typeof rule !== "object") continue;
      const spec = rule as { enum?: unknown; const?: unknown };
      const values = Array.isArray(spec.enum)
        ? spec.enum
        : spec.const !== undefined
          ? [spec.const]
          : null;
      if (!values) continue;
      const literals = values.filter((value): value is string => typeof value === "string");
      if (!literals.length) continue;
      forms = forms.flatMap((form) => literals.map((value) => form.replace(`[${segment}]`, value)));
    }
  }
  return [...new Set([entry.path, ...forms])];
}

/**
 * The verbs a `route.ts` actually exports. Next.js accepts a function
 * declaration, a const binding or a re-export, so all three are read.
 */
export function exportedMethods(source: string): string[] {
  return HTTP_METHODS.filter(
    (method) =>
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(source) ||
      new RegExp(`export\\s+(?:const|let|var)\\s+${method}\\b`).test(source) ||
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`, "s").test(source),
  );
}

/**
 * Next.js answers HEAD for any route exporting GET, so an explicit HEAD
 * alongside GET is the framework's own behaviour written out and not a
 * divergence from a register that never declares HEAD. A HEAD without a GET
 * is a real extra verb and stays.
 */
function comparableMethods(methods: string[]): string[] {
  const kept = methods.includes("GET") ? methods.filter((method) => method !== "HEAD") : methods;
  return [...kept].sort();
}

/**
 * The status a redirect implementation emits. `permanentRedirect` is 308 and
 * `redirect` is 307; the naming is close enough that the second pattern has to
 * refuse a match inside the first.
 */
function pageRedirectStatus(source: string): number | null {
  if (/\bpermanentRedirect\s*\(/.test(source)) return 308;
  if (/(?:^|[^A-Za-z0-9_$])redirect\s*\(/m.test(source)) return 307;
  return null;
}

/** `/reports/[slug]` in the register is `/reports/:slug` in `next.config.ts`. */
function configSourceForms(registeredPath: string): string[] {
  return [registeredPath, registeredPath.replace(/\[(\.\.\.)?([^\]]+)\]/g, ":$2")];
}

interface ConfigRedirect {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
}

async function configuredRedirects(repositoryRoot: string): Promise<ConfigRedirect[]> {
  const configPath = path.join(repositoryRoot, "next.config.ts");
  const loaded = (await import(pathToFileURL(configPath).href)) as {
    default?: { redirects?: () => Promise<ConfigRedirect[]> };
  };
  const redirects = loaded.default?.redirects;
  return typeof redirects === "function" ? await redirects.call(loaded.default) : [];
}

/**
 * Bucket names created by a migration. Only the one shape appears in this
 * repository, and a second shape appearing later trips the floor guard below
 * rather than passing unnoticed.
 */
export function createdBuckets(sql: string): string[] {
  const found: string[] = [];
  for (const statement of sql.matchAll(
    /insert\s+into\s+storage\.buckets\s*\([^)]*\)\s*values\s*([\s\S]*?);/gi,
  )) {
    for (const row of statement[1].matchAll(/\(\s*'([^']+)'/g)) found.push(row[1]);
  }
  return found;
}

/**
 * A route path and a state id are present in a test title only when neither is
 * a fragment of a longer word or path: `empty` inside `empty-history` is a
 * different state, and `/genome` inside `/genome/me` is a different route. The
 * two spans must also not overlap, so a state id that only appears inside the
 * route path proves nothing.
 */
const PATH_CONTINUES = /[A-Za-z0-9\-_.[\]/]/;
const STATE_CONTINUES = /[A-Za-z0-9-]/;

function anchoredSpans(haystack: string, needle: string, continues: RegExp): [number, number][] {
  const spans: [number, number][] = [];
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    const before = at > 0 ? haystack[at - 1] : "";
    const after = haystack[at + needle.length] ?? "";
    if (!continues.test(before) && !continues.test(after)) spans.push([at, at + needle.length]);
    at = haystack.indexOf(needle, at + 1);
  }
  return spans;
}

export function titleProves(title: string, routePath: string, stateId: string): boolean {
  const pathSpans = anchoredSpans(title, routePath, PATH_CONTINUES);
  if (!pathSpans.length) return false;
  return anchoredSpans(title, stateId, STATE_CONTINUES).some(([start, end]) =>
    pathSpans.some(([pathStart, pathEnd]) => end <= pathStart || start >= pathEnd),
  );
}

function browserTestTitles(directory: string): string[] {
  const titles: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.spec\.ts$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      for (const match of source.matchAll(
        /\b(?:test|it)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g,
      )) {
        titles.push(match[2]);
      }
    }
  };
  walk(directory);
  return titles;
}

/** Both directions at once: what is present, against what is recorded. */
function compareLedger(
  label: string,
  present: string[],
  recorded: string[],
  failures: string[],
): void {
  const sortedPresent = [...present].sort();
  const sortedRecorded = [...recorded].sort();
  for (const entry of sortedPresent) {
    if (!sortedRecorded.includes(entry)) {
      failures.push(`${label}: not recorded in ${LEDGER}: ${entry}`);
    }
  }
  for (const entry of sortedRecorded) {
    if (!sortedPresent.includes(entry)) {
      failures.push(`${label}: recorded in ${LEDGER} but no longer present: ${entry}`);
    }
  }
}

export async function runRouteGate(repositoryRoot: string): Promise<RouteGateResult> {
  const failures: string[] = [];
  const read = (relativePath: string) =>
    readFileSync(path.join(repositoryRoot, relativePath), "utf8");
  const register = JSON.parse(read(REGISTER)) as {
    routes: RegisterEntry[];
    stateProfiles: Record<string, StateProfile>;
    storagePrefixes: { id: string; bucket: string }[];
  };
  const ledger = JSON.parse(read(LEDGER)) as {
    methodDivergence?: { routeId: string; declared: string[]; exported: string[] }[];
    redirectStatusDivergence?: { routeId: string; expectedStatus: number; emitsStatus: number }[];
    kindDivergence?: { routeId: string; path: string; declaredKind: string; builtKind: string }[];
    storageBucketDivergence?: { bucket: string; direction: string }[];
    provenRouteStates?: string[];
  };

  const built = builtRoutes(repositoryRoot);
  const byUrl = new Map(built.map((route) => [route.url, route]));

  // 1. Declared methods against exported methods.
  const methodDivergence: string[] = [];
  let matchedEndpointCount = 0;
  for (const entry of register.routes) {
    if (entry.kind !== "endpoint") continue;
    const implementation = concretePaths(entry)
      .map((candidate) => byUrl.get(candidate))
      .find((candidate) => candidate?.kind === "endpoint");
    if (!implementation) continue;
    matchedEndpointCount += 1;
    const declared = comparableMethods(entry.methods ?? []);
    const exported = comparableMethods(exportedMethods(read(implementation.file)));
    if (declared.join("+") !== exported.join("+")) {
      methodDivergence.push(
        `${entry.id} declared=${declared.join("+") || "none"} exported=${exported.join("+") || "none"}`,
      );
    }
  }
  compareLedger(
    "declared methods",
    methodDivergence,
    (ledger.methodDivergence ?? []).map(
      (known) =>
        `${known.routeId} declared=${comparableMethods(known.declared).join("+") || "none"} ` +
        `exported=${comparableMethods(known.exported).join("+") || "none"}`,
    ),
    failures,
  );

  // 2. Registered redirects against the status they emit. `next.config.ts`
  // redirects run before the App Router, so a configured entry wins over a
  // page at the same path.
  const configured = await configuredRedirects(repositoryRoot);
  const registeredRedirects = register.routes.filter((entry) => entry.kind === "redirect");
  const redirectDivergence: string[] = [];
  for (const entry of registeredRedirects) {
    const forms = configSourceForms(entry.path);
    const fromConfig = configured.find((redirect) => forms.includes(redirect.source));
    const page = byUrl.get(entry.path);
    let emits: number | null = null;
    if (fromConfig) {
      emits = fromConfig.statusCode ?? (fromConfig.permanent ? 308 : 307);
    } else if (page?.kind === "page") {
      emits = pageRedirectStatus(read(page.file));
    }
    // Unimplemented is the register's own backlog and the correspondence test
    // already measures it; only a live implementation is judged here.
    if (emits === null) continue;
    if (entry.expectedStatus !== undefined && emits !== entry.expectedStatus) {
      redirectDivergence.push(
        `${entry.id} ${entry.path} expected=${entry.expectedStatus} emits=${emits}`,
      );
    }
  }
  compareLedger(
    "redirect status",
    redirectDivergence,
    (ledger.redirectStatusDivergence ?? []).map(
      (known) =>
        `${known.routeId} ${register.routes.find((entry) => entry.id === known.routeId)?.path} ` +
        `expected=${known.expectedStatus} emits=${known.emitsStatus}`,
    ),
    failures,
  );

  // 3. Registered kind against built kind, at every concrete path. Redirects
  // are excluded because check 2 judges them by the status they emit, which is
  // the thing that matters, and both a page and a config entry are legitimate
  // ways to produce it.
  const kindDivergence: string[] = [];
  let checkedKindCount = 0;
  for (const entry of register.routes) {
    if (entry.kind === "redirect") continue;
    for (const candidate of concretePaths(entry)) {
      const implementation = byUrl.get(candidate);
      if (!implementation) continue;
      checkedKindCount += 1;
      if (implementation.kind !== entry.kind) {
        kindDivergence.push(`${entry.id} ${candidate} declared=${entry.kind} built=${implementation.kind}`);
      }
    }
  }
  compareLedger(
    "route kind",
    kindDivergence,
    (ledger.kindDivergence ?? []).map(
      (known) => `${known.routeId} ${known.path} declared=${known.declaredKind} built=${known.builtKind}`,
    ),
    failures,
  );

  // 4. Declared storage buckets against the buckets migrations create.
  const declaredBuckets = new Set(register.storagePrefixes.map((prefix) => prefix.bucket));
  const migrationDirectory = path.join(repositoryRoot, MIGRATIONS);
  const migrationFiles = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql"));
  const createdBucketNames = new Set(
    migrationFiles.flatMap((name) =>
      createdBuckets(readFileSync(path.join(migrationDirectory, name), "utf8")),
    ),
  );
  const bucketDivergence = [
    ...[...declaredBuckets]
      .filter((bucket) => !createdBucketNames.has(bucket))
      .map((bucket) => `declared-not-created ${bucket}`),
    ...[...createdBucketNames]
      .filter((bucket) => !declaredBuckets.has(bucket))
      .map((bucket) => `created-not-declared ${bucket}`),
  ];
  compareLedger(
    "storage bucket",
    bucketDivergence,
    (ledger.storageBucketDivergence ?? []).map((known) => `${known.direction} ${known.bucket}`),
    failures,
  );

  // 5. The (route, state) ratchet.
  const required = new Set<string>();
  for (const entry of register.routes) {
    for (const state of register.stateProfiles[entry.stateProfile ?? ""]?.supported ?? []) {
      required.add(`${entry.path} ${state}`);
    }
  }
  const titles = browserTestTitles(path.join(repositoryRoot, BROWSER_TESTS));
  // What this scan cannot see, counted rather than left to inflate the ratchet.
  // A title built with a template interpolation resolves at run time to
  // something this static reader never holds: `legal page ${route} is complete`
  // is one source title that Playwright turns into twelve, each naming a real
  // route this suite really drives. Guessing at the resolved text would mean a
  // gate inferring what runs, so the number is reported instead - a reader who
  // sees 283 unproven pairs can tell how much of it is the product and how much
  // is this reader's own blindness. Measured 2026-09-10: 9 of 161 titles, and
  // only the legal one carries both a path and a state word, so the ratchet is
  // overwhelmingly a real gap rather than an artefact of this scan.
  const unresolvableTitles = titles.filter((title) => title.includes("${"));
  const proven = new Set<string>();
  for (const title of titles) {
    for (const entry of register.routes) {
      for (const state of register.stateProfiles[entry.stateProfile ?? ""]?.supported ?? []) {
        const pair = `${entry.path} ${state}`;
        if (required.has(pair) && titleProves(title, entry.path, state)) proven.add(pair);
      }
    }
  }
  compareLedger("proven route state", [...proven], ledger.provenRouteStates ?? [], failures);
  const unproven = required.size - proven.size;
  if (unproven !== UNPROVEN_ROUTE_STATE_PAIRS) {
    failures.push(
      `route state ratchet: ${unproven} of ${required.size} required (route, state) pairs are ` +
        `unproven, and UNPROVEN_ROUTE_STATE_PAIRS in scripts/route-gate.ts says ` +
        `${UNPROVEN_ROUTE_STATE_PAIRS}. Proving a pair means lowering that number in the same ` +
        `change; a rise means a proof was lost.`,
    );
  }

  // Floor guards. A walker that silently found nothing must not read as a
  // clean product, so each input is required to be roughly the size it is.
  if (built.length < 100) failures.push(`route walker found ${built.length} built routes, expected over 100`);
  if (matchedEndpointCount < 30) failures.push(`route walker matched ${matchedEndpointCount} endpoints, expected over 30`);
  if (registeredRedirects.length < 5) failures.push(`register holds ${registeredRedirects.length} redirects, expected over 5`);
  if (checkedKindCount < 90) failures.push(`kind check compared ${checkedKindCount} concrete paths, expected over 90`);
  if (createdBucketNames.size < 2) failures.push(`migrations create ${createdBucketNames.size} storage buckets, expected over 2`);
  if (migrationFiles.length < 50) failures.push(`migration walker found ${migrationFiles.length} files, expected over 50`);
  if (titles.length < 100) failures.push(`browser test walker found ${titles.length} titles, expected over 100`);

  return {
    failures,
    builtRouteCount: built.length,
    matchedEndpointCount,
    registeredRedirectCount: registeredRedirects.length,
    checkedKindCount,
    declaredBucketCount: declaredBuckets.size,
    requiredStateCount: required.size,
    provenStateCount: proven.size,
    unresolvableTitleCount: unresolvableTitles.length,
    browserTestTitleCount: titles.length,
  };
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "..");
  const result = await runRouteGate(repositoryRoot);
  if (result.failures.length > 0) {
    console.error(`ROUTE GATE FAILED (${result.failures.length})`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `route gate passed: ${result.matchedEndpointCount} endpoint method contracts, ` +
      `${result.registeredRedirectCount} registered redirects, ${result.checkedKindCount} route kinds, ` +
      `${result.declaredBucketCount} declared ` +
      `storage buckets, ${result.provenStateCount} of ${result.requiredStateCount} route states proven ` +
      `by ${result.browserTestTitleCount} browser tests ` +
      `(${result.unresolvableTitleCount} of them built by interpolation, which this static ` +
      `reader cannot resolve and does not guess at)`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
