import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { exportedMethods, migrationBuckets } from "./route-gate";
import { storageBucketsInSource, UNRESOLVED_STORAGE_BUCKET } from "./storage-contract-census";

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
 * yet; none of them remain unbuilt after the native appeal review, notice,
 * auth, mapping, subject-sharing and subjects (G2.1) routes, the one-record
 * subject export, the correction-review and claimant export (G2.1) routes,
 * the two bound-claimant routes, the rights-session export, the subject
 * delete door and the subject transfer route, and the consent and rights
 * routes (G2.1, "Build all 24"). A redirect that `next.config.ts` serves
 * counts as built.
 * The exact current count prevents a broken walker from passing silently.
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
  unregisteredServerActions: { file: string; export: string; why: string; closing: string; hostedBy?: string[]; correction?: string }[];
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

  it("leaves the unbuilt half of the register alone, but still measures it", async () => {
    const builtUrls = new Set(built.map(route => route.url));
    // A registered redirect can be served by `next.config.ts` instead of a page
    // file. Those redirects run before the App Router. `scripts/route-gate.ts`
    // checks the status each one emits against the register, so the walk above
    // cannot see them, yet they are built. Only an unconditional redirect from
    // the exact registered path counts, and only for a redirect entry.
    const config = (await import("../next.config")).default as { redirects?: () => Promise<{ source: string; has?: unknown }[]> };
    const configured = new Set((await config.redirects?.() ?? []).filter(redirect => redirect.has === undefined)
      .map(redirect => redirect.source));
    const unbuilt = entries.filter(entry => !concretePaths(entry).some(candidate => builtUrls.has(candidate)
      || (entry.kind === "redirect" && configured.has(candidate))));
    // The four native appeal/evidence endpoints reduce the remaining backlog,
    // and the reviewed claimant DELETE (api.future-person-delete) reduces it again.
    // The three reviewed auth endpoints (auth.sign-up-submit,
    // auth.forgot-password-submit, auth.reset-password-submit; owner decision
    // 2026-10-16) reduce it from 26 to 23, and the laboratory-table mapping
    // route (api.embryo-ingest-mapping, ADR 0037) reduces it once more, to 22.
    // The UUID-addressed sharing twin (api.subject-sharing; owner decision
    // 2026-10-16, "The subjects endpoints (G2.1)") reduces it to 21, and three
    // more subjects endpoints, api.subjects, api.legal-evidence-upload-session
    // and api.subject-download, reduce it to 18. Counting the redirects
    // `next.config.ts` serves as built removes legacy.signup and legacy.login,
    // which were always built there, so 16 remain. api.subject-export (owner
    // decision 2026-10-16, "Subject export with joint results: built in two
    // steps") reduces it to 15: the one-record export ships first and refuses,
    // with the stated reason jointResults, while the record has live joint
    // results. The named correction review
    // (api.future-person-correction-review) and the claimant export
    // (api.future-person-export; owner decision 2026-10-16, "Unbuilt
    // registered endpoints (G2.1)") reduce it to 13. The two bound-claimant
    // endpoints, api.claimed-subject-analysis-stop and
    // api.claimed-subject-correction, are built to answer
    // resource-not-found-v1 until the binding release (owner decision
    // 2026-10-22, "Consent, rights and claim endpoints (G2.1)"), and the
    // rights-session export api.third-party-subject-export is built to answer
    // resource-not-found-v1 in both its subject and cohort cases until their
    // producers exist (the same decision), so 10 remain. The subject delete
    // door (api.subject-delete, the decisions "The subjects endpoints (G2.1)"
    // and Q6) reduces it to 9, and the transfer route (api.subject-transfer,
    // the same decision and "Subjects delete and transfer: four further
    // cases"; its door is built closed) reduces it to 8.
    // The consent and rights endpoints (G2.1, "Build all 24"; owner decision
    // 2026-10-22) lower it from 8, one for each endpoint this slice builds:
    // api.consents-revoke-all to 7; api.embryo-record-key-cards-rights,
    // built closed until its session issuer exists, to 6;
    // api.consent-revoke-rights and api.consent-grant-rights, closed until an
    // adult-subject-control issuer exists, to 5 and 4; api.consent-reaffirm,
    // which re-runs an own-subject self grant or an adult directional grant
    // whose text was superseded, to 3; its no-account twin
    // api.consent-reaffirm-rights, built closed until its session issuer and
    // notice wording exist, to 2; api.adult-subject-bind, built closed until
    // an adult-subject-control issuer and the binding notice wording exist, to
    // 1; and api.rights-reissue, whose lookup, limits, candidate and
    // activation exchange are built behind a door kept shut until the
    // recovery mail wording is approved, to 0.
    // Keep the exact census: new implementations require an explicit review.
    expect(unbuilt.length).toBe(0);
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
 * The prefix half. `storagePrefixes` declares 7 prefixes over 4 buckets (6
 * until 2026-11-19, when `storage.prepared-v1` was registered), each with a
 * path shape, a filename contract, an access rule and, for four of them,
 * retention ids. `scripts/route-gate.ts` checks the bucket names against
 * the buckets migrations create and stops there: nothing compared a prefix
 * with the code that puts bytes under it. So the checks here walk the code for
 * every place that names a Storage bucket, compare that set with the register
 * in both directions, and hold the object-key shapes the register does not
 * describe in a ledger anchored to literal evidence in the files that produce
 * them.
 *
 * What a static walk cannot see, stated rather than assumed: three live call
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
  consentWithdrawalNotRegistered: {
    kind: string;
    why: string;
    closing: string;
    closedBy: string;
    evidence: { file: string; literal: string }[];
  }[];
};

function registerDocument(): Register {
  return JSON.parse(readFileSync(REGISTER, "utf8")) as Register;
}

/** Retained ledger spelling; an unresolved expression is not proof of its provider. */
const DATABASE_SELECTED = UNRESOLVED_STORAGE_BUCKET;

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
 * build by hand. Exact local immutable string constants and explicit named
 * import/export aliases resolve without loading a module. Every unresolved
 * bucket retains the historical database-selected ledger spelling rather
 * than being dropped; that spelling does not establish its actual provider.
 */
function storageCallSites(sources: ReadonlyMap<string, string> = new Map(codeFiles()
  .map(file => [file, readFileSync(file, "utf8")] as const))): string[] {
  const sites = new Set<string>();
  for (const [file, source] of sources) {
    for (const bucket of storageBucketsInSource(source, file, sources)) sites.add(`${bucket} ${file}`);
  }
  return [...sites].sort();
}

describe("storage call-site extraction", () => {
  it("reads the bucket of SDK and REST metadata calls without inventing an info bucket", () => {
    expect(storageBucketsInSource([
      'client.storage.from("exports").info(key)',
      '`/storage/v1/object/info/exports/${key}`',
    ].join("\n"))).toEqual(["exports"]);
    expect(storageBucketsInSource([
      'client.storage.from(ARCHIVE_BUCKET).info(key)',
      '`/storage/v1/object/info/${ARCHIVE_BUCKET}/${key}`',
      '`/storage/v1/object/${ARCHIVE_BUCKET}/${key}`',
    ].join("\n"))).toEqual([DATABASE_SELECTED]);
  });

  it("retains unknown literal buckets, dynamic buckets and every existing REST operation", () => {
    expect(storageBucketsInSource('client.storage.from("unregistered-bucket").info(key)'))
      .toEqual(["unregistered-bucket"]);
    // A genuine SDK bucket named info still counts; only the REST operation
    // segment is excluded from bucket classification.
    expect(storageBucketsInSource('client.storage.from("info").download(key)')).toEqual(["info"]);
    for (const operation of ["", "authenticated/", "public/", "sign/", "upload/sign/", "info/"]) {
      expect(storageBucketsInSource("`/storage/v1/object/" + operation + "unregistered-bucket/${key}`"))
        .toEqual(["unregistered-bucket"]);
      expect(storageBucketsInSource("`/storage/v1/object/" + operation + "${bucket}/${key}`"))
        .toEqual([DATABASE_SELECTED]);
    }
    expect(storageBucketsInSource('client.storage.from(bucket).remove(keys)')).toEqual([DATABASE_SELECTED]);
    expect(storageBucketsInSource('client.info(key)')).toEqual([]);
  });

  it("resolves immutable local strings and named import/export aliases for SDK and REST key producers", () => {
    const sources = new Map([
      ["src/lib/provider.ts", 'const LOCAL = "unregistered-bucket"; export { LOCAL as BUCKET };'],
      ["src/lib/alias.ts", 'export { BUCKET as STORED_BUCKET } from "./provider";'],
      ["src/lib/keys.ts", 'export function key(id: string) { return `unregistered-prefix/${id}`; }'],
      ["src/app/api/planted/route.ts", [
        'import { STORED_BUCKET as selected } from "@/lib/alias";',
        'import { key as produceKey } from "@/lib/keys";',
        'const bucket = selected as const;',
        'client.storage.from(bucket).upload(produceKey(id), bytes);',
        '`/storage/v1/object/info/${bucket}/${produceKey(id)}`;',
        '`/storage/v1/object/` + bucket + `/` + produceKey(id);',
      ].join("\n")],
    ]);
    expect(storageCallSites(sources)).toEqual(["unregistered-bucket src/app/api/planted/route.ts"]);
    expect(contractLedger.storageCallSites.map(site => site.site))
      .not.toContain("unregistered-bucket src/app/api/planted/route.ts");
    expect(registerDocument().storagePrefixes.map(prefix => prefix.bucket)).not.toContain("unregistered-bucket");
  });

  it("reads an imported constant REST prefix through its exact local alias", () => {
    const sources = new Map([
      ["src/lib/urls.ts", 'export const URL_PREFIX = "/storage/v1/object/public/new-provider/";'],
    ]);
    expect(storageBucketsInSource('import { URL_PREFIX as prefix } from "./urls"; fetch(prefix + key);',
      "src/lib/caller.ts", sources)).toEqual(["new-provider"]);
    expect(storageBucketsInSource('const bucket = ("new-" + "provider") as const; client["storage"]["from"](bucket).upload(key, bytes);'))
      .toEqual(["new-provider"]);
  });

  it.each([
    'import { BUCKET } from "./missing"; client.storage.from(BUCKET).upload(key, bytes);',
    'import { BUCKET } from "provider-package"; client.storage.from(BUCKET).upload(key, bytes);',
    'import * as provider from "./provider"; client.storage.from(provider.BUCKET).upload(key, bytes);',
    'let BUCKET = "exports"; client.storage.from(BUCKET).upload(key, bytes);',
    'const BUCKET = getBucket(); client.storage.from(BUCKET).upload(key, bytes);',
    'const BUCKET = "exports"; function write(BUCKET: string) { client.storage.from(BUCKET).upload(key, bytes); }',
    'const BUCKET = "exports"; const write = function BUCKET() { client.storage.from(BUCKET).upload(key, bytes); };',
    'const BUCKET = "exports"; BUCKET = other; client.storage.from(BUCKET).upload(key, bytes);',
    'client.storage[method]("exports").upload(key, bytes);',
    '`/storage/v1/object/info/${getBucket()}/${key}`;',
    '`/storage/v1/object/${"prefix-" + getBucket()}/${key}`;',
  ])("retains a census refusal for an unresolved or dynamic producer: %s", source => {
    expect(storageBucketsInSource(source)).toEqual([DATABASE_SELECTED]);
  });

  it("does not guess through mutable, duplicate, wildcard, cyclic or ambiguous exported providers", () => {
    const caller = 'import { BUCKET as bucket } from "./provider"; client.storage.from(bucket).upload(key, bytes);';
    for (const provider of ['export let BUCKET = "exports";', 'export const BUCKET = "exports"; export { BUCKET };',
      'export * from "./leaf";', 'export { BUCKET } from "./cycle";']) {
      expect(storageBucketsInSource(caller, "src/caller.ts", new Map([
        ["src/provider.ts", provider], ["src/leaf.ts", 'export const BUCKET = "exports";'],
        ["src/cycle.ts", 'export { BUCKET } from "./provider";'],
      ]))).toEqual([DATABASE_SELECTED]);
    }
    expect(storageBucketsInSource(caller, "src/caller.ts", new Map([
      ["src/provider.ts", 'export const BUCKET = "exports";'],
      ["src/provider.tsx", 'export const BUCKET = "genomes";'],
    ]))).toEqual([DATABASE_SELECTED]);
  });

  it("records a new unresolved imported provider at its actual file instead of dropping it", () => {
    expect(storageCallSites(new Map([["src/new-key-producer.ts",
      'import { BUCKET } from "unresolved-provider"; client.storage.from(BUCKET).upload(makeKey(), bytes);']])))
      .toEqual([`${DATABASE_SELECTED} src/new-key-producer.ts`]);
    expect(contractLedger.storageCallSites.map(site => site.site)).not.toContain(`${DATABASE_SELECTED} src/new-key-producer.ts`);
  });

  it("keeps oversized REST producers visible when bounded string resolution refuses", () => {
    expect(storageBucketsInSource(JSON.stringify(`/storage/v1/object/new-provider/${"x".repeat(4096)}`)))
      .toEqual([DATABASE_SELECTED]);
  });
});

/**
 * The buckets a database row is allowed to name now, from the migrations' own
 * check constraints, read in the order the migrations apply. A column check
 * in a `create table` carries the name PostgreSQL gives it,
 * `<table>_bucket_id_check`; a later `add constraint <name> check (bucket_id
 * in (...)` replaces the constraint of that name, and a `drop constraint`
 * that nothing re-adds removes it. So a check a migration tightened is read
 * as tightened, and a literal only a superseded definition held no longer
 * counts. `before` stops the walk at the first file not sorting below it.
 */
function databaseBucketAllowlist(directory = MIGRATIONS, before?: string): {
  buckets: string[]; constraints: number; columnChecks: number; createdColumnChecks: number;
} {
  // No dot and no `s` flag: the negated classes already span newlines, which
  // they must, because several of these constraints are written across lines.
  const columnCheck = /bucket_id\s+text[^,]*?check\s*\(\s*bucket_id\s+in\s*\(([^)]*)\)/gi;
  const created = /create\s+table\s+(?:\w+\.)?(\w+)\s*\([^;]*?\bbucket_id\s+text[^,]*?check\s*\(\s*bucket_id\s+in\s*\(([^)]*)\)/gi;
  const added = /add\s+constraint\s+(\w+)\s+check\s*\(\s*bucket_id\s+in\s*\(([^)]*)\)/gi;
  const dropped = /drop\s+constraint\s+(?:if\s+exists\s+)?(\w+)/gi;
  const literals = (list: string) => [...list.matchAll(/'([^']+)'/g)].map(literal => literal[1]);
  const current = new Map<string, string[]>();
  let columnChecks = 0;
  let createdColumnChecks = 0;
  const files = readdirSync(directory).filter(file => file.endsWith(".sql")).sort()
    .filter(file => before === undefined || file < before);
  for (const name of files) {
    const sql = readFileSync(path.join(directory, name), "utf8");
    columnChecks += [...sql.matchAll(columnCheck)].length;
    const events: { at: number; apply: () => void }[] = [];
    for (const match of sql.matchAll(created)) {
      createdColumnChecks += 1;
      events.push({ at: match.index, apply: () => current.set(`${match[1]}_bucket_id_check`, literals(match[2])) });
    }
    for (const match of sql.matchAll(added)) {
      events.push({ at: match.index, apply: () => current.set(match[1], literals(match[2])) });
    }
    for (const match of sql.matchAll(dropped)) {
      events.push({ at: match.index, apply: () => current.delete(match[1]) });
    }
    for (const event of events.sort((left, right) => left.at - right.at)) event.apply();
  }
  return {
    buckets: [...new Set([...current.values()].flat())].sort(),
    constraints: current.size,
    columnChecks,
    createdColumnChecks,
  };
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
    expect(sites).toContain("legal-evidence src/lib/future-person/claim-objects.ts");
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
    const { buckets, constraints, columnChecks, createdColumnChecks } = databaseBucketAllowlist();
    // Not an empty scan: the bucket checks of the three tables a Storage
    // manifest is built from, each at its latest definition, and every column
    // check the walk saw was tied to the table that declares it.
    expect(constraints).toBe(3);
    expect(buckets).toEqual(["genomes", "legal-evidence"]);
    expect(createdColumnChecks).toBe(columnChecks);
    expect(columnChecks).toBeGreaterThan(1);
    // The three database-selected call sites take their bucket from a manifest
    // this allowlist constrains, so it is the only authority a static walk
    // has for them. An undeclared name here is the same defect the route
    // ledger already records against the migrations that create the bucket.
    compareBothWays(buckets.filter(bucket => !declaredBuckets.has(bucket)), [
      ...ledger.storageBucketDivergence
        .filter(known => known.direction === "created-not-declared")
        .map(known => known.bucket),
      // A dropped bucket a constraint still admits, recorded rather than
      // silently allowed. It must really be dropped, or the row is stale.
      ...contractLedger.allowlistedBucketNotCreated.map(known => known.bucket),
    ]);
    const created = migrationBuckets(MIGRATIONS);
    for (const known of contractLedger.allowlistedBucketNotCreated) {
      expect(created.has(known.bucket), `${known.bucket} is recorded as not created`).toBe(false);
      expect(readFileSync(known.droppedBy, "utf8"), known.droppedBy).toContain(`delete from storage.buckets where id = '${known.bucket}'`);
    }
  });

  it("reads each bucket check at its latest definition, in migration order", () => {
    // D-130: until 20261119110000 the checks still admitted both dropped
    // buckets, so a walk that stops before it must still see them.
    const before = databaseBucketAllowlist(MIGRATIONS, "20261119110000");
    expect(before.constraints).toBe(3);
    expect(before.buckets).toEqual(["generated-artifacts", "genomes", "genomes-staging", "legal-evidence"]);
    const directory = mkdtempSync(path.join(tmpdir(), "bucket-allowlist-"));
    try {
      writeFileSync(path.join(directory, "1_create.sql"), "create table public.kept (\n  id uuid,\n"
        + "  bucket_id text not null check (bucket_id in ('a', 'dropped')),\n  note text\n);\n"
        + "create table public.gone (\n  bucket_id text not null check (bucket_id in ('b'))\n);\n"
        + "create table public.other (id uuid);");
      writeFileSync(path.join(directory, "2_tighten.sql"), "alter table public.kept\n"
        + "  drop constraint kept_bucket_id_check,\n  add constraint kept_bucket_id_check check (bucket_id in ('a')\n"
        + "   or bucket_id ~ '^x$');\nalter table public.gone drop constraint gone_bucket_id_check;");
      expect(databaseBucketAllowlist(directory, "2")).toEqual(
        { buckets: ["a", "b", "dropped"], constraints: 2, columnChecks: 2, createdColumnChecks: 2 });
      expect(databaseBucketAllowlist(directory)).toEqual(
        { buckets: ["a"], constraints: 1, columnChecks: 2, createdColumnChecks: 2 });
      // Within one file, statement order decides: added then dropped is gone.
      writeFileSync(path.join(directory, "3_same_file.sql"), "alter table public.kept\n"
        + "  add constraint kept_bucket_id_check check (bucket_id in ('late'));\n"
        + "alter table public.kept drop constraint kept_bucket_id_check;");
      expect(databaseBucketAllowlist(directory).constraints).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
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

  /**
   * 2026-11-19 (owner decision "G8.5: the two undescribed genomes key shapes";
   * engineering chose the documents). The two genomes shapes the ledger above
   * recorded, the flat <uuid> key and prepared/<uuid>, are described now, so
   * their genomes rows are gone. This holds what those rows proved from the
   * other side: each key shape the code writes into genomes is described by
   * the prefix named here, with the same number of segments and the same
   * literal folder and no account or subject folder the code does not write,
   * and each is anchored to the writer that produces it. A writer that changes
   * its key, or a prefix that stops matching it, fails here.
   */
  it("describes every genomes key shape the code writes, anchored to the code that writes it", () => {
    const written: { prefixId: string; segments: number; folder: string | null; evidence: { file: string; literal: string }[] }[] = [
      // Staging and final keys of every self and other_adult file, and the subject-transfer relocation's new key.
      { prefixId: "storage.subject-v2", segments: 1, folder: null, evidence: [
        { file: "supabase/migrations/20260930125000_own_upload_allowance_excludes_embryo.sql",
          literal: " values(p_account_id,p_session_id,p_subject_id,gen_random_uuid()::text,p_size_bytes,p_sha256," },
        { file: "supabase/migrations/20260928150000_other_adult_held_upload.sql",
          literal: "final_object_name=gen_random_uuid(),finalization_started_at=clock_timestamp()" },
        { file: "supabase/migrations/20260831224054_storage_and_download_sessions.sql",
          literal: "check (object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')," },
        { file: "src/lib/uploads/subject-finalization.ts", literal: 'bucket: z.literal("genomes"), stagingKey: uuid, finalKey: uuid,' },
        { file: "supabase/migrations/20261016221000_subject_transfer.sql",
          literal: "new_object_key text check (new_object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')," },
      ] },
      // Prepared artifacts on a Supabase v1 receipt.
      { prefixId: "storage.prepared-v1", segments: 2, folder: "prepared", evidence: [
        { file: "supabase/migrations/20260908164616_own_preparation_job_authority.sql",
          literal: "object_key text not null unique default ('prepared/'||gen_random_uuid()::text)" },
        { file: "src/lib/genome/prepared-source/storage-common.ts", literal: "/^prepared\\/[0-9a-f]{8}-" },
      ] },
      // The names the database reserves in genomes for embryo ingest fragments; the cohort path writes no flat key.
      { prefixId: "storage.cohort-v2", segments: 4, folder: null, evidence: [
        { file: "supabase/migrations/20260905203457_embryo_ingest_unwind_runtime.sql",
          literal: "new.object_name:=s.account_id::text||'/'||s.cohort_id::text||'/'||s.upload_id::text||'/'||new.object_id::text||v_suffix;" },
      ] },
    ];
    const genomes = prefixes.filter(prefix => prefix.bucket === "genomes");
    for (const shape of written) {
      const prefix = genomes.find(candidate => candidate.id === shape.prefixId);
      expect(prefix, shape.prefixId).toBeDefined();
      const segments = prefix!.prefix.split("/");
      expect(segments.length, shape.prefixId).toBe(shape.segments);
      expect(segments.filter(segment => !/^\{[a-z_]+\}$/u.test(segment)), shape.prefixId).toEqual(shape.folder ? [shape.folder] : []);
      for (const evidence of shape.evidence) {
        expect(readFileSync(evidence.file, "utf8").includes(evidence.literal), `${shape.prefixId} ${evidence.file}: ${evidence.literal}`).toBe(true);
      }
    }
    // Every other genomes prefix is closed to new writes, so no shape the code writes is left to it.
    expect(genomes.filter(prefix => !written.some(shape => shape.prefixId === prefix.id))
      .map(prefix => `${prefix.id} ${(prefix as Prefix & { newWrites?: string }).newWrites}`)).toEqual(["storage.raw-legacy forbidden"]);
    // And no genomes row is left in the ledger: the one object key shape still recorded is the R2 home of the same artifacts.
    expect(contractLedger.objectKeyShapeNotDescribedByAnyPrefix.filter(known => known.bucket === "genomes")).toEqual([]);
  });
});

/**
 * 2026-11-19 (owner decision "G8.5: the register names where each kind of
 * consent is withdrawn"). api.consent-revoke lists eleven kinds in
 * `dispositionCases` and itself resolves only two tables, so the register now
 * names, in `policy.withdrawalRoutes.cases`, the routes that withdraw each
 * kind today and the database door each of those routes calls. The decision
 * says a kind with no way to be withdrawn goes back to the owner rather than
 * being papered over, so every kind the register does not name is a row of
 * `docs/register-contract-divergence.json#consentWithdrawalNotRegistered`,
 * compared here in both directions: a kind that gains a route fails until its
 * row is removed, and a kind dropped from the map fails until it is recorded.
 */
describe("the register names where each kind of consent is withdrawn, and the ledger every kind it does not", () => {
  type Case = { routes: string[]; doors: string[]; how: string };
  const document = registerDocument();
  const entry = document.routes.find(route => route.id === "api.consent-revoke")!;
  const policy = entry.policy as { dispositionCases: Record<string, string>;
    withdrawalRoutes: { registeredBy: string; basis: string; cases: Record<string, Case> } };
  const kinds = Object.keys(policy.dispositionCases);
  const named = policy.withdrawalRoutes.cases;
  const open = contractLedger.consentWithdrawalNotRegistered;
  const shipped = codeFiles().filter(file => file.split(path.sep)[0] === "src").map(file => readFileSync(file, "utf8"));

  it("reads the eleven kinds and the map at all, so a passing run is not an empty scan", () => {
    expect(kinds).toHaveLength(11);
    expect(Object.keys(named).length).toBeGreaterThan(5);
    expect(policy.withdrawalRoutes.registeredBy).toBe("owner-decision-2026-11-19-G8.5-the-register-names-where-each-kind-of-consent-is-withdrawn");
  });

  it("names only kinds dispositionCases declares, and records every kind it does not name, in both directions", () => {
    expect(Object.keys(named).filter(kind => !kinds.includes(kind))).toEqual([]);
    compareBothWays(kinds.filter(kind => !(kind in named)), open.map(row => row.kind));
  });

  it("names registered routes, each with a database door that shipped code calls by name", () => {
    const ids = new Set(document.routes.map(route => route.id));
    for (const [kind, each] of Object.entries(named)) {
      expect(each.routes.filter(id => !ids.has(id)), kind).toEqual([]);
      expect(new Set(each.routes).size, kind).toBe(each.routes.length);
      for (const door of each.doors) {
        expect(shipped.some(source => source.includes(`"${door}"`)), `${kind}: ${door} is called by no shipped module`).toBe(true);
      }
      expect(each.how.length, kind).toBeGreaterThan(60);
    }
    // The one kind no route withdraws is the one that cannot be given yet, and it says so.
    const none = Object.entries(named).filter(([, each]) => each.routes.length === 0);
    expect(none.map(([kind]) => kind)).toEqual(["consent.embryo-donor-attribution-by-the-current-donor-subject-principal"]);
    expect(none[0]![1].doors).toEqual([]);
    expect(none[0]![1].how).toMatch(/^none-because-the-consent-cannot-be-given-yet/u);
    expect(readFileSync("src/lib/embryos/routes.ts", "utf8")).toContain('return ["identified_donor_attribution_unavailable"];');
    // api.consent-revoke itself resolves exactly the tables the map's basis names: since 2026-11-19 (owner decision
    // "A non-parent uploader's withdrawal for an embryo upload stops analysis and deletes, as they signed") a third,
    // consent_signatures, for the one signature kind the basis names, which the route checks after reading it.
    const revoke = readFileSync("src/app/api/consents/[id]/revoke/route.ts", "utf8");
    expect(revoke.match(/admin\.from\("([a-z_]+)"\)/gu)).toEqual(['admin.from("purpose_grants")', 'admin.from("consent_grants")',
      'admin.from("consent_signatures")']);
    expect(revoke).toContain('signature.artifact_key === "consent.upload-embryo"');
    expect(revoke).toContain('signature.purpose === "embryo-upload-uploader-class"');
    expect(policy.withdrawalRoutes.basis).toContain("a-public.consent_signatures-row-that-is-a-consent.upload-embryo-signature-of-purpose-embryo-upload-uploader-class");
  });

  it("says why each unnamed kind has no registered route, who decides, and anchors it to the code", () => {
    for (const row of open) {
      expect(row.closedBy, row.kind).toBe("owner");
      expect(row.why.length, row.kind).toBeGreaterThan(300);
      expect(row.closing.length, row.kind).toBeGreaterThan(60);
      expect(row.evidence.length, row.kind).toBeGreaterThan(0);
      for (const evidence of row.evidence) {
        expect(readFileSync(evidence.file, "utf8").includes(evidence.literal), `${row.kind} ${evidence.file}: ${evidence.literal}`).toBe(true);
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
 *
 * Since 23 October 2026 the product has none (owner decision, G8.5): the one
 * there was, `acknowledgeEmbryoGate`, is the registered route
 * `api.embryo-acknowledge`. The assertions below hold that at zero, and the
 * planted modules prove the walker would still see one.
 */
function serverActionModulesIn(sources: ReadonlyMap<string, string>): string[] {
  return [...sources]
    .filter(([, source]) => /(^|[^\w])["']use server["']/.test(source))
    .map(([file]) => file)
    .sort();
}

function shippedSources(): Map<string, string> {
  return new Map(codeFiles().map(file => [file.split(path.sep).join("/"), readFileSync(file, "utf8")] as const));
}

/**
 * The deleted module, kept as a fixture so the planted defects below plant
 * exactly what used to ship (src/app/(app)/embryos/acknowledge.ts at
 * 287a1408, its header comment omitted).
 */
const FORMER_ACTION_FILE = "src/app/(app)/embryos/acknowledge.ts";
const FORMER_ACTION = [
  '"use server";',
  "",
  'import { cookies } from "next/headers";',
  'import { currentAuthSessionId, embryoGateCookie } from "@/lib/embryos/tier2";',
  'import { createClient } from "@/lib/supabase/server";',
  "",
  "export async function acknowledgeEmbryoGate(): Promise<{ ok: boolean }> {",
  "  const supabase = await createClient();",
  "  const {",
  "    data: { user },",
  "  } = await supabase.auth.getUser();",
  "  if (!user) return { ok: false };",
  "  const sessionId = await currentAuthSessionId();",
  "  if (!sessionId) return { ok: false };",
  "  const store = await cookies();",
  "  store.set(embryoGateCookie(user.id, sessionId));",
  "  return { ok: true };",
  "}",
  "",
].join("\n");

describe("every server action is a recorded surface", () => {
  const sources = shippedSources();
  const found = serverActionModulesIn(sources);
  const recorded = ledger.unregisteredServerActions ?? [];

  it("walks the shipped code at all, so a passing run is not an empty scan", () => {
    expect(sources.size).toBeGreaterThan(1000);
    expect([...sources.keys()].some(file => file.startsWith("src/app/(app)/embryos/"))).toBe(true);
  });

  it("finds no server action in the product, and the ledger records none", () => {
    expect(found).toEqual([]);
    expect(recorded).toEqual([]);
    expect(existsSync(FORMER_ACTION_FILE)).toBe(false);
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

  it("fails on a planted server action, top-of-file or inline, whichever quotes it uses", () => {
    const planted = new Map(sources);
    planted.set(FORMER_ACTION_FILE, FORMER_ACTION);
    planted.set("src/components/planted-inline.tsx",
      "export function Planted() {\n  async function save() {\n    'use server';\n    return 1;\n  }\n  return <form action={save} />;\n}\n");
    const plantedFound = serverActionModulesIn(planted);
    expect(plantedFound).toEqual([FORMER_ACTION_FILE, "src/components/planted-inline.tsx"]);
    // Each is a module no ledger row records, so "records every server action that exists" fails.
    expect(plantedFound.filter((file) => !recorded.some((known) => known.file === file))).toEqual(plantedFound);
  });
});

/**
 * The same surface, counted by action rather than by file (G8.5, 23 October
 * 2026). The block above records which modules carry the directive, so a
 * second exported action added to a recorded module, or a function with an
 * inline directive inside a recorded component, passes it. Next.js makes
 * every export of a "use server" module, and every function whose body opens
 * with the directive, its own POST entry point: the installed 16.3.3
 * `action-handler.js` forwards an action id posted to ANY App Router page to
 * a worker that holds it (`selectWorkerForForwarding`), refuses a mismatched
 * Origin and lets a request with no Origin through with a warning. So each
 * action is counted by name, the registered pages that render it are pinned,
 * and the one property that makes an unregistered action defensible - it
 * writes nothing durable - is enforced rather than asserted.
 */
function serverActionsIn(source: string, file: string): string[] {
  const document = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const directive = (statements: readonly ts.Statement[]) => {
    for (const statement of statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
      if (statement.expression.text === "use server") return true;
    }
    return false;
  };
  const names: string[] = [];
  if (directive(document.statements)) {
    const exported = (node: ts.Node) => ts.canHaveModifiers(node)
      && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    for (const statement of document.statements) {
      if (ts.isFunctionDeclaration(statement) && exported(statement)) names.push(statement.name?.text ?? "default");
      if (ts.isVariableStatement(statement) && exported(statement)) {
        for (const declaration of statement.declarationList.declarations) names.push(declaration.name.getText(document));
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.push(element.name.text);
      }
      if (ts.isExportAssignment(statement)) names.push("default");
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && "body" in node && node.body && ts.isBlock(node.body as ts.Node)
      && directive((node.body as ts.Block).statements)) {
      const named = (node as ts.FunctionLikeDeclaration).name;
      const holder = node.parent && ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(document) : null;
      names.push(`${named?.getText(document) ?? holder ?? "(anonymous)"} (inline)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(document);
  return [...new Set(names)].sort();
}

/** Every shipped server action, as `file export`. */
function serverActionCensus(sources: ReadonlyMap<string, string>): string[] {
  return [...sources].flatMap(([file, source]) => /["']use server["']/.test(source)
    ? serverActionsIn(source, file).map(name => `${file} ${name}`) : []).sort();
}

/** The registered pages that import an action from its module, by register id. */
function serverActionHosts(actionFile: string, exportName: string, sources: ReadonlyMap<string, string>, entries: Entry[]): string[] {
  const target = actionFile.replace(/\.(ts|tsx|js|mjs)$/, "");
  const hosts = new Set<string>();
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      if (!match[1].split(",").some(name => name.trim().split(/\s+as\s+/)[0] === exportName)) continue;
      const specifier = match[2];
      const resolved = specifier.startsWith("@/") ? `src/${specifier.slice(2)}`
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (resolved !== target) continue;
      const page = /^src\/app\/(.*\/)?(page|layout)\.(tsx|ts|jsx|js)$/.exec(file);
      if (!page) { hosts.add(file); continue; }
      const url = `/${(page[1] ?? "").split("/").filter(segment => segment && !/^\(.*\)$/.test(segment)).join("/")}`;
      hosts.add(entries.find(entry => entry.path === url)?.id ?? url);
    }
  }
  return [...hosts].sort();
}

/**
 * What an unregistered action may not do. The ledger's reason for leaving an
 * action out of the register is that it writes nothing durable and carries no
 * authority a route would gate; a database call, a Storage call, an outbound
 * request or a service-role client is exactly the thing that would make it a
 * register endpoint instead.
 */
const DURABLE_EFFECT = /\.(?:rpc|from|insert|upsert|update)\s*\(|\.storage\b|\bfetch\s*\(|createAdminClient|localStorage|sessionStorage/;

describe("every server action is recorded by name, with the pages that render it and what it may write", () => {
  const sources = shippedSources();
  const recorded = ledger.unregisteredServerActions ?? [];
  const entries = register();

  it("counts every action, not only every module, in both directions", () => {
    expect(serverActionCensus(sources)).toEqual(recorded.map(known => `${known.file} ${known.export}`).sort());
    expect(serverActionCensus(sources)).toEqual([]);
  });

  it("pins the registered pages that render each action, in both directions", () => {
    for (const known of recorded) {
      expect(serverActionHosts(known.file, known.export, sources, entries), known.export).toEqual([...(known.hostedBy ?? [])].sort());
      // Each host is a registered page, so the POST it now also answers is on a route the register names.
      for (const host of known.hostedBy ?? []) expect(entries.find(entry => entry.id === host)?.kind, host).toBe("page");
    }
    // The three pages that rendered the former action import it no more.
    expect(serverActionHosts(FORMER_ACTION_FILE, "acknowledgeEmbryoGate", sources, entries)).toEqual([]);
  });

  it("keeps each unregistered action free of durable writes, so its reason for having no register row stays true", () => {
    for (const known of recorded) {
      expect(DURABLE_EFFECT.test(sources.get(known.file) ?? ""), known.file).toBe(false);
      expect(known.correction ?? "", known.file).toMatch(/selectWorkerForForwarding/);
    }
  });

  it("fails on a planted action, a planted second export, an inline action and a durable write", () => {
    const planted = new Map(sources);
    planted.set(FORMER_ACTION_FILE, FORMER_ACTION);
    // One planted action is already a census the ledger does not match.
    expect(serverActionCensus(planted)).toEqual([`${FORMER_ACTION_FILE} acknowledgeEmbryoGate`]);
    expect(serverActionCensus(planted)).not.toEqual(recorded.map(known => `${known.file} ${known.export}`).sort());
    planted.set(FORMER_ACTION_FILE, `${FORMER_ACTION}\nexport async function forgetEmbryoGate() { return { ok: true }; }\n`);
    expect(serverActionCensus(planted)).toEqual([
      `${FORMER_ACTION_FILE} acknowledgeEmbryoGate`,
      `${FORMER_ACTION_FILE} forgetEmbryoGate`,
    ]);
    planted.set("src/app/(app)/planted/page.tsx",
      'export default function Page() {\n  async function save() {\n    "use server";\n    return 1;\n  }\n  return <form action={save} />;\n}\n');
    expect(serverActionCensus(planted)).toContain("src/app/(app)/planted/page.tsx save (inline)");
    // The file-level walk above would also have caught the inline one, but not the second export.
    expect(serverActionCensus(planted).filter(entry => entry.startsWith(FORMER_ACTION_FILE))).toHaveLength(2);
    expect(DURABLE_EFFECT.test(FORMER_ACTION.replace("store.set(", 'await createAdminClient().rpc("record_gate_v1", {}); store.set('))).toBe(true);
    expect(DURABLE_EFFECT.test(FORMER_ACTION)).toBe(false);
  });

  it("finds every page that renders a planted action, and loses a host that stops", () => {
    const planted = new Map(sources);
    planted.set(FORMER_ACTION_FILE, FORMER_ACTION);
    planted.set("src/app/(app)/embryos/page.tsx", `import { acknowledgeEmbryoGate } from "./acknowledge";\n${sources.get("src/app/(app)/embryos/page.tsx")}`);
    planted.set("src/app/(app)/copilot/[scope]/page.tsx",
      `import { acknowledgeEmbryoGate } from "../../embryos/acknowledge";\n${sources.get("src/app/(app)/copilot/[scope]/page.tsx")}`);
    expect(serverActionHosts(FORMER_ACTION_FILE, "acknowledgeEmbryoGate", planted, entries))
      .toEqual(["copilot.scope", "embryos.index"]);
    planted.delete("src/app/(app)/copilot/[scope]/page.tsx");
    expect(serverActionHosts(FORMER_ACTION_FILE, "acknowledgeEmbryoGate", planted, entries)).toEqual(["embryos.index"]);
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
function formActions(planted: Record<string, string> = {}): { file: string; action: string; resolved: "literal" | "helper" | "unresolvable" }[] {
  const found: { file: string; action: string; resolved: "literal" | "helper" | "unresolvable" }[] = [];
  for (const file of [...codeFiles().filter((name) => name.endsWith(".tsx")), ...Object.keys(planted)]) {
    const source = planted[file] ?? readFileSync(file, "utf8");
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
    // G8.5 (2026-10-23): sign-out became a scripted form with no action
    // (src/components/site/sign-out-form.tsx), so the app-shell's literal
    // "/auth/sign-out" action, the one literal in the tree, is gone.
    expect(actions).toEqual([
      { file: "src/app/(app)/genome/[subject]/data/browser/page.tsx",
        action: 'route("genome.browser", subjectParams)', resolved: "helper" },
    ]);
    expect(actions.some((form) => form.resolved === "helper")).toBe(true);
    // The literal reading is still exercised: a planted native form is read as one.
    expect(formActions({ "src/components/planted-native-form.tsx": '<form action="/auth/sign-out" method="post" />' }))
      .toContainEqual({ file: "src/components/planted-native-form.tsx", action: "/auth/sign-out", resolved: "literal" });
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

// The guarded embryo/future-person flows add ten client-handled forms. Keep
// their complete-source review separate so the original fourteen-form
// inventory remains checked alongside the complete integrated inventory.
// G8.5 (2026-10-23): upload-stage.tsx (cohort finalize) and
// embryo-disposition.tsx re-reviewed after their request gained the route's
// one-time X-Inherit-CSRF header and its rotation. The same forms, handlers,
// preventDefault before any field is read, and targets.
// G8.5 (2026-11-19): both re-reviewed after that request moved into its
// token chain (`csrf.send((csrfToken) => fetch(...))`), which sends a page's
// requests to one route one at a time. The same forms, handlers,
// preventDefault, targets, headers and bodies.
// G8.5 stage two (2026-11-19): draft-form.tsx, signing-form.tsx, upload-stage.tsx
// (the invitation form) and future-person-profile.tsx re-reviewed after each
// request moved onto its route's one-time session token, sent through the
// route's token chain, and its operation value moved to its own header
// (X-Inherit-Operation-Nonce, or X-Inherit-Operation-Proof for the profile's
// derived proof), where X-Inherit-CSRF carried it. The same forms, handlers,
// preventDefault before any field is read, targets and bodies.
// G8.5, the migration stage (2026-11-19): upload-stage.tsx (the finalize form
// keeps the upload session's first tokens from X-Inherit-Upload-CSRF for the
// file step), claim-review.tsx and keyless-pending-review.tsx (each decision
// sends the reviewer's one-time token for its route through the route's chain,
// from the page's provider, where it sent the case digest the GET returned)
// and owner-objection.tsx (the page's token for the route, rights or account,
// through its chain, where it sent the digest the page passed in) re-reviewed.
// The same forms, handlers, preventDefault, targets and bodies.
const GUARDED_FLOW_CLIENT_FORM_REVIEW: ClientFormReview[] = [
  { file: "src/components/embryo/upload/draft-form.tsx", forms: 1, sha256: "c87e9fb89d7259b4b71a45e70a73c3e369af82accc4b47b950cd21073a824879" },
  { file: "src/components/embryo/upload/signing-form.tsx", forms: 1, sha256: "8c19943823fd5bd495751f5eeeb2c483ab791ac3ec15e82a07468c1cb52243d1" },
  { file: "src/components/embryo/upload/upload-stage.tsx", forms: 2, sha256: "ae1a1ac781cc16e376c2f1ff4135538b4518fc14be63eb1fd8cf3065ec5eb85f" },
  { file: "src/components/future-person/claim-form.tsx", forms: 1, sha256: "15879dd96632b930bcaf494fc2f47cabd9b75bddfc328ab104bc8610be10fbdb" },
  { file: "src/components/future-person/claim-review.tsx", forms: 1, sha256: "b524c7e3b6f72ad0dd43e8938e8e121c21240a9465526466ab8a4179f2c0b0fe" },
  { file: "src/components/future-person/keyless-pending-review.tsx", forms: 1, sha256: "3ceb0acc71fa3dd42ac3ac62afcf017a993715236d66c0b5e96dfc9a5e14bc8f" },
  { file: "src/components/future-person/owner-objection.tsx", forms: 1, sha256: "5cb7ce68d4e6c20fafe8d23dfa1c2eccc30a5c3570adb5bca6e7dbd8aa3052c9" },
  { file: "src/components/settings/embryo-disposition.tsx", forms: 1, sha256: "87acb08033b37e93db3859b1bb94883418cf41b3a115afc595f3eae35b51c5d9" },
  { file: "src/components/settings/future-person-profile.tsx", forms: 1, sha256: "20c943b89db53cc30fb0afde17897d3fc6b9c89c571d5ef05bce49b4112cf250" },
];

// These two published TEST-only intake forms cancel native submission before
// reading their fields and send JSON to their separate registered POST doors.
// Bind the complete sources and opening counts; keep the original core census.
// G8.5 (2026-11-19): correction-request.tsx re-reviewed after its request
// moved from the claimant page's keyed digest to api.future-person-correction's
// one-time session token, read from the page's CsrfProvider and sent through
// its token chain. The same form, handler, preventDefault, target and body.
const FUTURE_INTAKE_CLIENT_FORM_REVIEW: ClientFormReview[] = [
  { file: "src/components/future-person/appeal-intake-form.tsx", forms: 1, sha256: "dccc4b01bedb410696e2e69113041fa7e59224ce79055ebdd4b60fa71c267d2f" },
  { file: "src/components/future-person/correction-request.tsx", forms: 1, sha256: "bc638aacc9ccd4dd2c85729d58d56ae04cd158a0622d28b09ad9443f2a87bfcf" },
];

/**
 * These existing actionless client forms cancel default submission in their
 * attached handlers. Their current-page targets remain unresolved here. Seal
 * the explicit review to the complete source bytes and exact opening count;
 * merely adding onSubmit is never an exemption. JS-disabled/hydration behavior
 * and dynamically rendered interiors still need their own runtime evidence.
 */
const CLIENT_FORM_REVIEW: ClientFormReview[] = [
  // G8.5 (2026-10-23): chat-panel, own-chat-panel, co-parent-review-form,
  // invitation-refusal-form, invite-adult-form, jurisdiction-form,
  // llm-settings-form, other-adult-upload-card and path-b-request-form were
  // re-reviewed after each request gained its route's one-time X-Inherit-CSRF
  // header and rotation (the chat panel through its transport's headers and
  // forwarding fetch). Each keeps the same forms, handler, preventDefault and
  // target; no body changed. sign-out-form.tsx is new: sign-out moved from
  // the app shell's native form to one actionless form whose onSubmit cancels
  // native submission and posts with the token.
  // G8.5 (2026-11-19): sign-out-form, own-chat-panel, co-parent-review-form,
  // invitation-refusal-form, invite-adult-form, jurisdiction-form,
  // llm-settings-form and path-b-request-form re-reviewed after each request
  // moved into its route's token chain (`csrf.send((csrfToken) => fetch(...))`),
  // which sends a page's requests to one route one at a time. Each keeps the
  // same forms, handler, preventDefault, target, headers and body.
  { file: "src/components/site/sign-out-form.tsx", forms: 1, sha256: "ecfa0a19f543c66ed45d59dd2533e891855143ac6ec3028510991344221ec48a" },
  // G2.5 (2026-10-22): re-reviewed after the submit control became the forest
  // outline variant at the same 44px and content width. One actionless form,
  // the same fieldset, handler and preventDefault before any field is read.
  { file: "src/components/auth/auth-form.tsx", forms: 1, sha256: "80e1bf6cabad3769c0613561fd8c942f417a024ae8e0f831402b023470f9e8a8" },
  // G8.5 (2026-10-24): the compatibility panel (src/components/chat/chat-panel.tsx)
  // is retired with its api.chat branch, so its review is removed. The own panel
  // is re-reviewed after it gained the ChatProviderInfo type the retired panel
  // exported: still one actionless form whose onSubmit handler cancels native
  // submission before anything is sent, the same composer and target, api.chat.
  // G8.5 (2026-11-20, Copilot for another adult's record): re-reviewed after the
  // panel's scope kind and its history check admit "subject" beside "self",
  // "family" and "cohort" (was 9aef9697…). The form, its handler, preventDefault,
  // target, headers and body are unchanged.
  { file: "src/components/chat/own-chat-panel.tsx", forms: 1, sha256: "ccced9a6326ca35bffeaadbd6d2abb306927fa697d7f72e5d61da4d3d008d4d2" },
  { file: "src/components/embryo/co-parent-review-form.tsx", forms: 1, sha256: "3d53c662bcf1d25f9c27b7658a5495c981e8e5cf8d0669494a29542dd1495b16" },
  { file: "src/components/embryo/invitation-refusal-form.tsx", forms: 1, sha256: "03e69daa6adbc9d39d555015d2b3a328fb42cddc2a5d6f16cbe48076bb5a0338" },
  // G5.6 (2026-10-23): both re-reviewed after their request gained the page's
  // one-time operation nonce in the X-Inherit-Operation-Nonce header, and the
  // form or its section a data-operation-nonce attribute. Still one actionless
  // form each, the same handler cancelling native submission, the same target.
  // G8.5 (2026-10-23): re-reviewed after the invitation moved to the registered
  // Path A body (contactEmail, kind "adult", no adultAttestation) and branches on
  // the registered 403, and after the merge added the one-time X-Inherit-CSRF
  // header. Still one actionless form, the same handler cancelling native
  // submission before any field is read, the same target.
  { file: "src/components/family/invite-adult-form.tsx", forms: 1, sha256: "3d9320f3d0454196553540ad4e98e252efda2f467c2452ea6f49ce8dcfc24b6b" },
  { file: "src/components/settings/jurisdiction-form.tsx", forms: 1, sha256: "77fed8d97f299a82f26ce7e85dab915d854408a61b00a01cfb40470b3cfdb8c7" },
  // G8.5 (2026-10-23): re-reviewed after the save moved to the registered
  // bodies by mode and the removal button gained the page's one-time nonce, and
  // after the merge added the one-time X-Inherit-CSRF header to both requests.
  // Still one actionless form whose onSubmit handler cancels native submission
  // first; the same target, and the removal is still a button outside it.
  { file: "src/components/settings/llm-settings-form.tsx", forms: 1, sha256: "ed910610b21eaa0f3ff2369cef31499a9828c2e8c4acfeabba9481d4c4f95b72" },
  // G2.1 (2026-10-16): re-reviewed after the new-person form gained the
  // reviewed-document flow choice (two radio inputs inside the same form, the
  // same handler and target) and ConsentFields became an export. Still two
  // actionless forms whose onSubmit handlers cancel native submission.
  // G8.5 stage two (2026-11-19): re-reviewed after its three requests moved
  // onto their routes' one-time session tokens through their token chains
  // (api.subject-drafts, api.consents, api.invitations), the draft nonce and
  // the request-send token into X-Inherit-Operation-Nonce, and the signature's
  // presentation token into the body alone. Still two actionless forms whose
  // onSubmit handlers cancel native submission; the same targets and bodies.
  // 2026-11-19 (owner decision "An uploader's withdrawal for another adult's
  // file deletes it, unless that adult holds the record themselves"):
  // re-reviewed after the held and ready cards gained the withdrawal control
  // (OtherAdultWithdrawal, no form) as their last child and a withdrawn card
  // that shows only its receipt. The two forms, their handlers, fields,
  // targets and bodies are unchanged.
  { file: "src/components/uploads/other-adult-upload-card.tsx", forms: 2, sha256: "830f26d0dc60617563b71e6804b6929fd7aa1ceec54d7c5ad0a85564b529e358" },
  // G7.4 (2026-10-22): re-reviewed after the flow gained the server-decided
  // `readCalling` prop it passes to both Uploader renders (ADR 0038). Still one
  // actionless account-completion form whose onSubmit handler cancels native
  // submission; no handler, field or target changed.
  // G8.5 stage two (2026-11-19): re-reviewed after both requests moved onto
  // their routes' one-time session tokens (api.account-completion and
  // api.consents) through their token chains; the presentation token now
  // travels in the body alone. Still one actionless account-completion form
  // whose onSubmit handler cancels native submission; the same targets and bodies.
  { file: "src/components/uploads/own-upload-flow.tsx", forms: 1, sha256: "ed262cbbece96415aeeefb1644bd1fedd213af15584bb56eb47898ea7d69d776" },
  // G5.4 (2026-10-16): re-reviewed after two copy lines (the 30/730-day keep
  // line and the contact of last resort). Still one actionless form whose
  // onSubmit handler cancels native submission; no handler, field or target changed.
  { file: "src/components/uploads/path-b-request-form.tsx", forms: 1, sha256: "c407b8a5a49c151bf9c3314ecde9cfb3559a057444aa07961b5d9545706826ba" },
  ...GUARDED_FLOW_CLIENT_FORM_REVIEW,
  ...FUTURE_INTAKE_CLIENT_FORM_REVIEW,
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
    const guardedFlowFiles = new Set(GUARDED_FLOW_CLIENT_FORM_REVIEW.map(review => review.file));
    const futureIntakeFiles = new Set(FUTURE_INTAKE_CLIENT_FORM_REVIEW.map(review => review.file));
    const coreForms = all.filter(form => !futureIntakeFiles.has(form.file));
    // G8.5 (2026-10-24): the compatibility panel's one form is retired with it (14, 24 and 26 before).
    expect(coreForms.filter(form => !guardedFlowFiles.has(form.file))).toHaveLength(13);
    expect(coreForms).toHaveLength(23);
    expect(all.filter(form => futureIntakeFiles.has(form.file))).toHaveLength(2);
    expect(all).toHaveLength(25);
    const submissions = all.filter(form => form.routeId !== null);
    // G8.5 (2026-10-23): sign-out is now the reviewed scripted form above, so
    // the genome search is the one native submission left.
    expect(submissions).toEqual([
      { file: "src/app/(app)/genome/[subject]/data/browser/page.tsx", routeId: "genome.browser", method: "GET" },
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
