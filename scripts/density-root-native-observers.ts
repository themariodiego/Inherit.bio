import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { types } from "node:util";
import { createServerClient } from "@supabase/ssr";
import type { Page } from "@playwright/test";
import { z } from "zod";
import type { FreshDensityRuntime } from "./density-fresh-runtime";
import type { DensityNativeObservers } from "./density-owned-capture";
import { densityCapturePlan, densityRouteMatches, densityStateProofSchema, type DensityStateCase } from "./density-capture-plan";
import { observeDensityServiceBinding, assertDensityServiceUnchanged, densityServicePort } from "./density-service-binding";
import { createResourceIO, infrastructureChildEnvironment } from "./comprehension/fresh-t6-resources";
import { assertCiRuntime, checkedAppEnvironment } from "./ci-browser-config";
import { assertOwnedLinuxSource } from "./owned-linux-runtime";
import { localE2eProject } from "./local-e2e-project";
import { claimStartDensityFactsSchema } from "./density-claim-states";
import { appealReviewDensityFactsSchema } from "./density-appeal-review-states";
import { checkClaimReviewDensityFacts } from "./density-claim-review-states";
import { subjectAccessDensityFactsSchema } from "./density-subject-access-states";
import { liveCohortDensitySchema } from "./density-cohort-live-states";
import { publishedCohortBagSchema } from "./density-cohort-publication-states";
import { statisticalCohortBagSchema } from "./density-cohort-statistical-states";
import { pendingEmbryoInputSchema, isUntouchedPendingInput } from "../src/lib/embryos/pending-input";

const REFUSAL = "Actual owned density native state observation refused";
const SHA = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = z.string().regex(SHA), uuid = z.string().regex(UUID);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bag = z.object({ count, sha256: digest }).strict();
const nativeSchema = z.enum(["auth", "private", "public", "storage"]);
const wholeRelations = z.object({ count: z.number().int().positive().max(512),
  fieldCount: z.number().int().positive().max(100_000), sha256: digest,
  kinds: z.object({ ordinary: count, partitioned: count, sequences: count }).strict(),
  schemas: z.array(z.object({ name: nativeSchema, count, fieldCount: count, sha256: digest }).strict()).length(4),
}).strict();
const session = z.object({ userId: uuid, sessionId: uuid, live: z.literal(true),
  user: bag.extend({ count: z.literal(1) }), session: bag.extend({ count: z.literal(1) }) }).strict();
const rights = z.object({ sessionHash: digest, id: uuid, tokenId: uuid, targetId: uuid,
  principalId: uuid, purpose: z.literal("adult-subject-invitation"), targetKind: z.literal("subject"),
  status: z.enum(["active", "consumed", "revoked", "expired"]), live: z.boolean(), row: digest }).strict();
export const densityNativeObservationSchema = z.object({
  version: z.literal(1), complete: z.literal(true),
  context: z.object({ systemIdentifier: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    databaseOid: z.number().int().positive().max(4_294_967_295), databaseName: z.literal("postgres"),
    readOnly: z.literal(true), isolation: z.literal("repeatable read"), encoding: z.literal("UTF8"),
    statementTimeout: z.literal("45s"), lockTimeout: z.literal("250ms"), backendPid: z.number().int().positive().max(4_294_967_295),
    observedAt: z.string().max(40).datetime({ offset: true }) }).strict(),
  tableCount: z.number().int().positive().max(512), fieldCount: z.number().int().positive().max(100_000),
  tables: wholeRelations,
  authorization: z.object({ roles: bag, memberships: bag, relations: bag, attributes: bag,
    routines: bag, namespaces: bag, policies: bag, defaults: bag, constraints: bag,
    triggers: bag, rewrites: bag, types: bag, indexes: bag, inheritances: bag }).strict(),
  actors: z.array(z.object({ id: uuid, row: digest }).strict()).max(2),
  authSession: session.nullable(), rightsSession: rights.nullable(),
}).strict();
export type DensityNativeObservation = z.infer<typeof densityNativeObservationSchema>;

/** Copy BEFORE the first await. Accessors, proxies, toJSON and cycles never
 * run, including inside fixture facts or cookie data. Nothing copied here is
 * saved: private browser/API values are reduced to hashes in the final proof. */
function ordinary(value: unknown, seen = new Set<object>(), depth = 0): unknown {
  assert(depth <= 40);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { assert(Number.isFinite(value)); return value; }
  assert(typeof value === "object" && !types.isProxy(value) && !seen.has(value));
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      assert(value.length <= 100_000 && Reflect.ownKeys(value).length === value.length + 1);
      return Array.from({ length: value.length }, (_, index) => {
        const d = Object.getOwnPropertyDescriptor(value, String(index));
        assert(d?.enumerable && Object.hasOwn(d, "value")); return ordinary(d.value, seen, depth + 1);
      });
    }
    assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      assert(typeof key === "string" && !["__proto__", "constructor", "prototype"].includes(key));
      const d = Object.getOwnPropertyDescriptor(value, key);
      assert(d?.enumerable && Object.hasOwn(d, "value")); result[key] = ordinary(d.value, seen, depth + 1);
    }
    return result;
  } finally { seen.delete(value); }
}
function record(value: unknown): Record<string, unknown> {
  const result = ordinary(value);
  assert(result !== null && typeof result === "object" && !Array.isArray(result));
  assert(Buffer.byteLength(JSON.stringify(result)) <= 16_777_216); return result as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  assert(required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)));
}
function sourceBytes(root: string, relative: string) {
  assert(/^(?:docs|e2e|scripts)\/[a-zA-Z0-9_./-]+\.(?:json|[cm]?ts|tsx)$/u.test(relative)
    && !relative.split("/").some(p => p === "." || p === ".."));
  const file = path.join(root, relative); assert(realpathSync(file) === file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd); assert(before.isFile() && before.nlink === 1 && before.size <= 16_777_216);
    const bytes = readFileSync(fd), after = fstatSync(fd);
    assert(bytes.length === before.size && ["dev", "ino", "size", "mtimeMs", "ctimeMs"].every(key =>
      before[key as keyof typeof before] === after[key as keyof typeof after])); return bytes;
  } finally { closeSync(fd); }
}

type Provider = keyof DensityNativeObservers;
const sources: Record<Provider, string> = {
  publicAndAuth: "density-real-state-fixtures", accountAndOwn: "density-owned-state-fixtures",
  pairedFamily: "density-family-state-fixtures", ownReport: "density-report-state-fixtures",
  cohortEntry: "density-cohort-entry-state-fixtures", fileTransfer: "density-file-transfer-state-fixtures",
  publishedCohort: "density-cohort-publication-state-fixtures", unansweredCopilot: "density-copilot-state-fixtures",
  jurisdiction: "density-jurisdiction-state-fixtures", liveCohort: "density-cohort-live-state-fixtures",
  withdrawal: "density-withdrawal-state-fixtures", claimProcessing: "density-claim-state-fixtures",
  statisticalCohort: "density-cohort-statistical-state-fixtures", appealReview: "density-appeal-review-state-fixtures",
  claimReview: "density-claim-review-state-fixtures", subjectAccessProcessing: "density-subject-access-state-fixtures",
  portrait: "density-portrait-state-fixtures", healthPicture: "density-health-picture-state-fixtures",
  overviewJurisdiction: "density-health-picture-state-fixtures", remainingCopilot: "density-remaining-copilot-state-fixtures",
  finalizedEmbryoEmpty: "density-finalized-embryo-empty-state-fixtures",
};
type Facts = { actorIds: string[]; reviewer: boolean; authSessionId?: string; withdrawal?: Record<string, unknown> };
/** The native proof uses an INDEPENDENT complete DB read, not this argument's
 * row values. Existing provider audits still check their exact full state and
 * original request/response. The only facts used as native selectors are
 * closed UUID identities; specialized existing strict schemas are retained. */
function factsFor(provider: Provider, row: DensityStateCase, input: unknown): Facts {
  if (provider === "publicAndAuth") { assert(input === undefined); return { actorIds: [], reviewer: false }; }
  const x = record(input); assert(x.nativeSnapshot !== null && typeof x.nativeSnapshot === "object" && !Array.isArray(x.nativeSnapshot));
  const actorIds: string[] = [];
  let authSessionId: string | undefined, withdrawal: Record<string, unknown> | undefined;
  if (["pairedFamily", "portrait", "healthPicture", "overviewJurisdiction"].includes(provider)) {
    exactKeys(x, ["accountIds", "nativeSnapshot"]);
    actorIds.push(...z.array(uuid).length(2).parse(x.accountIds)); assert(actorIds[0] !== actorIds[1]);
  } else if (provider === "withdrawal") {
    exactKeys(x, ["scope", "nativeSnapshot"]); withdrawal = record(x.scope);
    exactKeys(withdrawal, ["inviterId", "invitationId", "subjectId", "tokenId", "candidateId", "emailHmac"]);
    for (const key of ["inviterId", "invitationId", "subjectId", "tokenId", "candidateId"]) uuid.parse(withdrawal[key]);
    digest.parse(withdrawal.emailHmac); actorIds.push(uuid.parse(withdrawal.inviterId));
  } else if (provider === "claimProcessing") {
    exactKeys(x, ["nativeSnapshot", "originalRequestCount"]); assert(x.originalRequestCount === 1);
    claimStartDensityFactsSchema.parse(x.nativeSnapshot);
  } else if (["appealReview", "claimReview", "subjectAccessProcessing"].includes(provider)) {
    exactKeys(x, ["reviewerId", "nativeSnapshot", ...(provider === "appealReview" ? ["caseId"]
      : provider === "claimReview" ? ["claimId"] : ["originalRequestCount"])]);
    actorIds.push(uuid.parse(x.reviewerId));
    if (provider === "appealReview") { uuid.parse(x.caseId); appealReviewDensityFactsSchema.parse(x.nativeSnapshot); }
    if (provider === "claimReview") { uuid.parse(x.claimId); checkClaimReviewDensityFacts(x.nativeSnapshot, row.state); }
    if (provider === "subjectAccessProcessing") { assert(x.originalRequestCount === 1); subjectAccessDensityFactsSchema.parse(x.nativeSnapshot); }
  } else {
    exactKeys(x, ["accountId", "nativeSnapshot", ...(["publishedCohort", "liveCohort", "statisticalCohort", "finalizedEmbryoEmpty"].includes(provider)
      ? ["cohortId"] : provider === "ownReport" ? ["fileId"] : [])], provider === "accountAndOwn" ? ["sessionId"] : []);
    actorIds.push(uuid.parse(x.accountId));
    if (Object.hasOwn(x, "cohortId")) uuid.parse(x.cohortId);
    if (Object.hasOwn(x, "fileId")) uuid.parse(x.fileId);
    if (Object.hasOwn(x, "sessionId")) authSessionId = uuid.parse(x.sessionId);
    if (provider === "liveCohort") {
      const n = record(x.nativeSnapshot); exactKeys(n, ["context", "publication"]); liveCohortDensitySchema.parse(n.context);
    }
    if (provider === "publishedCohort") {
      const n = record(x.nativeSnapshot); exactKeys(n, ["publication", "completeNativeBags"]); publishedCohortBagSchema.parse(n.completeNativeBags);
    }
    if (provider === "statisticalCohort") {
      const n = record(x.nativeSnapshot); exactKeys(n, ["publication", "statisticalProof", "completeNativeBags", "completeFirstHistoryBags", "recipe"]);
      assert(n.recipe === "uncovered" || n.recipe === "fitted-partial"); statisticalCohortBagSchema.parse(n.completeNativeBags);
      if (n.completeFirstHistoryBags !== null) statisticalCohortBagSchema.parse(n.completeFirstHistoryBags);
    }
    if (provider === "finalizedEmbryoEmpty") {
      const n = record(x.nativeSnapshot); exactKeys(n, ["pendingInput", "nativeSessionId", "completeNativeBag"]);
      const pending = pendingEmbryoInputSchema.parse(n.pendingInput);
      assert(isUntouchedPendingInput(pending)); uuid.parse(n.nativeSessionId); digest.parse(n.completeNativeBag);
    }
  }
  return { actorIds: actorIds.toSorted(), reviewer: ["appealReview", "claimReview", "subjectAccessProcessing"].includes(provider),
    ...(authSessionId ? { authSessionId } : {}), ...(withdrawal ? { withdrawal } : {}) };
}

const nativeBag = (select: string) => `(select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(convert_to(
  coalesce(jsonb_agg(row order by row::text collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')) from (${select}) full_rows)`;
/** Only catalog-owned identifiers are interpolated by PostgreSQL format(%I).
 * query_to_xml/XMLTABLE executes those fixed SELECTs inside the SAME read-only
 * repeatable-read transaction; it creates no function, table or extension.
 * Every table/column, duplicate, null and empty table is retained. No raw row,
 * key, ciphertext, cookie, Auth payload or PostgreSQL error leaves this query. */
export function densityNativeObservationSql(input: { actorIds: readonly string[];
  auth?: { userId: string; sessionId: string }; rightsHash?: string }) {
  assert(input.actorIds.length <= 2 && new Set(input.actorIds).size === input.actorIds.length);
  for (const id of input.actorIds) uuid.parse(id);
  if (input.auth) { uuid.parse(input.auth.userId); uuid.parse(input.auth.sessionId); }
  if (input.rightsHash) digest.parse(input.rightsHash);
  const auth = input.auth;
  const selectedActors = input.actorIds.length ? input.actorIds.map(id => `'${id}'::uuid`).join(",") : "null::uuid";
  const authSql = auth ? `(select jsonb_build_object('userId',u.id,'sessionId',s.id,
    'live',s.not_after is null or s.not_after>clock_timestamp(),
    'user',${nativeBag(`select to_jsonb(r) row from auth.users r where r.id='${auth.userId}'::uuid`)},
    'session',${nativeBag(`select to_jsonb(r) row from auth.sessions r where r.id='${auth.sessionId}'::uuid and r.user_id='${auth.userId}'::uuid`)})
    from auth.users u join auth.sessions s on s.user_id=u.id where u.id='${auth.userId}'::uuid and s.id='${auth.sessionId}'::uuid)` : "null";
  const rightsSql = input.rightsHash ? `(select jsonb_build_object('sessionHash',r.session_hash,'id',r.id,
    'tokenId',r.token_hash_id,'targetId',r.target_id,'principalId',r.principal_id,'purpose',r.purpose,'targetKind',r.target_kind,
    'status',r.status,'live',r.status='active' and r.ended_at is null and r.expires_at>clock_timestamp(),
    'row',encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex')) from public.rights_sessions r where r.session_hash='${input.rightsHash}')` : "null";
  const scope = "n.nspname in ('auth','private','public','storage')";
  const authorization = [
    ["roles", "select to_jsonb(r) row from pg_catalog.pg_roles r"],
    ["memberships", "select to_jsonb(r) row from pg_catalog.pg_auth_members r"],
    ["relations", `select to_jsonb(r) row from pg_catalog.pg_class r join pg_catalog.pg_namespace n on n.oid=r.relnamespace where ${scope}`],
    ["attributes", `select to_jsonb(r) row from pg_catalog.pg_attribute r join pg_catalog.pg_class c on c.oid=r.attrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${scope}`],
    ["routines", `select to_jsonb(r) row from pg_catalog.pg_proc r join pg_catalog.pg_namespace n on n.oid=r.pronamespace where ${scope}`],
    ["namespaces", `select to_jsonb(n) row from pg_catalog.pg_namespace n where ${scope}`],
    ["policies", `select to_jsonb(r) row from pg_catalog.pg_policy r join pg_catalog.pg_class c on c.oid=r.polrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${scope}`],
    ["defaults", "select to_jsonb(r) row from pg_catalog.pg_default_acl r"],
    ["constraints", `select to_jsonb(r) row from pg_catalog.pg_constraint r join pg_catalog.pg_namespace n on n.oid=r.connamespace where ${scope}`],
    ["triggers", `select to_jsonb(r) row from pg_catalog.pg_trigger r join pg_catalog.pg_class c on c.oid=r.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${scope}`],
    ["rewrites", `select to_jsonb(r) row from pg_catalog.pg_rewrite r join pg_catalog.pg_class c on c.oid=r.ev_class join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${scope}`],
    ["types", `select to_jsonb(r) row from pg_catalog.pg_type r join pg_catalog.pg_namespace n on n.oid=r.typnamespace where ${scope}`],
    ["indexes", `select to_jsonb(r) row from pg_catalog.pg_index r join pg_catalog.pg_class c on c.oid=r.indrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${scope}`],
    ["inheritances", `select to_jsonb(r) row from pg_catalog.pg_inherits r join pg_catalog.pg_class c on c.oid=r.inhrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${scope}`],
  ].map(([name, select]) => `'${name}',${nativeBag(select)}`).join(",");
  return `begin isolation level repeatable read read only;
set local statement_timeout='45s';set local lock_timeout='250ms';set local client_min_messages='error';
with definitions as materialized (
 select c.oid,c.relkind,n.nspname,c.relname,
 (select jsonb_agg(jsonb_build_object('ordinal',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'definitionSha256',encode(extensions.digest(to_jsonb(a)::text,'sha256'),'hex')) order by a.attnum)
  from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where ${scope} and c.relkind in ('r','p','S')
), complete_tables as materialized (
 select jsonb_build_object('schema',d.nspname,'name',d.relname,'oid',d.oid::bigint,'kind',d.relkind,
   'columns',d.columns,'rows',x.vector::jsonb) table_row,d.nspname,d.relname,d.relkind,jsonb_array_length(d.columns) field_count
 from definitions d cross join lateral XMLTABLE('/table/row'
 passing pg_catalog.query_to_xml(pg_catalog.format(
  $scan$select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(convert_to(
    coalesce(jsonb_agg(row order by row::text collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')) as vector
    from (select to_jsonb(r) row from %I.%I r offset 0) full_rows$scan$,d.nspname,d.relname),true,false,'')
 columns vector text path 'vector') x
), scoped_schemas as materialized (
 select scope.name,count(t.table_row) relation_count,coalesce(sum(t.field_count),0) field_count,
 encode(extensions.digest(convert_to(coalesce(jsonb_agg(t.table_row order by t.relname collate "C")
 filter(where t.table_row is not null),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') sha256
 from (values('auth'),('private'),('public'),('storage')) scope(name)
 left join complete_tables t on t.nspname=scope.name group by scope.name
)
select jsonb_build_object('version',1,'complete',not exists(
 select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where ${scope} and c.relkind in ('m','f')),'context',jsonb_build_object(
 'systemIdentifier',s.system_identifier::text,'databaseOid',db.oid::bigint,'databaseName',current_database(),
 'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'encoding',current_setting('server_encoding'),'statementTimeout',current_setting('statement_timeout'),
 'lockTimeout',current_setting('lock_timeout'),'backendPid',pg_backend_pid(),
 'observedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
 'tableCount',(select count(*) from definitions),'fieldCount',(select sum(jsonb_array_length(columns)) from definitions),
 'tables',(select jsonb_build_object('count',count(*),'fieldCount',sum(field_count),
   'sha256',encode(extensions.digest(convert_to(coalesce(jsonb_agg(table_row order by nspname collate "C",relname collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'),
   'kinds',jsonb_build_object('ordinary',count(*) filter(where relkind='r'),'partitioned',count(*) filter(where relkind='p'),
     'sequences',count(*) filter(where relkind='S')),
   'schemas',(select jsonb_agg(jsonb_build_object('name',name,'count',relation_count,'fieldCount',field_count,'sha256',sha256)
     order by name collate "C") from scoped_schemas)) from complete_tables),
 'authorization',jsonb_build_object(${authorization}),
 'actors',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'row',encode(extensions.digest(to_jsonb(u)::text,'sha256'),'hex'))
 order by u.id),'[]'::jsonb) from auth.users u where u.id in (${selectedActors})),
 'authSession',${authSql},'rightsSession',${rightsSql})
 from pg_catalog.pg_control_system() s join pg_catalog.pg_database db on db.datname=current_database();
rollback;`;
}

export function checkedDensityNativeObservation(value: unknown, expected: { systemIdentifier: string; databaseOid: number;
  actorIds: readonly string[]; auth?: { userId: string; sessionId: string }; rightsHash?: string; now: number }) {
  try {
    const x = densityNativeObservationSchema.parse(ordinary(value));
    assert(x.context.systemIdentifier === expected.systemIdentifier && x.context.databaseOid === expected.databaseOid);
    const elapsed = expected.now - Date.parse(x.context.observedAt); assert(elapsed >= -5_000 && elapsed <= 60_000);
    assert(x.tables.count === x.tableCount && x.tables.fieldCount === x.fieldCount);
    assert(JSON.stringify(x.tables.schemas.map(schema => schema.name)) === JSON.stringify(["auth", "private", "public", "storage"]));
    assert(x.tables.schemas.reduce((n, schema) => n + schema.count, 0) === x.tableCount
      && x.tables.schemas.reduce((n, schema) => n + schema.fieldCount, 0) === x.fieldCount
      && Object.values(x.tables.kinds).reduce((n, value) => n + value, 0) === x.tableCount);
    assert(x.tables.schemas.every(schema => schema.count > 0 && schema.fieldCount >= schema.count));
    assert(x.authorization.roles.count > 0 && x.authorization.namespaces.count === 4
      && x.authorization.relations.count >= x.tableCount && x.authorization.attributes.count >= x.fieldCount
      && x.authorization.routines.count > 0);
    assert(JSON.stringify(x.actors.map(actor => actor.id)) === JSON.stringify([...expected.actorIds].sort()));
    assert(expected.auth ? x.authSession?.userId === expected.auth.userId && x.authSession.sessionId === expected.auth.sessionId : x.authSession === null);
    assert(expected.rightsHash ? x.rightsSession?.sessionHash === expected.rightsHash : x.rightsSession === null);
    return x;
  } catch { throw new Error(REFUSAL); }
}

/** Root calls this with the object returned by acquireFreshDensityRuntime.
 * This function neither acquires/adopts a runtime nor provisions a state.
 * Every closure is tied to that actual browser/Map/child/AppEnv/runtime lease. */
export function createRootDensityNativeObservers(ownership: FreshDensityRuntime,
  input: { root: string; signal: AbortSignal;
    savePublicObservation: (value: { version: 1; routeId: string; state: string; fixtureSourceSha256: string;
      runtimeSha256: string; appConfigurationSha256: string; native: DensityNativeObservation }) => Promise<void> }): DensityNativeObservers {
  const root = realpathSync(input.root); assert(root === input.root && root === process.cwd());
  const environment = ownership.environment;
  assertCiRuntime(environment, process.platform, ownership.operator);
  assert(ownership.browser.isConnected() && typeof ownership.runtime.observeActiveService === "function");
  assert(typeof input.savePublicObservation === "function", "Separate actual public observation custody required");
  const project = localE2eProject(environment); assert(project.projectId === "sequence");
  const infrastructure = infrastructureChildEnvironment(environment, ownership.operator), io = createResourceIO(ownership.operator);
  if (ownership.operator) assertOwnedLinuxSource(ownership.operator, infrastructure);
  const registerBytes = sourceBytes(root, "docs/route-register.json"), register = JSON.parse(registerBytes.toString("utf8"));
  const states = densityCapturePlan(register, []).states;
  const sameOwners = new WeakMap<Page, { key: string; origin: string; native: string; session: string }>();
  const provider = (name: Provider) => ({ observeState: async (row: DensityStateCase, page: Page, fixtureSourceSha256: string, rawFacts?: unknown) => {
    try {
      input.signal.throwIfAborted();
      const facts = factsFor(name, row, rawFacts); // snapshot before any await
      const sourcePath = `e2e/helpers/${sources[name]}.ts`, fixtureBytes = sourceBytes(root, sourcePath);
      assert(hash(fixtureBytes) === fixtureSourceSha256 && SHA.test(fixtureSourceSha256));
      const exact = states.find(x => x.route.id === row.route.id && x.state === row.state);
      assert(exact && JSON.stringify(exact) === JSON.stringify(ordinary(row)));
      assert(page.context().browser() === ownership.browser && ownership.browser.isConnected() && !page.isClosed());
      const navigation = page.url(), origin = new URL(navigation).origin, port = densityServicePort(origin);
      assert(densityRouteMatches(row.route.path, navigation, origin));
      const app = ownership.apps.get(port); assert(app && app.child.exitCode === null && app.child.signalCode === null && !app.child.killed);
      const exactConfiguration = checkedAppEnvironment(app.appEnvironment, port);
      const observer = ownership.observers(origin, sourcePath);
      const first = await observeDensityServiceBinding({ origin, source: exactSource(registerBytes, await observer.observeRuntime(origin, fixtureSourceSha256)),
        fixtureSourceSha256, ...observer });
      assert(JSON.stringify(exactConfiguration) === JSON.stringify(await observer.readActualAppEnvironment(origin)));
      const cookies = await page.context().cookies();
      const cookieCopy = ordinary(cookies);
      const authCookies = cookies.filter(cookie => /-auth-token(?:\.\d+)?$/u.test(cookie.name));
      let claims: Record<string, unknown> | undefined, apiUser: unknown;
      const requiresAuth = facts.reviewer || ["authenticated", "reviewer", "reset-session"].includes(row.route.auth ?? "");
      const appUrl = exactConfiguration.NEXT_PUBLIC_SUPABASE_URL, appKey = exactConfiguration.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      assert(appUrl === project.apiOrigin && appUrl === environment.NEXT_PUBLIC_SUPABASE_URL
        && appKey === environment.NEXT_PUBLIC_SUPABASE_ANON_KEY && appKey.length > 0);
      if (authCookies.length) {
        const auth = createServerClient(appUrl, appKey, { cookies: { getAll: () => cookies,
          setAll: () => { throw new Error(REFUSAL); } }, global: { fetch: (url, init) => {
            const target = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
            assert(target.origin === project.apiOrigin && /^\/auth\/v1\//u.test(target.pathname)
              && (init?.method ?? "GET").toUpperCase() === "GET");
            return fetch(url, { ...init, signal: AbortSignal.any([input.signal, AbortSignal.timeout(5_000)]) });
          } } });
        const verified = await auth.auth.getClaims(); assert(!verified.error && verified.data);
        claims = record(verified.data.claims);
        assert(claims.role === "authenticated" && UUID.test(uuid.parse(claims.sub)) && UUID.test(uuid.parse(claims.session_id))
          && typeof claims.exp === "number" && claims.exp * 1_000 > Date.now()
          && ["aal1", "aal2"].includes(String(claims.aal)));
        if (facts.actorIds.length && !facts.withdrawal) assert(facts.actorIds.includes(String(claims.sub)));
        if (facts.reviewer) assert(claims.aal === "aal2");
        if (facts.authSessionId) assert(claims.session_id === facts.authSessionId);
        const user = await auth.auth.getUser(); assert(!user.error && user.data.user?.id === claims.sub); apiUser = ordinary(user.data.user);
      } else assert(!requiresAuth && !facts.reviewer);
      const rightsCookies = cookies.filter(cookie => /^(?:__Host-)?inherit-rights$/u.test(cookie.name));
      let rightsHash: string | undefined;
      if (facts.withdrawal) {
        assert(authCookies.length === 0 && rightsCookies.length === 1 && /^[A-Za-z0-9_-]{43}$/u.test(rightsCookies[0].value)
          && rightsCookies[0].httpOnly && rightsCookies[0].sameSite === "Strict" && rightsCookies[0].path === "/");
        rightsHash = hash(rightsCookies[0].value);
      }
      const selectedAuth = claims ? { userId: uuid.parse(claims.sub), sessionId: uuid.parse(claims.session_id) } : undefined;
      const actorIds = [...new Set([...facts.actorIds, ...(selectedAuth ? [selectedAuth.userId] : [])])].sort(); assert(actorIds.length <= 2);
      const output = await io.command("docker", ["exec", project.dbContainer, "psql", "-XAtq", "-U", "postgres", "-d", "postgres",
        "--set=ON_ERROR_STOP=1", "-c", densityNativeObservationSql({ actorIds, auth: selectedAuth, rightsHash })],
      { env: infrastructure, timeout: 60_000, signal: input.signal });
      assert(Buffer.byteLength(output) <= 32_768 && /^\{[^\r\n]+\}$/u.test(output));
      const native = checkedDensityNativeObservation(JSON.parse(output), { systemIdentifier: first.runtime.systemIdentifier,
        databaseOid: first.runtime.databaseOid, actorIds, auth: selectedAuth, rightsHash, now: Date.now() });
      if (facts.withdrawal) {
        const actual = native.rightsSession; assert(actual && actual.tokenId === facts.withdrawal.tokenId && actual.targetId === facts.withdrawal.subjectId);
        assert(row.state === "processing" ? actual.live && actual.status === "active" : row.state === "complete" && !actual.live && actual.status === "consumed");
      }
      assert(page.url() === navigation && !page.isClosed() && ownership.browser.isConnected()
        && JSON.stringify(ordinary(await page.context().cookies())) === JSON.stringify(cookieCopy));
      if (claims) assert(typeof claims.exp === "number" && claims.exp * 1_000 > Date.now());
      const second = await observeDensityServiceBinding({ origin, source: first.runtime.source, fixtureSourceSha256, ...observer });
      assertDensityServiceUnchanged(first, second);
      assert(hash(sourceBytes(root, sourcePath)) === fixtureSourceSha256 && sourceBytes(root, "docs/route-register.json").equals(registerBytes));
      // Keep the genuine connection/liveness metadata OUTSIDE stable hashes.
      // The sink receives only this strict public digest vector, not any
      // cookie, JWT, API user body, raw stderr or unparsed native output.
      const originalVector = JSON.stringify(native);
      await input.savePublicObservation({ version: 1, routeId: row.route.id, state: row.state, fixtureSourceSha256,
        runtimeSha256: first.runtimeSha256, appConfigurationSha256: first.appConfigurationSha256,
        native: densityNativeObservationSchema.parse(JSON.parse(originalVector)) });
      assert(JSON.stringify(native) === originalVector && page.url() === navigation
        && JSON.stringify(ordinary(await page.context().cookies())) === JSON.stringify(cookieCopy));
      assertDensityServiceUnchanged(first, await observeDensityServiceBinding({ origin, source: first.runtime.source, fixtureSourceSha256, ...observer }));
      // Native query connection PID and liveness clock are validated above,
      // but are not persisted-row facts and cannot fake a changed DB bag.
      const stableNative = JSON.stringify({ tables: native.tables, authorization: native.authorization, actors: native.actors,
        authSession: native.authSession, rightsSession: native.rightsSession });
      const actualSession = JSON.stringify({ cookies: cookieCopy, claims: claims ?? null, user: apiUser ?? null,
        authSession: native.authSession, rightsSession: native.rightsSession });
      const binding = { key: JSON.stringify([row.route.id, row.state]), origin, native: hash(stableNative), session: hash(actualSession) };
      const previous = sameOwners.get(page); assert(!previous || JSON.stringify(previous) === JSON.stringify(binding)); sameOwners.set(page, binding);
      return densityStateProofSchema.parse({ version: 1, routeId: row.route.id, state: row.state, source: first.runtime.source,
        runtimeSha256: first.runtimeSha256, authorizationSha256: hash(JSON.stringify({ authorization: native.authorization,
          tables: native.tables, actors: native.actors, authSession: native.authSession, rightsSession: native.rightsSession })),
        currentDataSha256: hash(stableNative), sessionSha256: binding.session, navigationSha256: hash(navigation), fixtureSourceSha256 });
    } catch { throw new Error(REFUSAL); }
  } });
  return { publicAndAuth: provider("publicAndAuth"), accountAndOwn: provider("accountAndOwn"), pairedFamily: provider("pairedFamily"),
    ownReport: provider("ownReport"), cohortEntry: provider("cohortEntry"), fileTransfer: provider("fileTransfer"),
    publishedCohort: provider("publishedCohort"), unansweredCopilot: provider("unansweredCopilot"), jurisdiction: provider("jurisdiction"),
    liveCohort: provider("liveCohort"), withdrawal: provider("withdrawal"), claimProcessing: provider("claimProcessing"),
    statisticalCohort: provider("statisticalCohort"), appealReview: provider("appealReview"), claimReview: provider("claimReview"),
    subjectAccessProcessing: provider("subjectAccessProcessing"), portrait: provider("portrait"), healthPicture: provider("healthPicture"),
    overviewJurisdiction: provider("overviewJurisdiction"), remainingCopilot: provider("remainingCopilot"), finalizedEmbryoEmpty: provider("finalizedEmbryoEmpty") };
}
function exactSource(registerBytes: Buffer, input: unknown) {
  const x = record(input), source = record(x.source); assert(source.registerSha256 === hash(registerBytes));
  return z.object({ head: z.string().regex(/^[a-f0-9]{40}$/u), tree: z.string().regex(/^[a-f0-9]{40}$/u), registerSha256: digest }).strict().parse(source);
}
