import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {describe,expect,it} from "vitest";
const sql=readFileSync("supabase/migrations/20261001039000_account_archive_readable_graph.sql","utf8"),md5=(value:string)=>createHash("md5").update(value).digest("hex");
describe("039 source contract only; SQL compilation/execution remains independent",()=>{
 it("owns one atomic DO, unique reserved version, no table/store/config/provider activation or transaction escape",()=>{
  expect(sql.match(/^do \$account_readable_graph\$/gmu)).toHaveLength(1);expect(sql.trim().endsWith("$account_readable_graph$;")).toBe(true);
  expect(readdirSync("supabase/migrations").filter(f=>f.startsWith("20261001039000_"))).toEqual(["20261001039000_account_archive_readable_graph.sql"]);
  expect(sql).not.toMatch(/\b(create table|disable trigger|session_replication_role|commit;|rollback;|ready|r2\.cloudflarestorage)\b/iu);
 });
 it("binds every literal old replacement body to its exact full predecessor fingerprint and checks its complete new body",()=>{
  const tags={base:"4f7c4ec08895cadaef8af585c92b37ae",original:"908e9ca92603692e81fcca9ceecf5afd",members:"36f818dc8b24f0f7ff9ceb431eb7ce46",
   metadata:"a98a2b8a43e494ebb6adc3c0f3ae290b",classes:"a4ee4685252291aba11c45d395a5e862"};
  for(const[tag,expected]of Object.entries(tags)){const before=sql.match(new RegExp(`old_body:=\\$old_${tag}\\$([\\s\\S]*?)\\$old_${tag}\\$;`))![1],
   after=sql.match(new RegExp(`new_body:=\\$new_${tag}\\$([\\s\\S]*?)\\$new_${tag}\\$;`))![1];
   expect(md5(before)).toBe(expected);expect(sql).toContain(`md5(p.prosrc)='${expected}'`);expect(sql).toContain(`md5(p.prosrc)='${md5(after)}'`);
  }
  expect(sql.match(/length\(definition\)-length\(replace\(definition,old_body,''\)\)/gu)).toHaveLength(5);
 });
 it("binds every seven new closed function body, exact ACL/config/ABI and unchanged current capture/038v1 predecessor",()=>{
  const functions=[...sql.matchAll(/create function ([a-z0-9_.]+)\(([\s\S]*?)\)\nreturns ([\s\S]*?)\bas \$\$([\s\S]*?)\$\$/gu)];
  expect(functions).toHaveLength(7);
  for(const match of functions){expect(sql).toContain(`md5(p.prosrc)='${md5(match[4])}'`);expect(sql).toContain(`revoke all on function ${match[1]}`);}
  for(const field of ["proowner","prokind","proargmodes","proallargtypes","proleakproof","provariadic","probin","prosupport","procost","prorows","prolang","prosecdef","proisstrict","provolatile","proparallel","prorettype","proretset","proargnames","proconfig","pronargdefaults","proargdefaults","aclexplode","is_grantable"])expect(sql).toContain(field);
  expect(sql).toContain("md5(p.prosrc)='838abdf91899078e4ebd2108855fa477'");expect(sql).toContain("md5(p.prosrc)='f5fbb5ed60b894d722fa417f5f43b104'");
  expect(sql).not.toMatch(/(?:replace|alter) function public\.export_archive_account_graph_rows_v1/u);
  expect(sql.match(/grant execute on function public\.[a-z0-9_]+/gu)).toEqual(["grant execute on function public.export_archive_account_graph_rows_v2","grant execute on function public.export_archive_account_path_b_v1"]);
 });
 it("preserves original owned/foreign/cohort science refusals, adds current actual stored-result and before/after complete source fences",()=>{
  const before=sql.match(/old_body:=\$old_base\$([\s\S]*?)\$old_base\$/u)![1],after=sql.match(/new_body:=\$new_base\$([\s\S]*?)\$new_base\$/u)![1];
  for(const marker of ["export_partition_projection_unavailable","c.status<>'purged'","g.revoked_at is null","s.subject_class in('self','other_adult')"]){expect(before).toContain(marker);expect(after).toContain(marker);}
  expect(sql).not.toContain("private.is_path_b_file_v1");
  const presence=sql.match(/create function private\.export_account_path_b_file_v1\([\s\S]*?as \$\$([\s\S]*?)\$\$/u)![1];
  expect(presence).not.toContain("auth.uid");expect(presence).toContain("f.user_id=s.owner_account_id");expect(presence).toContain("d.state='confirmed'");
  expect(sql).toContain("actor is null or actor->>'accountId' is distinct from p_origin->>'accountId'");
  expect(sql).toContain("private.path_b_report_authority_v1(b.file_id,b.grant_id,'export-source-read')");expect(sql).toContain("b.state<>'complete' or b.result is null or b.completed_at is null");
  expect(sql).toContain("not exists(select 1 from private.path_b_report_bindings x where x.file_id=gf.id");
  expect(sql).toContain("b.recipient_account_id=p_account");expect(sql).toContain("handling:='excluded'");
  expect(sql.match(/private\.export_account_owned_capture_v1\(permit->'origin','account',\(permit->>'targetId'\)::uuid\) is distinct from captured/gu)).toHaveLength(2);
 expect(sql).toContain("collate \"C\"");expect(sql).toContain("page_count<500");expect(sql).toContain("set lock_timeout='250ms'");
 });
 it("uses the genuine current Path B confirmation only for its exact classified source, retaining the ordinary binding predicate",()=>{
  const body=sql.match(/create function private\.export_account_ordinary_readable_authority_v1\([\s\S]*?as \$\$([\s\S]*?)\$\$/u)![1];
  expect(body).toContain("and private.export_account_path_b_file_v1(gf.id)) then");
  expect(body).toContain("person:=private.path_b_person_v1(a,sess,s.id)");
  expect(body).toContain("confirmation:=private.path_b_subject_v1(s.owner_account_id,s.id)");
  for(const marker of ["person->>'principalId' is distinct from confirmation->>'principalId'",
   "person->>'principalRevision' is distinct from confirmation->>'principalRevision'",
   "(confirmation->>'subjectBindingRevision')::bigint is distinct from s.subject_binding_revision",
   "(confirmation->>'subjectLifecycleRevision')::bigint is distinct from s.lifecycle_revision",
   "'draft',to_jsonb(d)","'subjectPrincipal',to_jsonb(sp)","'signature',to_jsonb(cs)","'artifact',to_jsonb(ca)","'contact',to_jsonb(e)",
   "cs.signer_account_id=a","cs.jurisdiction_revision=p.jurisdiction_revision","ca.superseded_at is null",
   "ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')",
   "e.authority_revision=sp.principal_revision","b.subject_id=s.id and b.account_id=a and b.status='current'",
   "if binding is null then raise exception using errcode='42501',message='not_found'"]){expect(body).toContain(marker);}
  expect(body).not.toMatch(/insert into public\.(?:subject_account_bindings|subject_principals|consent_signatures|purpose_grants)/u);
  expect(sql).toContain("md5(p.prosrc)='0d423a210e1e4972af3d11aed336b1f6'");
 });
 it("retains the exact original queued normalization/report assertions inside the new synthetic rollback fixture",()=>{
  const original=readFileSync("supabase/tests/path_b_queued_reports.sql","utf8"),marker=" 'only the exact completed queued report commits');",
   segment=original.slice(0,original.indexOf(marker)+marker.length).replace("begin;\n","").replace("select no_plan();\n","").replaceAll("\\ir fixtures/","\\ir "),
   included=readFileSync("supabase/tests/fixtures/account_export_saved_path_b.inc","utf8");expect(included.endsWith(segment+"\n")).toBe(true);
  const fixture=readFileSync("supabase/tests/account_archive_readable_graph.sql","utf8");expect(fixture).toContain("set constraints all immediate");
  expect(fixture).toContain("set local role service_role");expect(fixture).toContain('"role":"authenticated"');expect(fixture.trim().endsWith("select * from finish();rollback;")).toBe(true);
 });
});
