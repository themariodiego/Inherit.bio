import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {ACCOUNT_GRAPH_CLASSES,accountGraphRowSchemas} from "../src/lib/exports/account-graph-projection";
const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
const source=read("supabase/migrations/20261001038000_account_archive_graph_rows.sql");
const prior=read("supabase/migrations/20261001029000_account_archive_class_inventory.sql");
describe("closed graph source extension without predecessor/authority replacement",()=>{
 it("pins the exact current capture/v1 bodies while leaving both original APIs and014 graph refusals untouched",()=>{
  for(const name of ["private.export_account_owned_capture_v1","public.export_archive_account_classes_v1"]){
   const escaped=name.replaceAll(".","\\.");const body=prior.match(new RegExp(`create function ${escaped}\\([^$]+?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1];
   expect(body).toBeDefined();expect(source).toContain(`md5(p.prosrc)='${createHash("md5").update(body!).digest("hex")}'`);
   expect(source).not.toMatch(new RegExp(`(?:create|alter|drop) (?:or replace )?function ${escaped}\\(`));
  }
  expect(source).toContain("p.pronargdefaults=2 and pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::text, NULL::uuid'");
  expect(source).toContain("p.proargnames=array['p_operation','p_export_id','p_attempt_id','p_authority_receipt','p_kind','p_after_id']");
  const original=read("supabase/migrations/20261001014000_account_archive_owned_members.sql");
  expect(original).toContain("raise exception using errcode='0A000',message='export_partition_projection_unavailable'");
 });
 it("creates exactly the reviewed one service-only door and two API-denied helpers without stores or provider/READY changes",()=>{
  expect([...source.matchAll(/^create function ([\w.]+)\(/gm)].map(m=>m[1])).toEqual([
   "private.export_account_graph_cursor_v1","private.export_account_graph_projection_v1","public.export_archive_account_graph_rows_v1"]);
  expect(source).toContain("grant execute on function public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb) to service_role;");
  for(const signature of ["private.export_account_graph_cursor_v1(text,jsonb)","private.export_account_graph_projection_v1(uuid,uuid[],text)"])
   expect(source).toContain(`revoke all on function ${signature} from public,anon,authenticated,service_role,inherit_upload_only;`);
  expect(source).not.toMatch(/create table|alter table|update public|insert into public|delete from|provider_version|status='ready'/i);
 });
 it("retains every explicit projected row field and no undeclared class in the SQL source",()=>{
  for(const kind of ACCOUNT_GRAPH_CLASSES){
   const marker=`p_kind='${kind}' then`,start=source.indexOf(marker,source.indexOf("create function private.export_account_graph_projection_v1"));
   expect(start).toBeGreaterThan(0);const end=source.indexOf("elsif p_kind=",start),part=source.slice(start,end<0?source.indexOf("else raise exception",start):end);
   const schema=accountGraphRowSchemas[kind];
   // The runtime output schema is independently closed; source drift must name
   // every registered field rather than accepting an opaque whole-row JSON.
   const shape=Object.keys(schema.shape);for(const field of shape)expect(part).toContain(`'${field}'`);
   expect(part).not.toMatch(/to_jsonb\(|statement_ciphertext|contact_email|wrapped_key/);
  }
 });
 it("requires actual attempt and whole capture on both sides, canonical real key ordering and independent full metadata digest",()=>{
  const body=source.slice(source.indexOf("create function public.export_archive_account_graph_rows_v1"));
  expect(body.match(/private\.export_account_archive_attempt_v1\(/g)).toHaveLength(2);
  expect(body.match(/private\.export_account_owned_capture_v1\(/g)).toHaveLength(2);
  expect(body).toContain("auth.jwt()->>'role' is distinct from 'service_role'");
  expect(body).toContain("captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions'");
  expect(body).toContain("page_count<500");expect(body).toContain("page_count=500");
  expect(body).toContain("coalesce((projected_key->>3)::bigint,0)");expect(body).toContain('collate "C"');
  expect(body).toContain("if total>9007199254740991 or not exists_after");
  expect(body).toContain("identity||':'||item.projected_row::text||E'\\n'");
 });
});
