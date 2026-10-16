import assert from "node:assert/strict";
import { assertClaimedProvenanceFixture } from "./claimed-provenance-lock-contract.mjs";

export function assertClaimedProvenanceNativeFixture(input, project, head) {
  assert(input && typeof input === "object" && !Array.isArray(input));
  assert.deepEqual(Object.keys(input).sort(), ["version", "projectId", "sourceCommit", "accountDeletionId",
    "claimantManifestId", "claimTokenHash", "nativeParentRequest"].sort());
  assert.equal(input.version, "claimed-provenance-concurrency-native-fixture-v1");
  const { nativeParentRequest: parent, ...base } = input;
  assertClaimedProvenanceFixture({ ...base, version: "claimed-provenance-concurrency-fixture-v1" }, project, head);
  assert(parent && typeof parent === "object" && !Array.isArray(parent));
  assert.deepEqual(Object.keys(parent).sort(), ["version", "projectId", "sourceCommit", "accountId", "authSessionId",
    "deletionId", "nonceHash", "requestedAt", "noticeEndsAt"].sort());
  assert.equal(parent.version, "claimed-provenance-native-parent-request-v1");
  assert.equal(parent.projectId, project); assert.equal(parent.sourceCommit, head);
  assert.equal(parent.deletionId, input.accountDeletionId);
  for (const id of [parent.accountId, parent.authSessionId]) assert.match(id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  assert.equal(new Set([parent.accountId, parent.authSessionId, parent.deletionId, input.claimantManifestId]).size, 4);
  assert.match(parent.nonceHash, /^[0-9a-f]{64}$/u);
  assert(Number.isFinite(Date.parse(parent.requestedAt)) && Number.isFinite(Date.parse(parent.noticeEndsAt)));
  assert.equal(Date.parse(parent.noticeEndsAt) - Date.parse(parent.requestedAt), 7 * 86_400_000);
  return input;
}

/** Closed owner observation only. PIDs select the exact already started
 * children; the same backend start and application name are checked again
 * inside PostgreSQL before cancellation. This grants no deletion authority. */
export function claimedPairWaitSql(input) {
  assert(input && typeof input === "object" && !Array.isArray(input));
  assert.deepEqual(Object.keys(input).sort(), ["holderPid", "peerPid", "peerStartedAt", "peerName", "lockKey"].sort());
  for (const pid of [input.holderPid, input.peerPid]) assert(Number.isSafeInteger(pid) && pid > 0);
  assert.notEqual(input.holderPid, input.peerPid);
  assert.match(input.peerName, /^claimed-pair-owned-peer-[0-9a-f-]{36}-[01]$/u);
  assert(typeof input.peerStartedAt === "string" && Number.isFinite(Date.parse(input.peerStartedAt)));
  assert.match(input.lockKey, /^-?[0-9]+$/u);
  assert(BigInt(input.lockKey) >= -(2n ** 63n) && BigInt(input.lockKey) < 2n ** 63n);
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  return `do $watch$
declare until_at timestamptz:=clock_timestamp()+interval '3 seconds'; elapsed_ms numeric; cancelled boolean;
  peer_query_started_at timestamptz;
begin
  if current_user<>'postgres' then raise exception using errcode='42501',message='owner observation only';end if;
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists(select 1 from pg_catalog.pg_locks held join pg_catalog.pg_locks blocked
      on blocked.locktype=held.locktype and blocked.classid=held.classid and blocked.objid=held.objid
        and blocked.objsubid=held.objsubid
      join pg_catalog.pg_stat_activity peer on peer.pid=blocked.pid
      where held.pid=${input.holderPid} and held.granted and blocked.pid=${input.peerPid} and not blocked.granted
        and held.locktype='advisory' and held.classid=((${literal(input.lockKey)}::bigint>>32)&4294967295)::oid
        and held.objid=(${literal(input.lockKey)}::bigint&4294967295)::oid and held.objsubid=1
        and peer.backend_start=${literal(input.peerStartedAt)}::timestamptz
        and peer.application_name=${literal(input.peerName)} and peer.state='active' and peer.wait_event_type='Lock'
        and ${input.holderPid}=any(pg_catalog.pg_blocking_pids(peer.pid))) then
      select query_start into peer_query_started_at from pg_catalog.pg_stat_activity
        where pid=${input.peerPid} and backend_start=${literal(input.peerStartedAt)}::timestamptz
          and application_name=${literal(input.peerName)} and state='active' and wait_event_type='Lock';
      elapsed_ms:=extract(epoch from clock_timestamp()-peer_query_started_at)*1000;
      -- Stronger than the native lock-wait ceiling: the whole peer query must
      -- still be under250ms. Missing that observation is failed evidence.
      if elapsed_ms is null or elapsed_ms<0 or elapsed_ms>=250 then
        raise exception using errcode='55000',message='missed original claimant lock window';end if;
      -- Recheck the owned backend and actual blocker at the cancellation call.
      -- The receipt measures query age AFTER that call, not just detection.
      select pg_catalog.pg_cancel_backend(peer.pid) into cancelled from pg_catalog.pg_stat_activity peer
        where peer.pid=${input.peerPid} and peer.backend_start=${literal(input.peerStartedAt)}::timestamptz
          and peer.application_name=${literal(input.peerName)} and peer.query_start=peer_query_started_at
          and peer.state='active' and peer.wait_event_type='Lock'
          and ${input.holderPid}=any(pg_catalog.pg_blocking_pids(peer.pid));
      elapsed_ms:=extract(epoch from clock_timestamp()-peer_query_started_at)*1000;
      if cancelled is distinct from true or elapsed_ms is null or elapsed_ms<0 or elapsed_ms>=250 then
        raise exception using errcode='55000',message='owned cancellation missed original claimant lock window';end if;
      insert into pg_temp.claimed_pair_wait_receipt values(jsonb_build_object('version','claimed-pair-wait-v1',
        'exactPairWaiting',true,'exactOwnedPeer',true,'cancelled',cancelled,'queryElapsedMs',elapsed_ms));
      exit;
    end if;
    if clock_timestamp()>=until_at then raise exception using errcode='55000',message='exact pair wait not observed';end if;
    perform pg_catalog.pg_sleep(0.001);
  end loop;
end $watch$`;
}

export function assertClaimedPairWaitReceipt(value) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), ["version", "exactPairWaiting", "exactOwnedPeer", "cancelled", "queryElapsedMs"].sort());
  assert.equal(value.version, "claimed-pair-wait-v1");
  assert.equal(value.exactPairWaiting, true); assert.equal(value.exactOwnedPeer, true); assert.equal(value.cancelled, true);
  assert(typeof value.queryElapsedMs === "number" && Number.isFinite(value.queryElapsedMs)
    && value.queryElapsedMs >= 0 && value.queryElapsedMs < 250, "Original claimant lock window must be preserved");
}
