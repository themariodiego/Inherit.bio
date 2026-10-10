import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { exportedMethods, migrationBuckets } from "./route-gate";

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
 * `/withdraw/[token]` with token in {session} is also, and only,
 * `/withdraw/session`; a two-literal enum expands to both.
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
  builtButNotRegistered: { path: string; file: string; deleteAfter?: string }[];
  permissiveDynamicSegment: { routeId: string; path: string; file: string; deleteAfter?: string }[];
  kindDivergence: { routeId: string; path: string; file: string; declaredKind: string; builtKind: string }[];
  storageBucketDivergence: { bucket: string; direction: string }[];
  unregisteredServerActions: { file: string; export: string; why: string; closing: string }[];
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
    expect(concretePaths(rights)).toEqual(expect.arrayContaining(["/withdraw/[token]", "/withdraw/session"]));
    // Since 2026-09-28 the request literal is its own endpoint entry.
    expect(concretePaths(rights)).not.toContain("/withdraw/request");
    expect(entries.find(entry => entry.path === "/withdraw/request")?.id).toBe("rights.withdraw-request");
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

  /** D-081 is retired after the last pre-cutover invitation expires. Any
   * future temporary divergence still needs a valid deadline and must expire. */
  it("deletes a dated divergence by its date", () => {
    const dated = [...ledger.builtButNotRegistered, ...ledger.permissiveDynamicSegment]
      .filter(known => known.deleteAfter !== undefined);
    expect(dated.map(known => known.path).sort()).toEqual([]);
    expect(built.map(found => found.url)).not.toContain("/api/withdraw");
    expect(built.map(found => found.url)).not.toContain("/withdraw/[token]");
    for (const known of dated) {
      expect(known.deleteAfter, known.path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const due = Date.parse(`${known.deleteAfter}T23:59:59Z`);
      expect(Number.isNaN(due), known.path).toBe(false);
      expect(Date.now() <= due, `${known.path} was due for deletion after ${known.deleteAfter}: delete it and its row`)
        .toBe(true);
    }
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
  nonceStoredBeforeUse: { rpc: string; file: string }[];
  storageCallSites: { site: string }[];
  declaredPrefixBucketNotAddressed: { bucket: string }[];
  liveCallSiteOnUncreatedBucket: { bucket: string; file: string }[];
  allowlistedBucketNotCreated: { bucket: string; droppedBy: string; constraints: string[] }[];
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

  /**
   * A contract that says where a link, redirect or credential lands names a
   * route by `routeFrom` and pins its parameters by `params`. Both must still
   * be true of the route: an id that no longer exists, a parameter the route
   * does not have, or a literal its `parameterContract` no longer allows is a
   * contract pointing at nothing. Added 2026-09-28, when `/withdraw/request`
   * moved to its own entry and five such references moved with it.
   */
  it("resolves every routeFrom to a registered route and every pinned param to a literal it allows", () => {
    const byId = new Map(document.routes.map(entry => [entry.id, entry]));
    const references: { where: string; routeFrom: string; params?: Record<string, unknown> }[] = [];
    const walk = (node: unknown, where: string) => {
      if (Array.isArray(node)) node.forEach((value, index) => walk(value, `${where}/${index}`));
      else if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if (typeof record.routeFrom === "string") {
          references.push({ where, routeFrom: record.routeFrom, params: record.params as Record<string, unknown> | undefined });
        }
        for (const [key, value] of Object.entries(record)) walk(value, `${where}/${key}`);
      }
    };
    walk(document, "");
    expect(references.length).toBeGreaterThan(8);
    const broken: string[] = [];
    for (const reference of references) {
      const target = byId.get(reference.routeFrom);
      if (!target) { broken.push(`${reference.where}: no route ${reference.routeFrom}`); continue; }
      const contract = (target.parameterContract ?? {}) as Record<string, { enum?: unknown[]; const?: unknown }>;
      for (const [param, pinned] of Object.entries(reference.params ?? {})) {
        const segment = contract[param];
        if (!target.path.includes(`[${param}]`)) { broken.push(`${reference.where}: ${reference.routeFrom} has no [${param}]`); continue; }
        const literal = pinned && typeof pinned === "object" ? (pinned as { const?: unknown }).const : undefined;
        if (literal === undefined || !segment) continue;
        const allowed = Array.isArray(segment.enum) ? segment.enum : segment.const !== undefined ? [segment.const] : undefined;
        if (allowed && !allowed.includes(literal)) {
          broken.push(`${reference.where}: ${reference.routeFrom} ${param}=${String(literal)} is not in ${JSON.stringify(allowed)}`);
        }
      }
    }
    expect(broken).toEqual([]);
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
    compareBothWays(buckets.filter(bucket => !declaredBuckets.has(bucket)), [
      ...ledger.storageBucketDivergence
        .filter(known => known.direction === "created-not-declared")
        .map(known => known.bucket),
      // A dropped bucket a constraint still admits (D-130), recorded rather
      // than silently allowed. It must really be dropped, or the row is stale.
      ...contractLedger.allowlistedBucketNotCreated.map(known => known.bucket),
    ]);
    const created = migrationBuckets(MIGRATIONS);
    for (const known of contractLedger.allowlistedBucketNotCreated) {
      expect(created.has(known.bucket), `${known.bucket} is recorded as not created`).toBe(false);
      expect(readFileSync(known.droppedBy, "utf8"), known.droppedBy).toContain(`delete from storage.buckets where id = '${known.bucket}'`);
    }
  });

  it("addresses no bucket that no migration creates, except the ones recorded", () => {
    const created = migrationBuckets(MIGRATIONS);
    // Not an empty scan: the two buckets the migrations leave in place.
    expect([...created]).toEqual(expect.arrayContaining(["exports", "genomes"]));
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

/**
 * Every module that declares a server action, by the directive that makes one.
 *
 * A server action is a live mutation surface the route register cannot
 * describe: Next.js exposes it at a generated endpoint that never appears in
 * the App Router tree, so `builtRoutes()` above cannot see it and none of the
 * route checks apply to it. That is the gap this closes.
 *
 * The match is deliberately generous - the directive anywhere in a shipped
 * module, whichever quotes it uses, top-of-file or inline inside a function.
 * An inline one is precisely the case a top-of-file check would miss, and a
 * false positive costs one ledger row while a false negative loses a mutation
 * entry point.
 */
function serverActionModules(): string[] {
  return codeFiles()
    .filter((file) => /(^|[^\w])["']use server["']/.test(readFileSync(file, "utf8")))
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

describe("every server action is a recorded surface", () => {
  const found = serverActionModules();
  const recorded = ledger.unregisteredServerActions ?? [];

  it("finds the walker's own subject, so a passing run is not an empty scan", () => {
    // If this ever legitimately reaches zero, the ledger empties in the same
    // change and the two assertions below fail first, which is the point.
    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain("src/app/(app)/embryos/acknowledge.ts");
  });

  it("records every server action that exists", () => {
    expect(found.filter((file) => !recorded.some((known) => known.file === file))).toEqual([]);
  });

  it("keeps no row for a server action that is gone", () => {
    expect(recorded.map((known) => known.file).filter((file) => !found.includes(file))).toEqual([]);
  });

  it("names the export it records, and says why it needs no register row", () => {
    for (const known of recorded) {
      const source = readFileSync(known.file, "utf8");
      expect(source).toContain(`export async function ${known.export}`);
      // A row that does not argue its case is a row that was merely added.
      expect(known.why.length).toBeGreaterThan(120);
      expect(known.closing.length).toBeGreaterThan(20);
    }
  });
});

/**
 * Every `<form>` that names where it posts, as `file action`.
 *
 * A form action is a live surface in the plainest sense: a browser submits to
 * it without any of this repository's code running first, so it is held to the
 * register like any other. The eight forms that carry no `action` are
 * submitted by a client handler through `fetch`, which the endpoint checks
 * above already cover.
 *
 * Two shapes exist. A literal is checked against the register directly. An
 * expression is accepted only when it calls `route(`, the typed helper in
 * `src/lib/primary-routes.ts` whose first argument is a `RouteId` - so the
 * register is what resolves it and TypeScript refuses an id not in it. Any
 * other expression is reported rather than assumed, because a static reader
 * cannot tell where it points.
 */
function formActions(): { file: string; action: string; resolved: "literal" | "helper" | "unresolvable" }[] {
  const found: { file: string; action: string; resolved: "literal" | "helper" | "unresolvable" }[] = [];
  for (const file of codeFiles().filter((name) => name.endsWith(".tsx"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<form\b[^>]*?\saction=(?:"([^"]*)"|\{([^}]*)\})/g)) {
      const where = file.split(path.sep).join("/");
      if (match[1] !== undefined) {
        found.push({ file: where, action: match[1], resolved: "literal" });
        continue;
      }
      const expression = (match[2] ?? "").trim();
      found.push({
        file: where,
        action: expression,
        resolved: /\broute\s*\(/.test(expression) ? "helper" : "unresolvable",
      });
    }
  }
  return found.sort((left, right) => `${left.file} ${left.action}`.localeCompare(`${right.file} ${right.action}`));
}

describe("every form posts somewhere the register describes", () => {
  const actions = formActions();
  const registeredPaths = new Set(register().flatMap(concretePaths));
  const recordedPaths = new Set(ledger.builtButNotRegistered.map((known) => known.path));

  it("finds the forms that name a target, so a passing run is not an empty scan", () => {
    expect(actions).toEqual([
      { file: "src/app/(app)/genome/[subject]/data/browser/page.tsx",
        action: 'route("genome.browser", subjectParams)', resolved: "helper" },
      { file: "src/components/site/app-shell.tsx", action: "/auth/sign-out", resolved: "literal" },
    ]);
    expect(actions.some((form) => form.resolved === "literal")).toBe(true);
    expect(actions.some((form) => form.resolved === "helper")).toBe(true);
  });

  it("points every literal action at a registered route, or at a recorded one", () => {
    const stray = actions
      .filter((form) => form.resolved === "literal")
      .filter((form) => !registeredPaths.has(form.action) && !recordedPaths.has(form.action))
      .map((form) => `${form.file} ${form.action}`);
    expect(stray).toEqual([]);
  });

  it("leaves no form or ledger exception for the retired bare withdrawal endpoint", () => {
    expect(actions.some((form) => form.action === "/api/withdraw")).toBe(false);
    expect(registeredPaths.has("/api/withdraw")).toBe(false);
    expect(recordedPaths.has("/api/withdraw")).toBe(false);
  });

  it("accepts a computed action only when the register is what resolves it", () => {
    expect(actions.filter((form) => form.resolved === "unresolvable")).toEqual([]);
  });
});

type FormSubmission = { file: string; routeId: string | null; method: "GET" | "POST" | null };

/**
 * Native forms default to GET. Submit controls can override both action and
 * method, including controls associated by a literal `form` id. Read JSX
 * attributes rather than an opening-tag regex so order, quotes and braces do
 * not hide a method. Unresolved expressions, spreads and duplicate attributes
 * require review; an invalid method is not silently accepted as browser GET.
 */
function nativeFormSubmissions(source: string, file: string, entries: Entry[]): FormSubmission[] {
  const document = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  type Attribute = { present: boolean; value: string | ts.Expression | null };
  const attribute = (opening: ts.JsxOpeningLikeElement, name: string): Attribute => {
    const attributes = opening.attributes.properties;
    const named = attributes.filter((property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText(document) === name);
    if (!named.length) return { present: false, value: null };
    if (attributes.some(ts.isJsxSpreadAttribute) || named.length > 1) return { present: true, value: null };
    const initializer = named[0].initializer;
    if (initializer && ts.isStringLiteral(initializer)) return { present: true, value: initializer.text };
    const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
    if (expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))) {
      return { present: true, value: expression.text };
    }
    return { present: true, value: expression ?? null };
  };
  const target = ({ value }: Attribute): string | null => {
    if (typeof value === "string") return entries.find(entry => concretePaths(entry).includes(value))?.id ?? null;
    if (value && ts.isCallExpression(value) && ts.isIdentifier(value.expression)
      && value.expression.text === "route" && value.arguments[0] && ts.isStringLiteral(value.arguments[0])) {
      const id = value.arguments[0].text;
      return entries.find(entry => entry.id === id)?.id ?? null;
    }
    return null;
  };
  const method = (value: Attribute, inherited: FormSubmission["method"]): FormSubmission["method"] => {
    if (!value.present) return inherited;
    const literal = typeof value.value === "string" ? value.value.toUpperCase() : null;
    return literal === "GET" || literal === "POST" ? literal : null;
  };
  const forms = new Map<ts.JsxOpeningLikeElement, FormSubmission>();
  const ids = new Map<string, FormSubmission | null>();
  const collect = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let submission: FormSubmission | null = null;
      if (node.tagName.getText(document) === "form") {
        const spread = node.attributes.properties.some(ts.isJsxSpreadAttribute);
        submission = { file, routeId: target(attribute(node, "action")),
          method: spread ? null : method(attribute(node, "method"), "GET") };
        forms.set(node, submission);
      }
      const id = attribute(node, "id").value;
      if (typeof id === "string") ids.set(id, ids.has(id) ? null : submission);
    }
    ts.forEachChild(node, collect);
  };
  collect(document);
  const found: FormSubmission[] = [];
  const walk = (node: ts.Node, owner?: FormSubmission) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const spread = opening.attributes.properties.some(ts.isJsxSpreadAttribute);
      if (forms.has(opening)) {
        owner = forms.get(opening);
        found.push(owner!);
      } else if (attribute(opening, "formMethod").present || attribute(opening, "formAction").present
        || (spread && (owner?.routeId || attribute(opening, "form").present)
          && ["button", "input", "Button", "Input"].includes(opening.tagName.getText(document)))) {
        const association = attribute(opening, "form");
        const associated = association.present
          ? typeof association.value === "string" ? ids.get(association.value) : null : owner;
        const action = attribute(opening, "formAction");
        found.push({ file, routeId: spread || !associated ? null : action.present ? target(action) : associated.routeId,
          method: spread ? null : method(attribute(opening, "formMethod"), associated?.method ?? null) });
      }
      if (ts.isJsxElement(node)) node.children.forEach(child => walk(child, owner));
      return;
    }
    ts.forEachChild(node, child => walk(child, owner));
  };
  walk(document);
  return found;
}

function formMethodIssues(submissions: FormSubmission[], entries: Entry[]): string[] {
  return submissions.flatMap(submission => {
    const entry = entries.find(candidate => candidate.id === submission.routeId);
    if (!entry) return [`${submission.file}: unresolved form target`];
    if (!submission.method) return [`${submission.file}: unsupported or unresolved form method`];
    const allowed = entry.kind === "page" ? ["GET"] : entry.methods ?? [];
    return allowed.includes(submission.method) ? [] : [`${submission.file}: ${entry.id} does not allow ${submission.method}`];
  });
}

type ClientFormReview = { file: string; forms: number; sha256: string };

/**
 * These existing actionless client forms cancel default submission in their
 * attached handlers. Their current-page targets remain unresolved here. Seal
 * the explicit review to the complete source bytes and exact opening count;
 * merely adding onSubmit is never an exemption. JS-disabled/hydration behavior
 * and dynamically rendered interiors still need their own runtime evidence.
 */
const CLIENT_FORM_REVIEW: ClientFormReview[] = [
  { file: "src/components/auth/auth-form.tsx", forms: 1, sha256: "150e3548289b39b7f3eb9f0988c2803a76d56209346ad18e9962288cf218261f" },
  { file: "src/components/chat/chat-panel.tsx", forms: 1, sha256: "77759a6b209673bef9ea9c5ca46e031a03e1cfb7a73f7e9e437ca519eb1dfdd1" },
  { file: "src/components/chat/own-chat-panel.tsx", forms: 1, sha256: "ac2fc16c32ab1cb0bf127422937df7753d8408e2ee233badb38b599c9c5bc882" },
  { file: "src/components/embryo/co-parent-review-form.tsx", forms: 1, sha256: "8dcca90eb9444fa99ad954852df12f5fb406f62847a04d1280561befe9b7093b" },
  { file: "src/components/embryo/invitation-refusal-form.tsx", forms: 1, sha256: "d1d5e36f18b1299ea3c21a6ef0369487250d5f2e0cae5c693486833d309ff6a3" },
  { file: "src/components/family/invite-adult-form.tsx", forms: 1, sha256: "1866d5e668f9069c0d94a2aa8c8d3f8e55ccd341403a029915fb39d8ac8e04d7" },
  { file: "src/components/settings/jurisdiction-form.tsx", forms: 1, sha256: "995f24840ae8e802a2f4d6b8be1c0ce3dbe804dfa75fc9b62a64572395c8fe6c" },
  { file: "src/components/settings/llm-settings-form.tsx", forms: 1, sha256: "7b669b559f7db5b0fe391bd39ce8095a33bd8c37cd80d37e06d138ec0d55f45b" },
  { file: "src/components/uploads/other-adult-upload-card.tsx", forms: 2, sha256: "1ab2652e70ddca9ed64966a10dbf557244f4e31c3a0390dd631f5a9265c84137" },
  { file: "src/components/uploads/own-upload-flow.tsx", forms: 1, sha256: "f78a81339439a1b91840e7138ad560055d61d618f788715d1fb0651f73a7fede" },
  { file: "src/components/uploads/path-b-request-form.tsx", forms: 1, sha256: "0002fe0e675e8f4634b43bd92476f6d5672d62139f7b11924b31d099d2e2e280" },
];

function clientFormReviewIssues(submissions: FormSubmission[], reviews: ClientFormReview[], source: (file: string) => string): string[] {
  const implicit = submissions.filter(form => form.routeId === null);
  const issues = implicit.filter(form => form.method !== "GET" || !reviews.some(review => review.file === form.file))
    .map(form => `${form.file}: unreviewed implicit or unresolved form`);
  for (const review of reviews) {
    if (implicit.filter(form => form.file === review.file).length !== review.forms) issues.push(`${review.file}: reviewed client form count changed`);
    if (createHash("sha256").update(source(review.file)).digest("hex") !== review.sha256) issues.push(`${review.file}: reviewed client form source changed`);
  }
  return issues;
}

describe("native form methods match their registered targets", () => {
  const entries = register();
  const sample: Entry[] = [
    { id: "genome.browser", path: "/genome/[subject]/data/browser", kind: "page" },
    { id: "auth.sign-out", path: "/auth/sign-out", kind: "endpoint", methods: ["POST"] },
  ];
  const read = (source: string) => nativeFormSubmissions(source, "sample.tsx", sample);
  const issues = (source: string) => formMethodIssues(read(source), sample);

  it("checks the unchanged GET genome form and POST sign-out against the whole current register", () => {
    const all = codeFiles().filter(file => file.endsWith(".tsx"))
      .flatMap(file => nativeFormSubmissions(readFileSync(file, "utf8"), file, entries));
    expect(clientFormReviewIssues(all, CLIENT_FORM_REVIEW, file => readFileSync(file, "utf8"))).toEqual([]);
    expect(all).toHaveLength(14);
    const submissions = all.filter(form => form.routeId !== null);
    expect(submissions).toEqual([
      { file: "src/app/(app)/genome/[subject]/data/browser/page.tsx", routeId: "genome.browser", method: "GET" },
      { file: "src/components/site/app-shell.tsx", routeId: "auth.sign-out", method: "POST" },
    ]);
    expect(formMethodIssues(submissions, entries)).toEqual([]);
  });

  it("defaults an omitted native method to GET and refuses it on a POST-only endpoint", () => {
    expect(read('<form action={route("genome.browser", subjectParams)} />')[0].method).toBe("GET");
    expect(issues('<form action={route("genome.browser", subjectParams)} />')).toEqual([]);
    expect(issues('<form action="/auth/sign-out" />')).toEqual(["sample.tsx: auth.sign-out does not allow GET"]);
  });

  it("refuses explicit GET on sign-out and POST on the genome page", () => {
    expect(issues('<form method="get" action="/auth/sign-out" />')).toEqual(["sample.tsx: auth.sign-out does not allow GET"]);
    expect(issues('<form action={route("genome.browser", subjectParams)} method="post" />'))
      .toEqual(["sample.tsx: genome.browser does not allow POST"]);
  });

  it("reads static JSX strings and both quote styles without depending on attribute order", () => {
    expect(issues("<form method={'PoSt'} action='/auth/sign-out' />")).toEqual([]);
    expect(read('<form method={`GET`} action={route("genome.browser", subjectParams)} />')[0].method).toBe("GET");
  });

  it("refuses unsupported, empty and dialog methods instead of assuming a registered request", () => {
    for (const method of ["PUT", "DELETE", "", " post ", "dialog"]) {
      expect(issues(`<form action="/auth/sign-out" method="${method}" />`), method)
        .toEqual(["sample.tsx: unsupported or unresolved form method"]);
    }
  });

  it("refuses computed methods and action expressions the static reader cannot resolve", () => {
    expect(issues('<form action="/auth/sign-out" method={verb} />')).toEqual(["sample.tsx: unsupported or unresolved form method"]);
    expect(issues('<form action={destination} method="post" />')).toEqual(["sample.tsx: unresolved form target"]);
    expect(issues('<form action={route("missing", params)} method="get" />')).toEqual(["sample.tsx: unresolved form target"]);
    expect(issues('<form action={enabled ? route("genome.browser", params) : other} />')).toEqual(["sample.tsx: unresolved form target"]);
  });

  it("refuses form spreads and duplicate methods that could replace the visible method", () => {
    expect(issues('<form {...props} />')).toEqual(["sample.tsx: unresolved form target"]);
    expect(issues('<form action="/auth/sign-out" method="post" {...props} />')).toEqual(["sample.tsx: unresolved form target"]);
    expect(issues('<form action="/auth/sign-out" method="post" method="get" />'))
      .toEqual(["sample.tsx: unsupported or unresolved form method"]);
    for (const control of ["button", "input", "Button", "Input"]) {
      expect(issues(`<form action="/auth/sign-out" method="post"><${control} {...props} /></form>`))
        .toEqual(["sample.tsx: unresolved form target"]);
    }
  });

  it("checks button and input method overrides against the inherited form target", () => {
    for (const control of ['<button formMethod="get" />', '<input type="submit" formMethod="get" />', '<Button formMethod="get" />']) {
      expect(issues(`<form action="/auth/sign-out" method="post">${control}</form>`))
        .toEqual(["sample.tsx: auth.sign-out does not allow GET"]);
    }
    expect(issues('<form action="/auth/sign-out" method="post"><button formMethod="post" /></form>')).toEqual([]);
    expect(issues('<form action="/auth/sign-out" method="post"><button formMethod={verb} /></form>'))
      .toEqual(["sample.tsx: unsupported or unresolved form method"]);
  });

  it("uses submitter action overrides together with the effective inherited or overridden method", () => {
    expect(issues('<form action={route("genome.browser", params)}><button formAction="/auth/sign-out" /></form>'))
      .toEqual(["sample.tsx: auth.sign-out does not allow GET"]);
    expect(issues('<form action={route("genome.browser", params)}><button formAction="/auth/sign-out" formMethod="post" /></form>')).toEqual([]);
  });

  it("resolves explicit same-file form owners and refuses unknown, computed or duplicated owners", () => {
    const form = '<form id="logout" action="/auth/sign-out" method="post" />';
    expect(issues(`<>${form}<button form="logout" formMethod="get" /></>`)).toEqual(["sample.tsx: auth.sign-out does not allow GET"]);
    expect(issues(`<>${form}<button form="logout" formMethod="post" /></>`)).toEqual([]);
    expect(issues(`<>${form}<button form="logout" {...props} /></>`)).toEqual(["sample.tsx: unresolved form target"]);
    for (const owner of ['"missing"', '{owner}']) {
      expect(issues(`<>${form}<button form=${owner} formMethod="post" /></>`)).toEqual(["sample.tsx: unresolved form target"]);
      expect(issues(`<>${form}<button form=${owner} formAction="/auth/sign-out" formMethod="post" /></>`))
        .toEqual(["sample.tsx: unresolved form target"]);
    }
    expect(issues(`<>${form}${form}<button form="logout" formMethod="post" /></>`)).toEqual(["sample.tsx: unresolved form target"]);
  });

  it("accounts for every missing-action form without assuming its current-page destination", () => {
    for (const form of ['<form />', '<form method="post" />', '<form onSubmit={handler} />']) {
      expect(read(form)).toHaveLength(1);
      expect(issues(form)).toEqual(["sample.tsx: unresolved form target"]);
    }
    expect(issues('<form method="post"><button formAction="/auth/sign-out" formMethod="post" /></form>'))
      .toEqual(["sample.tsx: unresolved form target"]);
  });

  it("refuses an explicit form owner id shared with a non-form element in either source order", () => {
    const form = '<form id="logout" action="/auth/sign-out" method="post" />';
    const control = '<button form="logout" formMethod="post" />';
    for (const markup of [`<div id="logout" />${form}`, `${form}<div id="logout" />`]) {
      expect(issues(`<>${markup}${control}</>`)).toEqual(["sample.tsx: unresolved form target"]);
    }
  });

  it("admits implicit client forms only through exact reviewed counts and complete handler bytes", () => {
    const source = '<form onSubmit={event => { event.preventDefault(); }} />';
    const reviews = [{ file: "sample.tsx", forms: 1, sha256: createHash("sha256").update(source).digest("hex") }];
    expect(clientFormReviewIssues(read(source), reviews, () => source)).toEqual([]);
    const changed = source.replace("preventDefault", "stopPropagation");
    expect(clientFormReviewIssues(read(changed), reviews, () => changed)).toEqual(["sample.tsx: reviewed client form source changed"]);
    const added = `<>${source}<form method="post" /></>`;
    expect(clientFormReviewIssues(read(added), reviews, () => added)).toContain("sample.tsx: unreviewed implicit or unresolved form");
    expect(clientFormReviewIssues([], reviews, () => source)).toEqual(["sample.tsx: reviewed client form count changed"]);
    expect(clientFormReviewIssues(read(source), [], () => source)).toEqual(["sample.tsx: unreviewed implicit or unresolved form"]);
  });
});

/**
 * Brief X1.5 (owner decision 2026-09-28): an operation nonce is rendered by
 * the page that offers the operation, only the state-changing request consumes
 * it, and no GET creates, rotates or stores one. A nonce stored ahead of use
 * leaves a trace a static walk can find: a call to a database function named
 * `issue_*nonce*`, or a write to `account_operation_nonces`. Every such site is
 * compared, in both directions, with `nonceStoredBeforeUse` in
 * `docs/register-contract-divergence.json`.
 */
/** Every trace, in one file's source, of a nonce stored ahead of use. */
function nonceStoreSites(source: string, file: string): string[] {
  const found = [...source.matchAll(/\.rpc\(\s*["'`](issue_[a-z0-9_]*nonce[a-z0-9_]*)["'`]/gu)].map(match => `${match[1]} ${file}`);
  if (/from\(\s*["'`]account_operation_nonces["'`]\s*\)\s*\.(?:insert|upsert)\(/u.test(source)) found.push(`account_operation_nonces ${file}`);
  return found;
}

describe("no request stores an operation nonce before the request that spends it", () => {
  const files = codeFiles();
  const sites = files.flatMap(file => nonceStoreSites(readFileSync(file, "utf8"), file));

  /**
   * The ledger is empty since 2026-09-28, so a passing run could also be a
   * scan that sees nothing. It is not: it reads the shipped code, and its
   * pattern finds both shapes of the two sites X1.5 removed.
   */
  it("reads shipped code and would find a stored nonce, so an empty result means none", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/lib/uploads/prepare-own-upload.ts");
    expect(nonceStoreSites('await admin.rpc("issue_own_upload_nonce_v1", {', "a.ts")).toEqual(["issue_own_upload_nonce_v1 a.ts"]);
    expect(nonceStoreSites("createAdminClient().rpc(\n  'issue_account_operation_nonce_v1', {", "b.ts"))
      .toEqual(["issue_account_operation_nonce_v1 b.ts"]);
    expect(nonceStoreSites('admin.from("account_operation_nonces").insert({})', "c.ts")).toEqual(["account_operation_nonces c.ts"]);
    expect(nonceStoreSites('admin.from("account_operation_nonces").select("*")', "d.ts")).toEqual([]);
  });

  it("stores no nonce ahead of use except where the ledger records it", () => {
    compareBothWays([...new Set(sites)], contractLedger.nonceStoredBeforeUse.map(known => `${known.rpc} ${known.file}`));
  });

  it("renders the account-deletion nonce: no GET on either deletion route, and nothing issues one", () => {
    for (const file of ["src/app/api/account/delete/route.ts", "src/app/api/account/delete/cancel/route.ts"]) {
      expect(exportedMethods(readFileSync(file, "utf8")), file).toEqual(["POST"]);
    }
    expect(sites.filter(site => site.startsWith("issue_account_operation_nonce") || site.startsWith("account_operation_nonces"))).toEqual([]);
    expect(readFileSync("src/app/(app)/settings/data/page.tsx", "utf8")).toContain("deletionControlState()");
  });
});
