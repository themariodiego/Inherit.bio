/** Root-operated synthetic concurrency proof, every native operation rolled
 * back. A real committed fixture must already have both native finalization
 * authorities and exact synthetic provider acknowledgements. No setup,
 * grant, provider call or fabricated row is performed by this runner. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { assertClaimedProvenanceCatalog } from "./claimed-provenance-lock-contract.mjs";
import { claimedPairWaitSql, assertClaimedPairWaitReceipt, assertClaimedProvenanceNativeFixture } from "./claimed-provenance-wait-contract.mjs";

assert.equal(process.argv.length, 3, "Pass one exact committed synthetic fixture receipt path");
const project = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id = "([A-Za-z0-9_-]+)"$/m)?.[1];
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: new URL("..", import.meta.url), encoding: "utf8" }).trim();
const fixture = assertClaimedProvenanceNativeFixture(JSON.parse(readFileSync(process.argv[2], "utf8")), project, head);
const pins = JSON.parse(readFileSync(new URL("../docs/claimed-provenance-function-pins.json", import.meta.url), "utf8"));
const literal = value => `'${value.replaceAll("'", "''")}'`;
const signatures = pins.map((pin, ordinal) => `(${literal(pin.signature)},${ordinal})`).join(",");
const catalogSql = `with api(role) as (values ('anon'),('authenticated'),('inherit_upload_only'),('service_role')),
 native(signature,ordinal) as (values ${signatures}) select jsonb_agg(jsonb_build_object('signature',n.signature,
 'body',md5(p.prosrc),'args',coalesce(p.proargnames,'{}'::text[]),'result',pg_get_function_result(p.oid),
 'config',p.proconfig,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'securityDefiner',p.prosecdef,
 'volatility',p.provolatile,'parallel',p.proparallel,'defaults',p.proargdefaults::text,
 'apiRoles',(select coalesce(jsonb_agg(role order by role),'[]'::jsonb) from api where has_function_privilege(role,p.oid,'execute')),
 'foreignAcl',(select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
  where a.grantee<>p.proowner or a.grantor<>p.proowner or a.is_grantable or a.privilege_type<>'EXECUTE'),
 'ownerAcl',cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))) order by n.ordinal)
 from native n left join pg_proc p on p.oid=to_regprocedure(n.signature) left join pg_language l on l.oid=p.prolang`;

function session() {
  const child = spawn("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-X", "-A", "-t", "-q",
    "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
  let pending; let sqlState; let closed = false; let sequence = 0;
  const lines = createInterface({ input: child.stdout });
  child.stderr.setEncoding("utf8").on("data", chunk => {
    const code=chunk.match(/ERROR:\s+([0-9A-Z]{5}):/u)?.[1]; if(code)sqlState=code;
  });
  lines.on("line", line => {
    if (!pending) return;
    if (line === pending.marker) {
      const current = pending; pending = undefined; clearTimeout(current.timer);
      current.resolve(current.lines.join("\n").trim());
    } else pending.lines.push(line);
  });
  const completion = new Promise(resolve => {
    const finish = () => {
      closed = true;
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`Database session ended [${sqlState ?? "unavailable"}]`)); pending = undefined; }
      resolve();
    };
    child.once("error", () => finish()); child.once("close", finish);
  });
  return {
    query(sql) {
      assert(!pending && !closed, "Database session is busy or closed");
      return new Promise((resolve, reject) => {
        const marker = `claimed_pair_probe_${++sequence}`;
        const timer = setTimeout(() => { child.stdin.end(); reject(new Error("Bounded native pair probe timed out")); }, 12_000);
        pending = { marker, resolve, reject, timer, lines: [] }; child.stdin.write(`${sql};\n\\echo ${marker}\n`);
      });
    },
    async close() { child.stdin.end(); await completion; lines.close(); },
  };
}
const observer = session(); const holder = session();
try {
  await observer.query("set search_path=''; set statement_timeout='8s'; set idle_in_transaction_session_timeout='15s'");
  assertClaimedProvenanceCatalog(JSON.parse(await observer.query(catalogSql)), pins);
  assert.equal(await observer.query(`select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api
   cross join unnest(array['private.claimed_embryo_ingest_receipts','private.claimed_embryo_job_receipts']) relation
   where has_table_privilege(api,relation,'select,insert,update,delete,truncate,references,trigger')
    or has_any_column_privilege(api,relation,'select,insert,update,references')`), "0", "No API table or column receipt authority may appear");

  const native = fixture.nativeParentRequest;
  assert.equal(await observer.query(`select exists(select 1 from public.account_deletion_requests d
    join public.account_operation_nonces n on n.account_id=d.account_id and n.session_id=${literal(native.authSessionId)}::uuid
      and n.nonce_hash=${literal(native.nonceHash)} and n.operation='account_delete' and n.consumed_at is not null
    join public.retention_due_phases phase on phase.immutable_envelope->>'deletionRequestId'=d.id::text
      and phase.phase_id='account-deletion-notice-deadline'
    where d.id=${literal(native.deletionId)}::uuid and d.account_id=${literal(native.accountId)}::uuid
      and d.requested_at=${literal(native.requestedAt)}::timestamptz and d.notice_ends_at=${literal(native.noticeEndsAt)}::timestamptz
      and d.notice_ends_at=d.requested_at+interval '7 days' and phase.phase_deadline=d.notice_ends_at
      and (phase.immutable_envelope->>'originalNoticeEndsAt')::timestamptz=d.notice_ends_at)`), "t",
    "The real native request and consumed nonce must retain their original clocks");
  await observer.query(`select private.assert_account_affected_notice_receipt_v1(${literal(native.deletionId)}::uuid,
    (select immutable_envelope from public.retention_due_phases where phase_id='account-deletion-notice-deadline'
      and immutable_envelope->>'deletionRequestId'=${literal(native.deletionId)}))`);

  // Real native current authority checks. No supplied candidate or fabricated
  // provider evidence can replace the committed exact manifest/plan tuple.
  const authority = JSON.parse(await observer.query(`select jsonb_build_object(
   'sourceProof',public.future_person_deletion_parts_v1('proof',${literal(fixture.claimantManifestId)}::uuid,${literal(fixture.claimTokenHash)})->>'status',
   'parentReady',exists(select 1 from public.account_deletion_requests d join private.account_owned_cohort_purges t on t.deletion_id=d.id
    join public.purge_manifests m on m.id=${literal(fixture.claimantManifestId)}::uuid
    join public.retention_due_phases phase on phase.retention_row_id=m.retention_row_id and phase.phase_id=m.phase_id
    where d.id=${literal(fixture.accountDeletionId)}::uuid and d.state='delete_started' and d.notice_ends_at<=clock_timestamp()
     and d.storage_completed_at is not null and d.claim_expires_at>clock_timestamp()
     and t.cohort_id=(phase.immutable_envelope#>>'{sharedProvenance,ingest,historical_cohort_id}')::uuid
     and t.fixed_deadline=d.notice_ends_at and m.state='executing' and phase.status='claimed'
     and not exists(select 1 from private.claim_documents document where document.intake_id in(
      select id from private.claim_reviews review where review.matched_embryo_id=(select embryo_id from private.embryo_canonical_sources
       where file_id=(phase.immutable_envelope->>'sourceFileId')::uuid)))),
   'lockKey',(select hashtextextended('inherit.claimed-provenance-pair-v1|'||(phase.immutable_envelope#>>'{sharedProvenance,ingest,id}')
    ||'|'||(phase.immutable_envelope#>>'{sharedProvenance,job,id}'),0)::text from public.purge_manifests m
    join public.retention_due_phases phase on phase.retention_row_id=m.retention_row_id and phase.phase_id=m.phase_id
    where m.id=${literal(fixture.claimantManifestId)}::uuid))`));
  assert.equal(authority.sourceProof, "source_tombstoned"); assert.equal(authority.parentReady, true);
  assert.match(authority.lockKey, /^-?[0-9]+$/);
  const tables = JSON.parse(await observer.query(`select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) order by n.nspname,c.relname)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage') and c.relkind in('r','p')`));
  const snapshots = tables.map(table => {
    assert.match(table.schema, /^(public|private|auth|storage)$/); assert.match(table.name, /^[a-z0-9_]+$/);
    return `select ${literal(`${table.schema}.${table.name}`)} relation,md5(coalesce(jsonb_agg(to_jsonb(stored_row) order by to_jsonb(stored_row)::text),'[]'::jsonb)::text) fingerprint from ${table.schema}.${table.name} stored_row`;
  });
  const snapshot = async () => observer.query(`select jsonb_agg(to_jsonb(rows) order by relation) from (${snapshots.join(" union all ")}) rows`);
  const before = await snapshot();
  const ledgerSnapshot = () => observer.query("select coalesce(jsonb_agg(to_jsonb(m) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations m");
  const beforeLedger = await ledgerSnapshot();
  await observer.query("create temporary table claimed_pair_wait_receipt(value jsonb)");
  const operations = [
    { name: "claimant native finalizer", sql: `select private.finish_future_person_deletion_v1(${literal(fixture.claimantManifestId)}::uuid,${literal(fixture.claimTokenHash)})` },
    { name: "parent native finalizer", sql: `select private.purge_account_owned_cohorts_v1(${literal(fixture.accountDeletionId)}::uuid)` },
  ];
  for (const index of [0, 1]) {
    const peer = session();
    try {
      await holder.query("begin; set local statement_timeout='8s'; set local idle_in_transaction_session_timeout='15s'");
      const holderPid = Number(await holder.query("select pg_backend_pid()")); assert(Number.isSafeInteger(holderPid) && holderPid > 0);
      const heldOutcome = await holder.query(operations[index].sql); // real full native finalization, kept uncommitted
      if (index === 0) assert.deepEqual(JSON.parse(heldOutcome), { status: "deleted" });
      else {
        assert.equal(heldOutcome, "");
        assert.equal(await holder.query(`select count(*) from private.account_owned_cohort_purges where deletion_id=${literal(fixture.accountDeletionId)}::uuid`), "0",
          "The parent native finalizer must actually remove its current cohort plan");
      }
      await holder.query("set constraints all immediate");
      await peer.query("begin; set local statement_timeout='5s'; set local idle_in_transaction_session_timeout='10s'");
      const peerPid = Number(await peer.query("select pg_backend_pid()")); assert(Number.isSafeInteger(peerPid) && peerPid > 0);
      const peerName = `claimed-pair-owned-peer-${fixture.claimantManifestId}-${index}`;
      await peer.query(`set local application_name=${literal(peerName)}`);
      const identity = JSON.parse(await peer.query("select jsonb_build_object('pid',pid,'startedAt',backend_start) from pg_stat_activity where pid=pg_backend_pid()"));
      assert.equal(identity.pid, peerPid);
      await observer.query("truncate pg_temp.claimed_pair_wait_receipt");
      // Start the owner observer before the actual peer call. Detection and
      // cancellation happen in one server invocation, with no Docker round
      // trip between noticing the real pair wait and canceling the owned peer.
      // The actual native function's 250ms configuration is never overridden.
      const observing = observer.query(claimedPairWaitSql({ holderPid, peerPid,
        peerStartedAt: identity.startedAt, peerName, lockKey: authority.lockKey }));
      const attempt = peer.query(operations[1 - index].sql).then(() => ({ error: null }), error => ({ error }));
      await observing;
      const observed = JSON.parse(await observer.query("select value from pg_temp.claimed_pair_wait_receipt"));
      const result = await attempt;
      assertClaimedPairWaitReceipt(observed);
      assert.match(String(result.error), /57014/, "Peer ends only through exact backend cancellation");
      await holder.query("rollback"); assert.equal(await snapshot(), before, "Every public/private/Auth/Storage row must be byte-identical after both native transactions roll back");
      assert(await ledgerSnapshot() === beforeLedger, "The entire migration ledger must be byte-identical after rollback");
      assertClaimedProvenanceCatalog(JSON.parse(await observer.query(catalogSql)), pins);
      console.log(`PASS ${operations[index].name} excludes the other finalizer on the exact pair; whole row snapshot restored`);
    } finally { await peer.close(); }
  }
  console.log("2/2 opposite native finalizer lock waits and complete rollback fingerprints passed; synthetic metadata proof only.");
} finally { await holder.close(); await observer.close(); }
