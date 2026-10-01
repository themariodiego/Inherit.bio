import {readFileSync} from "node:fs";
import type {SupabaseClient} from "@supabase/supabase-js";
import {describe,expect,it,vi} from "vitest";
import type {Database} from "@/lib/supabase/types";
import {readEmbryoQcRows} from "./qc-reader";
import {syntheticQcRow} from "./synthetic";
import {projectQc} from "./projection";
import {EMBRYO_INGEST_SESSION_LIMITS as LIMITS} from "../genome/ingest-limits";
const cohort="ad340000-0000-4000-8000-000000000001",embryo="ad340000-0000-4000-8000-000000000002";
function fixture(){
 const row=syntheticQcRow(embryo,{sites_expected:1200,sites_called:1184,call_rate:1184/1200});
 const rpc=vi.fn<(name:string,args:{p_cohort_id:string;p_embryo_ids:string[]})=>Promise<{data:unknown;error:unknown}>>(async()=>({data:[structuredClone(row)],error:null}));
 return {row,rpc,client:{rpc} as unknown as SupabaseClient<Database>};
}
describe("bounded exact QC JSON consumer",()=>{
 it("preserves every field and exact nonterminating count ratio without reconstruction",async()=>{
  const f=fixture(),actual=await readEmbryoQcRows(f.client,cohort,[embryo]);
  expect(actual).toEqual({data:[f.row],error:null});expect(f.row.call_rate).toBe(0.9866666666666667);
  expect(projectQc(actual.data![0]).call_rate).toBe(1184/1200);
  expect(f.rpc.mock.calls).toEqual([["read_embryo_qc_rows_v1",{p_cohort_id:cohort,p_embryo_ids:[embryo]}]]);
 });
 it("retains strict ratio refusal for the actually observed truncated JSON value",async()=>{
  const f=fixture();f.row.call_rate=0.986666666666667;
  const result=await readEmbryoQcRows(f.client,cohort,[embryo]);
  expect(result.data![0].call_rate).toBe(0.986666666666667);
  expect(()=>projectQc(result.data![0])).toThrow("receipt needs the measured count ratio");
 });
 it.each(["missing","foreign","duplicate","extra-field","receipt"])("refuses %s response without a partial list",async fault=>{
  const f=fixture();const rows:unknown[]=fault==="missing"?[]:fault==="duplicate"?[f.row,f.row]:[
   fault==="foreign"?{...f.row,embryo_id:cohort}:fault==="extra-field"?{...f.row,hidden:"private"}:
    fault==="receipt"?{...f.row,figure_basis:{...f.row.figure_basis,producer:"invented"}}:f.row];
  f.rpc.mockResolvedValue({data:rows as typeof f.row[],error:null});
  expect(await readEmbryoQcRows(f.client,cohort,[embryo])).toEqual({data:null,error:{message:"QC read unavailable"}});
 });
 it.each([[],[embryo,embryo],["foreign"],Array(65).fill(embryo)])("refuses malformed identity selection %j before RPC",async ids=>{
  const f=fixture();expect((await readEmbryoQcRows(f.client,cohort,ids)).error).not.toBeNull();expect(f.rpc).not.toHaveBeenCalled();
 });
 it("uses the original registered64-sample capacity rather than a narrower new cap",()=>{
  const register=JSON.parse(readFileSync("docs/route-register.json","utf8"));
  expect(register.payloadBoundaryContract.embryoIngestSessionLimits.maximumSampleColumns).toBe(64);
  expect(LIMITS.maximumSampleColumns).toBe(64);
 });
 it("accepts a complete64-embryo response at the original registered maximum",async()=>{
  const f=fixture(),ids=Array.from({length:64},(_,i)=>`ad340000-0000-4000-8000-${(i+1).toString(16).padStart(12,"0")}`);
  const rows=ids.map(id=>({...f.row,embryo_id:id}));f.rpc.mockResolvedValue({data:rows,error:null});
  expect(await readEmbryoQcRows(f.client,cohort,ids)).toEqual({data:rows,error:null});
 });
 it("retains both actual page authority gates ahead of the precise reader",()=>{
  const detail=readFileSync("src/app/(app)/embryos/[embryoId]/page.tsx","utf8"),compare=readFileSync("src/app/(app)/embryos/compare/page.tsx","utf8");
  expect(detail).toContain('case "complete":');expect(detail.indexOf('case "complete":')).toBeLessThan(detail.indexOf("detail = await loadDetail("));
  expect(compare).toContain('case "complete":');expect(compare.indexOf('case "complete":')).toBeLessThan(compare.indexOf("comparison = await loadComparison("));
  expect(detail).toContain("readEmbryoQcRows(admin, input.embryo.cohortId, [input.embryo.id])");
  expect(compare).toContain("readEmbryoQcRows(admin, cohort.id, embryoIds)");
 });
});
