import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createdBuckets, exportedMethods } from "./route-gate";

/**
 * `docs/route-register.json` is the binding response-contract authority: a
 * route's auth mode, request shape, policy and success contract are what the
 * register says they are. That only means something if the register and the
 * App Router agree about which routes exist, and nothing checked that.
 *
 * This gate walks `src/app` for the files that actually create URLs and
 * compares them with the register. Two disagreements matter and are checked
 * separately, because they fail in opposite ways:
 *
 *  - A built route the register does not describe is live surface with no
 *    declared contract at all.
 *  - A segment the register pins to fixed literals, implemented as an open
 *    dynamic segment, accepts values the contract forbids. That is how a raw
 *    bearer token ends up in a URL path.
 *
 * Registered-but-unbuilt is deliberately not failed here. The register is
 * written from the brief and describes routes the product has not reached
 * yet; 53 of them are unbuilt today and that is a backlog, not a defect. The
 * count is asserted loosely below only so a broken walker cannot pass.
 *
 * Known divergences live in `docs/route-divergence.json` and are checked in
 * both directions: an unlisted one fails, and a listed one that no longer
 * exists fails too, so fixing a divergence forces the ledger to be updated
 * rather than leaving a stale entry behind.
 */
const APP = "src/app";
const REGISTER = "docs/route-register.json";
const LEDGER = "docs/route-divergence.json";
/** The endpoint and prefix halves of the same gate; see the block comment above them. */
const CONTRACT_LEDGER = "docs/register-contract-divergence.json";
const RETENTION = "docs/retention.md";
const MIGRATIONS = "supabase/migrations";
/** Everything that runs: the app and libraries, the annotation worker, the R2 worker. */
const CODE_ROOTS = ["src", "worker/src", "workers"];

type Entry = {
  id: string;
  path: string;
  kind?: string;
  parameterContract?: unknown;
  auth?: string;
  methods?: string[];
  policy?: unknown;
  methodPolicies?: Record<string, unknown>;
  methodRequestContracts?: Record<string, unknown>;
  successResponseContract?: unknown;
  methodSuccessResponseContracts?: Record<string, unknown>;
};
type Built = { url: string; kind: "page" | "endpoint"; file: string };
type Prefix = {
  id: string;
  bucket: string;
  prefix: string;
  retentionId?: string;
  retentionIds?: string[];
  contracts?: string[];
};
type Register = {
  routes: Entry[];
  authContracts: Record<string, unknown>;
  contractDefaults: Record<string, string>;
  responseContracts: Record<string, unknown>;
  responseContractBindings: { allEndpoints?: string[]; routes: Record<string, string[]> };
  policyContracts: Record<string, unknown>;
  policyResolvers: Record<string, unknown>;
  lifecycleDispositionContracts: Record<string, unknown>;
  storagePrefixes: Prefix[];
  storageAccessContracts: Record<string, { prefixIds?: string[] }>;
  downloadContracts: Record<string, Record<string, unknown>>;
};

/** Only `page` and `route` files create a URL; everything else is scaffolding. */
function builtRoutes(): Built[] {
  const found: Built[] = [];
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
      const kind = /^page\.(tsx|ts|jsx|js)$/.test(entry.name) ? "page"
        : /^route\.(ts|js)$/.test(entry.name) ? "endpoint" : null;
      if (kind) found.push({ url: `/${segments.join("/")}`.replace(/^\/$/, "/"), kind, file: full });
    }
  };
  walk(APP, []);
  return found;
}

function register(): Entry[] {
  return JSON.parse(readFileSync(REGISTER, "utf8")).routes as Entry[];
}

/**
 * A registered path, plus every concrete path its `parameterContract` pins.
 * `/withdraw/[token]` with token in {request, session} is also, and only,
 * `/withdraw/request` and `/withdraw/session`.
 */
function concretePaths(entry: Entry): string[] {
  const contract = entry.parameterContract;
  let forms = [entry.path];
  if (contract && typeof contract === "object") {
    for (const [segment, rule] of Object.entries(contract as Record<string, unknown>)) {
      if (!rule || typeof rule !== "object") continue;
      const spec = rule as { enum?: unknown; const?: unknown };
      const values = Array.isArray(spec.enum) ? spec.enum
        : spec.const !== undefined ? [spec.const] : null;
      if (!values) continue;
      const literals = values.filter((value): value is string => typeof value === "string");
      if (!literals.length) continue;
      forms = forms.flatMap(form => literals.map(value => form.replace(`[${segment}]`, value)));
    }
  }
  return [...new Set([entry.path, ...forms])];
}

function pinnedSegments(entry: Entry): string[] {
  const contract = entry.parameterContract;
  if (!contract || typeof contract !== "object") return [];
  return Object.entries(contract as Record<string, unknown>)
    .filter(([, rule]) => rule && typeof rule === "object"
      && (Array.isArray((rule as { enum?: unknown }).enum) || (rule as { const?: unknown }).const !== undefined))
    .map(([segment]) => segment);
}

const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
  builtButNotRegistered: { path: string; file: string }[];
  permissiveDynamicSegment: { routeId: string; path: string; file: string }[];
  kindDivergence: { routeId: string; path: string; file: string; declaredKind: string; builtKind: string }[];
  storageBucketDivergence: { bucket: string; direction: string }[];
};

describe("the route register and the App Router describe the same surface", () => {
  const built = builtRoutes();
  const entries = register();
  const registered = new Set(entries.flatMap(concretePaths));

  it("walks the app directory at all, so a passing run is not an empty scan", () => {
    expect(built.length).toBeGreaterThan(100);
    // Route groups erased, dynamic segments kept verbatim, endpoints found.
    const urls = built.map(route => route.url);
    expect(urls).toContain("/");
    expect(urls).toContain("/withdraw/session");          // inside (marketing)
    expect(urls).toContain("/api/files/[id]/finalize");
    expect(built.some(route => route.kind === "page")).toBe(true);
    expect(built.some(route => route.kind === "endpoint")).toBe(true);
  });

  it("expands a pinned parameter into the literals it allows", () => {
    const rights = entries.find(entry => entry.id === "rights.withdraw")!;
    expect(concretePaths(rights)).toEqual(
      expect.arrayContaining(["/withdraw/[token]", "/withdraw/request", "/withdraw/session"]));
    const withdraw = entries.find(entry => entry.id === "api.withdraw")!;
    expect(concretePaths(withdraw)).toContain("/api/withdraw/session");
  });

  it("registers every built route, except the ones the ledger records", () => {
    const unregistered = built.filter(route => !registered.has(route.url));
    expect(unregistered.map(route => route.url).sort())
      .toEqual(ledger.builtButNotRegistered.map(known => known.path).sort());
    // The ledger names the file too, so an entry cannot survive the route
    // moving somewhere else.
    for (const known of ledger.builtButNotRegistered) {
      expect(unregistered.find(route => route.url === known.path)?.file).toBe(known.file);
    }
  });

  it("implements a pinned segment as its literals, never as an open segment", () => {
    const open = entries.flatMap(entry => pinnedSegments(entry)
      .filter(segment => built.some(route => route.url === entry.path && entry.path.includes(`[${segment}]`)))
      .map(segment => ({ routeId: entry.id, path: entry.path, segment })));
    expect(open.map(found => `${found.routeId} ${found.path}`).sort())
      .toEqual(ledger.permissiveDynamicSegment.map(known => `${known.routeId} ${known.path}`).sort());
  });

  it("leaves the unbuilt half of the register alone, but still measures it", () => {
    const builtUrls = new Set(built.map(route => route.url));
    const unbuilt = entries.filter(entry => !concretePaths(entry).some(candidate => builtUrls.has(candidate)));
    // A backlog, not a failure. The bound only catches a matcher that broke.
    expect(unbuilt.length).toBeGreaterThan(30);
    expect(unbuilt.length).toBeLessThan(entries.length);
  });
});

/**
 * The endpoint half and the prefix half of the same gate.
 *
 * The block above answers one question: does a URL exist. That is the route
 * half of G8.5, and the brief asks for more than it — "for every route, form
 * endpoint, API handler and storage prefix, its register disposition matches
 * its live behaviour". Two of those were unchecked by anything.
 *
 * The endpoint half. All 88 endpoint entries carry `disposition: "kept"`, so
 * the register says every one of them is live, and each names the contracts
 * that govern it: an `auth` mode, a success response contract, the policy
 * contracts it enforces, and per-method contracts where the verbs differ.
 * `contractDefaults.bindingValidation` states the rule those names are meant
 * to obey — every reference "must resolve to an exact registered key", "every
 * endpoint success contract must also appear in responseContractBindings.
 * routes for that route and every bound response must exist", and "unknown
 * dangling duplicate method incomplete or literal path rebindings fail the
 * register gate". There was no such gate. `scripts/route-gate.ts` compares
 * declared verbs with exported ones and declared kind with built kind; it
 * never asks whether the contracts those verbs are declared under exist. An
 * endpoint naming a response contract that is not defined has no declared
 * success status or body at all, which is the same hole as an unregistered
 * route wearing a register entry.
 *
 * The prefix half. `storagePrefixes` declares 6 prefixes over 4 buckets, each
 * with a path shape, a filename contract, an access rule and, for three of
 * them, retention ids. `scripts/route-gate.ts` checks the bucket names against
 * the buckets migrations create and stops there: nothing compared a prefix
 * with the code that puts bytes under it. So the checks here walk the code for
 * every place that names a Storage bucket, compare that set with the register
 * in both directions, and hold the object-key shapes the register does not
 * describe in a ledger anchored to literal evidence in the files that produce
 * them.
 *
 * What a static walk cannot see, stated rather than assumed: two live call
 * sites choose their bucket from a database manifest at run time, so their
 * bucket is invisible here and the database's own check constraint is
 * compared instead; object keys almost always come from a database column, so
 * a key shape is only visible where a schema, regex or SQL default pins it;
 * and the R2 worker reaches its bucket through an env binding, so no literal
 * exists to find. Each of those is recorded in
 * `docs/register-contract-divergence.json` with what it means, and every list
 * in that file is compared in both directions here — an unlisted divergence
 * fails, and a listed one that no longer reproduces fails too.
 */
const contractLedger = JSON.parse(readFileSync(CONTRACT_LEDGER, "utf8")) as {
  endpointAuthModeWithoutContract: { mode: string; verdict: string; routeIds: string[] }[];
  endpointSuccessContractUndefined: { routeId: string; contract: string }[];
  endpointSuccessContractUnbound: { routeId: string; contract: string }[];
  storageCallSites: { site: string }[];
  declaredPrefixBucketNotAddressed: { bucket: string }[];
  liveCallSiteOnUncreatedBucket: { bucket: string; file: string }[];
  objectKeyShapeNotDescribedByAnyPrefix: {
    id: string;
    bucket: string;
    segments: number;
    declaredPrefixIds: string[];
    declaredSegments: number[];
    evidence: { file: string; literal: string }[];
  }[];
};

function registerDocument(): Register {
  return JSON.parse(readFileSync(REGISTER, "utf8")) as Register;
}

/** A bucket named by a database manifest rather than by a literal in the code. */
const DATABASE_SELECTED = "(database-selected)";

/**
 * Next.js answers HEAD for any route exporting GET, so a contract keyed on
 * HEAD beside a declared GET describes the framework's own behaviour and not
 * an undeclared verb. `scripts/route-gate.ts` reads declared against exported
 * methods under the same rule.
 */
function declarableMethods(entry: Entry): Set<string> {
  const declared = new Set(entry.methods ?? []);
  if (declared.has("GET")) declared.add("HEAD");
  return declared;
}

/** Every response contract an endpoint names as a success, whole-route or per-method. */
function successContracts(entry: Entry): string[] {
  const names: string[] = [];
  if (typeof entry.successResponseContract === "string") names.push(entry.successResponseContract);
  for (const value of Object.values(entry.methodSuccessResponseContracts ?? {})) {
    if (typeof value === "string") names.push(value);
  }
  return [...new Set(names)];
}

/** Every policy contract an entry's `policy` or `methodPolicies` blocks name. */
function policyContractNames(entry: Entry): string[] {
  const blocks: unknown[] = [entry.policy, ...Object.values(entry.methodPolicies ?? {})];
  return blocks.flatMap(block => {
    if (!block || typeof block !== "object") return [];
    const contracts = (block as { contracts?: unknown }).contracts;
    return Array.isArray(contracts) ? contracts.filter((name): name is string => typeof name === "string") : [];
  });
}

/** Everything the repository ships and runs, minus tests and their fixtures. */
function codeFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
      if (/\.(test|spec|fixtures)\./.test(entry.name)) continue;
      found.push(full);
    }
  };
  for (const root of CODE_ROOTS) walk(root);
  return found;
}

/**
 * Every place the code addresses a Storage bucket, as `bucket file`. Both
 * forms count: the client's `storage.from("genomes")` and the REST path
 * `/storage/v1/object/authenticated/genomes/<key>` the server and worker
 * build by hand. A `from()` whose argument is not a literal is recorded as
 * database-selected rather than dropped, because that is exactly the case a
 * static walk would otherwise lose in silence.
 */
function storageCallSites(): string[] {
  const fromCall = /storage\s*\.\s*from\(\s*(?:"([A-Za-z0-9._-]+)"|'([A-Za-z0-9._-]+)')?/g;
  const objectUrl = /\/storage\/v1\/object\/(?:authenticated\/|public\/|sign\/|upload\/sign\/)?([A-Za-z0-9._-]+)(?=[/`'"$\s)])/g;
  const sites = new Set<string>();
  for (const file of codeFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(fromCall)) {
      sites.add(`${match[1] ?? match[2] ?? DATABASE_SELECTED} ${file}`);
    }
    for (const match of source.matchAll(objectUrl)) sites.add(`${match[1]} ${file}`);
  }
  return [...sites].sort();
}

/** The buckets a database row is allowed to name, from the migrations' own check constraints. */
function databaseBucketAllowlist(): { buckets: string[]; constraints: number } {
  // No dot and no `s` flag: the negated classes already span newlines, which
  // they must, because one of the two constraints is written across lines.
  const constraint = /bucket_id\s+text[^,]*?check\s*\(\s*bucket_id\s+in\s*\(([^)]*)\)/gi;
  const buckets = new Set<string>();
  let constraints = 0;
  for (const name of readdirSync(MIGRATIONS).filter(file => file.endsWith(".sql"))) {
    const sql = readFileSync(path.join(MIGRATIONS, name), "utf8");
    for (const match of sql.matchAll(constraint)) {
      constraints += 1;
      for (const literal of match[1].matchAll(/'([^']+)'/g)) buckets.add(literal[1]);
    }
  }
  return { buckets: [...buckets].sort(), constraints };
}

/** The retention ids `docs/retention.md` defines, one per table row. */
function retentionIds(): string[] {
  const table = /^\|\s*`([a-z0-9][a-z0-9.-]*)`\s*\|/gm;
  return [...readFileSync(RETENTION, "utf8").matchAll(table)].map(match => match[1]);
}

/** Both directions at once, the way the route half already compares its ledger. */
function compareBothWays(present: string[], recorded: string[]): void {
  expect([...present].sort()).toEqual([...recorded].sort());
}

describe("the register's endpoint contracts and the endpoints that exist agree", () => {
  const document = registerDocument();
  const built = builtRoutes();
  const byUrl = new Map(built.map(route => [route.url, route]));
  const endpoints = document.routes.filter(entry => entry.kind === "endpoint");
  const contractRegistries = [document.policyContracts, document.policyResolvers, document.lifecycleDispositionContracts];

  it("reads the endpoint half of the register at all, so a passing run is not an empty scan", () => {
    expect(endpoints.length).toBeGreaterThan(80);
    expect(endpoints.every(entry => Array.isArray(entry.methods) && entry.methods.length > 0)).toBe(true);
    expect(Object.keys(document.responseContracts).length).toBeGreaterThan(80);
    expect(Object.keys(document.responseContractBindings.routes).length).toBeGreaterThan(90);
    expect(endpoints.map(entry => entry.id)).toContain("webhooks.resend");
  });

  it("resolves every endpoint auth mode to a defined auth contract, or records why it cannot", () => {
    const modes = [...new Set(endpoints.map(entry => entry.auth ?? ""))];
    const unresolved = modes.filter(mode => {
      const declared = document.contractDefaults[`endpoint:${mode}`];
      return !(typeof declared === "string"
        && declared.startsWith("authContracts.")
        && declared.slice("authContracts.".length) in document.authContracts);
    });
    compareBothWays(unresolved, contractLedger.endpointAuthModeWithoutContract.map(known => known.mode));
    // The ledger names the endpoints on each mode, so a mode gaining or
    // losing users cannot leave a stale entry behind.
    for (const known of contractLedger.endpointAuthModeWithoutContract) {
      expect(endpoints.filter(entry => entry.auth === known.mode).map(entry => entry.id).sort())
        .toEqual([...known.routeIds].sort());
    }
  });

  it("defines the success response contract every endpoint names", () => {
    const undefinedContracts = endpoints.flatMap(entry => successContracts(entry)
      .filter(name => !(name in document.responseContracts))
      .map(name => `${entry.id} ${name}`));
    compareBothWays(undefinedContracts,
      contractLedger.endpointSuccessContractUndefined.map(known => `${known.routeId} ${known.contract}`));
  });

  it("binds every endpoint success contract to its route, as bindingValidation requires", () => {
    const unbound = endpoints.flatMap(entry => successContracts(entry)
      .filter(name => !(document.responseContractBindings.routes[entry.id] ?? []).includes(name))
      .map(name => `${entry.id} ${name}`));
    compareBothWays(unbound,
      contractLedger.endpointSuccessContractUnbound.map(known => `${known.routeId} ${known.contract}`));
  });

  it("binds only real route ids, to responses that exist", () => {
    const ids = new Set(document.routes.map(entry => entry.id));
    const bindings = document.responseContractBindings;
    const bound = Object.entries(bindings.routes);
    expect(bound.filter(([id]) => !ids.has(id)).map(([id]) => id)).toEqual([]);
    expect(bound.flatMap(([id, names]) => names
      .filter(name => !(name in document.responseContracts))
      .map(name => `${id} ${name}`))).toEqual([]);
    expect((bindings.allEndpoints ?? []).filter(name => !(name in document.responseContracts))).toEqual([]);
  });

  it("resolves every policy contract an endpoint enforces", () => {
    const references = endpoints.flatMap(entry => policyContractNames(entry).map(name => `${entry.id} ${name}`));
    // A policy names contracts across three registries; all three are the
    // register's own, and a name in none of them resolves to nothing.
    expect(references.filter(reference => {
      const name = reference.slice(reference.indexOf(" ") + 1);
      return !contractRegistries.some(registry => name in registry);
    })).toEqual([]);
    expect(references.length).toBeGreaterThan(250);
  });

  it("declares a per-method contract only for a method it declares", () => {
    const orphans: string[] = [];
    let checked = 0;
    for (const entry of endpoints) {
      const declared = declarableMethods(entry);
      for (const field of ["methodRequestContracts", "methodSuccessResponseContracts", "methodPolicies"] as const) {
        for (const method of Object.keys(entry[field] ?? {})) {
          checked += 1;
          if (!declared.has(method)) orphans.push(`${entry.id} ${field}.${method}`);
        }
      }
    }
    expect(orphans).toEqual([]);
    expect(checked).toBeGreaterThan(35);
  });

  it("builds a registered endpoint as an endpoint and a registered page as a page", () => {
    const mismatched = document.routes.flatMap(entry => {
      if (entry.kind === "redirect") return [];
      return concretePaths(entry).flatMap(candidate => {
        const implementation = byUrl.get(candidate);
        if (!implementation || implementation.kind === entry.kind) return [];
        return [`${entry.id} ${candidate} declared=${entry.kind} built=${implementation.kind}`];
      });
    });
    compareBothWays(mismatched, ledger.kindDivergence.map(known =>
      `${known.routeId} ${known.path} declared=${known.declaredKind} built=${known.builtKind}`));
    // The ledger names the file too, so an entry cannot survive the route moving.
    for (const known of ledger.kindDivergence) expect(byUrl.get(known.path)?.file).toBe(known.file);
  });

  it("exports at least one HTTP method from every built route file", () => {
    const files = built.filter(route => route.kind === "endpoint").map(route => route.file);
    expect(files.filter(file => exportedMethods(readFileSync(file, "utf8")).length === 0)).toEqual([]);
    expect(files.length).toBeGreaterThan(35);
  });
});

describe("the register's storage prefixes and the buckets the code addresses agree", () => {
  const document = registerDocument();
  const prefixes = document.storagePrefixes;
  const declaredBuckets = new Set(prefixes.map(prefix => prefix.bucket));
  const sites = storageCallSites();
  const addressed = new Set(sites
    .map(site => site.slice(0, site.indexOf(" ")))
    .filter(bucket => bucket !== DATABASE_SELECTED));

  it("walks the code at all, so a passing run is not an empty scan", () => {
    expect(codeFiles().length).toBeGreaterThan(500);
    expect(prefixes.length).toBeGreaterThan(5);
    expect(sites.length).toBeGreaterThan(10);
    expect(sites).toContain("genomes src/lib/uploads/subject-upload-browser.ts");
  });

  it("records every live storage call site with the bucket it names", () => {
    compareBothWays(sites, contractLedger.storageCallSites.map(known => known.site));
  });

  it("declares a prefix for every bucket the code addresses", () => {
    expect([...addressed].filter(bucket => !declaredBuckets.has(bucket)).sort()).toEqual([]);
    compareBothWays([...declaredBuckets].filter(bucket => !addressed.has(bucket)),
      contractLedger.declaredPrefixBucketNotAddressed.map(known => known.bucket));
  });

  it("keeps the database's own bucket allowlist inside the declared set", () => {
    const { buckets, constraints } = databaseBucketAllowlist();
    expect(constraints).toBeGreaterThan(1);
    expect(buckets.length).toBeGreaterThan(3);
    // The two database-selected call sites take their bucket from a manifest
    // this allowlist constrains, so it is the only authority a static walk
    // has for them. An undeclared name here is the same defect the route
    // ledger already records against the migrations that create the bucket.
    compareBothWays(buckets.filter(bucket => !declaredBuckets.has(bucket)),
      ledger.storageBucketDivergence
        .filter(known => known.direction === "created-not-declared")
        .map(known => known.bucket));
  });

  it("addresses no bucket that no migration creates, except the ones recorded", () => {
    const created = new Set(readdirSync(MIGRATIONS)
      .filter(name => name.endsWith(".sql"))
      .flatMap(name => createdBuckets(readFileSync(path.join(MIGRATIONS, name), "utf8"))));
    expect(created.size).toBeGreaterThan(2);
    const live = sites.filter(site => {
      const bucket = site.slice(0, site.indexOf(" "));
      return bucket !== DATABASE_SELECTED && !created.has(bucket);
    });
    compareBothWays(live, contractLedger.liveCallSiteOnUncreatedBucket.map(known => `${known.bucket} ${known.file}`));
  });

  it("resolves every prefix id a storage access or download contract references", () => {
    const referenced = new Set<string>();
    for (const contract of Object.values(document.storageAccessContracts)) {
      for (const id of contract.prefixIds ?? []) referenced.add(id);
    }
    for (const contract of Object.values(document.downloadContracts)) {
      if (!contract || typeof contract !== "object") continue;
      for (const [field, value] of Object.entries(contract)) {
        if (field.endsWith("StoragePrefixId") && typeof value === "string") referenced.add(value);
      }
    }
    // Exact in both directions: a contract pointing at a prefix that does not
    // exist describes access rules over nothing, and a declared prefix no
    // contract reaches is a shape with no access rule at all.
    expect([...referenced].sort()).toEqual(prefixes.map(prefix => prefix.id).sort());
  });

  it("resolves every retention id and policy contract a prefix names", () => {
    const ids = new Set(retentionIds());
    expect(ids.size).toBeGreaterThan(40);
    const referenced = prefixes.flatMap(prefix => [
      ...(prefix.retentionId ? [prefix.retentionId] : []),
      ...(prefix.retentionIds ?? []),
    ].map(id => `${prefix.id} ${id}`));
    expect(referenced.length).toBeGreaterThan(5);
    expect(referenced.filter(reference => !ids.has(reference.slice(reference.indexOf(" ") + 1)))).toEqual([]);
    const registries = [document.policyContracts, document.policyResolvers, document.lifecycleDispositionContracts];
    expect(prefixes.flatMap(prefix => (prefix.contracts ?? [])
      .filter(name => !registries.some(registry => name in registry))
      .map(name => `${prefix.id} ${name}`))).toEqual([]);
  });

  it("records every live object key shape no declared prefix describes", () => {
    expect(contractLedger.objectKeyShapeNotDescribedByAnyPrefix.length).toBeGreaterThan(0);
    for (const known of contractLedger.objectKeyShapeNotDescribedByAnyPrefix) {
      const forBucket = prefixes.filter(prefix => prefix.bucket === known.bucket);
      // The entry pins which prefixes it was measured against and how many
      // segments each declares, so adding a prefix to the bucket, or changing
      // one's shape, forces the entry to be revisited rather than left stale.
      expect(forBucket.map(prefix => prefix.id).sort()).toEqual([...known.declaredPrefixIds].sort());
      expect(forBucket.map(prefix => prefix.prefix.split("/").length)).toEqual(known.declaredSegments);
      expect(known.declaredSegments).not.toContain(known.segments);
      // And the shape is anchored to literal evidence in the files that
      // produce it, so a fix cannot leave the entry behind.
      for (const evidence of known.evidence) {
        expect(`${known.id} ${evidence.file} ${readFileSync(evidence.file, "utf8").includes(evidence.literal)}`)
          .toBe(`${known.id} ${evidence.file} true`);
      }
    }
  });
});
