import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,it} from "vitest";

const read=(name:string)=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
const source=read("20261001035000_historical_embryo_producer_clocks.sql");
const runtime=read("20260905103317_embryo_cohort_runtime.sql");
const controls=read("20260930250000_embryo_disposition_controls.sql");
const mail=read("20260930239000_mail_queue_creation_clock.sql");
function body(sql:string,name:string){
  const start=sql.indexOf(`function ${name}(`);if(start<0)throw new Error("Missing exact producer");
  const value=sql.slice(start).match(/\bas\s*\$\$([\s\S]*?)\$\$/u)?.[1];
  if(value===undefined)throw new Error("Missing complete producer body");return value;
}
const md5=(value:string)=>createHash("md5").update(value).digest("hex");

it("pins every complete real predecessor and exact ABI/config/default/owner/effective ACL before any durable definition",()=>{
  for(const [sql,name] of [[controls,"public.record_embryo_disposition_v1"],[runtime,"public.record_embryo_disposition_v1"],
    [controls,"private.embryo_disposition_authority_v1"],[runtime,"private.close_embryo_disposition_proposal_v1"],
    [mail,"private.enqueue_embryo_principal_mail_v1"]])expect(source).toContain(md5(body(sql,name)));
  for(const guard of ["owner_role.rolname='postgres'","lang.lanname='plpgsql'","p.prokind='f'",
    "not p.proretset and not p.proleakproof","p.provolatile='v' and p.proparallel='u'","p.proargnames=expected.argument_names",
    "p.proconfig=array['search_path=\"\"']","md5(p.prosrc)=expected.body_hash","p.provariadic=0",
    "p.proallargtypes is null and p.proargmodes is null","pg_get_expr(p.proargdefaults,0)='false'",
    "acl.grantor<>p.proowner","has_function_privilege(api,predecessor,'execute') is distinct from",
    "message='historical producer core already exists'","pg_get_constraintdef(c.oid)=",
    "message='historical producer clock constraint differs'"])expect(source).toContain(guard);
  expect(source.indexOf("$historical_predecessors$;")).toBeLessThan(source.indexOf("create function private."));
});

it("preserves the entire mail algorithm and its exact post-lock real creation point without duplication or expiry clamping",()=>{
  let core=body(source,"private.enqueue_embryo_principal_mail_clock_core_v1");
  core=core.replace("  if p_created_at is not null and not isfinite(p_created_at) then\n    raise exception using errcode='22023',message='invalid mail creation clock';end if;\n","")
    .replace("v_created_at := coalesce(p_created_at,pg_catalog.clock_timestamp());","v_created_at := pg_catalog.clock_timestamp();");
  expect(core).toBe(body(mail,"private.enqueue_embryo_principal_mail_v1"));
  const actual=body(source,"private.enqueue_embryo_principal_mail_clock_core_v1");
  expect(actual.indexOf("return v_outbox_id;")).toBeLessThan(actual.indexOf("select sp.*"));
  expect(actual.indexOf("v_created_at :=")).toBeGreaterThan(actual.lastIndexOf("for update;"));
  expect(body(source,"private.enqueue_embryo_principal_mail_v1")).toMatch(/_clock_core_v1\([^;]+,null\);/u);
  expect(body(source,"private.enqueue_embryo_principal_mail_v1")).not.toMatch(/clock_timestamp|insert|for update|least\(/u);
  expect(source.match(/insert into public\.mail_outbox/g)).toHaveLength(1);
  expect(source).not.toMatch(/set_config|current_setting|p_test|test_mode|p_expires_at\s*:=/iu);
});

it("preserves the complete disposition algorithm outside current preconditions and its four precise clock propagations",()=>{
  let core=body(source,"private.record_embryo_disposition_clock_core_v1");
  core=core.replace("v_now timestamptz := coalesce(p_now,clock_timestamp());","v_now timestamptz := clock_timestamp();")
    .replace("  if p_now is not null and not isfinite(p_now) then\n    raise exception using errcode='22023',message='invalid disposition clock';end if;\n","")
    .replace("  if p_action is null or p_disposition is null or p_action not in ('propose','confirm','commit-single-authority')\n    or p_disposition not in ('stored','transferred','donated','discarded')\n    or (p_action='confirm')<>(p_proposal_id is not null)\n  then raise exception using errcode='22023',message='invalid disposition request';end if;\n","")
    .replace("  perform private.embryo_disposition_authority_v1(p_account_id,p_session_id,p_embryo_id,true);\n","")
    .replace("private.close_embryo_disposition_proposal_at_v1(v_existing.id, 'expired', 'proposal_lapsed',coalesce(p_now,clock_timestamp()))","private.close_embryo_disposition_proposal_v1(v_existing.id, 'expired', 'proposal_lapsed')")
    .replace("private.close_embryo_disposition_proposal_at_v1(v_proposal.id, 'confirmed', 'proposal_confirmed',coalesce(p_now,clock_timestamp()))","private.close_embryo_disposition_proposal_v1(v_proposal.id, 'confirmed', 'proposal_confirmed')")
    .replace("authority_set_revision, status, expires_at, created_at\n","authority_set_revision, status, expires_at\n")
    .replace("v_cohort.participant_set_revision, 'pending', v_now + interval '7 days', coalesce(p_now,clock_timestamp())\n","v_cohort.participant_set_revision, 'pending', v_now + interval '7 days'\n")
    .replace("private.enqueue_embryo_principal_mail_clock_core_v1(","private.enqueue_embryo_principal_mail_v1(")
    .replace("v_now + interval '30 days', null, null, p_now\n","v_now + interval '30 days', null, null\n");
  expect(core).toBe(body(runtime,"public.record_embryo_disposition_v1"));
  expect(body(source,"private.record_embryo_disposition_before_current_authority_v1")).toContain("p_proposal_id,p_token_nonce,null);");
  expect(body(source,"private.record_embryo_disposition_before_current_authority_v1")).not.toMatch(/clock_timestamp|p_now|insert|for update/u);
  const actual=body(source,"private.record_embryo_disposition_clock_core_v1");
  expect(actual).toContain("v_now timestamptz := coalesce(p_now,clock_timestamp());");
  expect(actual).toContain("'pending', v_now + interval '7 days', coalesce(p_now,clock_timestamp())");
  expect(actual).toContain("v_now + interval '30 days', null, null, p_now");
  expect(source).not.toMatch(/(?:create|alter|grant|revoke)[^;]*public\.record_embryo_disposition_v1/iu);
  expect(source).not.toMatch(/update\s+public\.consent_signatures|alter\s+table|disable\s+trigger|UPDATE.*transferred_at\s*=/u);
});

it("preserves the full proposal-close algorithm and denies every new clock core to all API roles",()=>{
  const core=body(source,"private.close_embryo_disposition_proposal_at_v1")
    .replace("v_now timestamptz := p_now;","v_now timestamptz := clock_timestamp();")
    .replace("  if p_now is null or not isfinite(p_now) then\n    raise exception using errcode='22023',message='invalid proposal clock';end if;\n","");
  expect(core).toBe(body(runtime,"private.close_embryo_disposition_proposal_v1"));
  expect(body(source,"private.close_embryo_disposition_proposal_v1")).toContain("p_proposal_id,p_status,p_outcome_code,clock_timestamp());");
  for(const name of ["record_embryo_disposition_at_v1","close_embryo_disposition_proposal_at_v1",
    "enqueue_embryo_principal_mail_at_v1","enqueue_embryo_principal_mail_clock_core_v1","record_embryo_disposition_clock_core_v1"]){
    expect(source).toMatch(new RegExp(`revoke all on function private\\.${name}\\([^;]+\\)\\s+from public,anon,authenticated,inherit_upload_only,service_role;`,"u"));
    expect(source).not.toMatch(new RegExp(`grant[^;]*private\\.${name}`,"iu"));
  }
  for(const name of ["record_embryo_disposition_at_v1","close_embryo_disposition_proposal_at_v1","enqueue_embryo_principal_mail_at_v1"])
    expect(body(source,`private.${name}`)).toMatch(/if p_(now|created_at) is null or not isfinite\(p_(now|created_at)\)/u);
});

it("keeps native issuance separate from the bounded owner fixture and leaves all public release clocks alone",()=>{
  const helper=readFileSync(new URL("../e2e/helpers/historical-embryo-transfer.ts",import.meta.url),"utf8");
  const executor=readFileSync(new URL("./tools/historical-embryo-transfer.run.mts",import.meta.url),"utf8");
  expect(helper).toContain('await route.abort("aborted")');
  expect(helper).not.toMatch(/route\.fulfill|postData:\s*|mintEmbryoOperation|verifiedHistoricalPair/u);
  expect(helper).toContain('expect(await proof(embryo)');
  expect(executor).toContain('const verified=verifiedHistoricalPair(value)');
  expect(executor).toContain('process.stdin.on("data"');
  expect(executor).toContain('source.source_sha256=private.embryo_canonical_source_sha256_v1(source.file_id)');
  expect(executor).not.toMatch(/source\.state|set_config|current_setting|update\s+public\.embryos/iu);
  expect(executor).toContain("time-compressed-synthetic-owner-producer");
  expect(source).not.toMatch(/(?:create|alter|grant|revoke)[^;]*(?:release_keyless|final_keyless|complete_keyless|keyless_release)/iu);
});
