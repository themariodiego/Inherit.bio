import {createHash,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {prepareAccountPathBMembers,type AccountPathBRpc} from "./account-path-b-members";
import {savedPathBFixture,savedPathBReply} from "./__fixtures__/account-path-b";
function fixture(polygenic=false){
 const subject=randomUUID(),account=randomUUID(),saved=savedPathBFixture(subject,polygenic?"reports.polygenic":"reports.monogenic"),
  reference={exportId:randomUUID(),attemptId:randomUUID(),authorityReceipt:"a".repeat(64)},abort=new AbortController(),
  context={version:"account-archive-members-v1" as const,targetKind:"account" as const,targetId:account,authorityReceipt:reference.authorityReceipt,
   deadline:new Date(Date.now()+600000).toISOString(),capturedAt:"2026-10-01T00:00:00Z",actor:{accountId:account,sessionId:randomUUID()},fileCount:0,
   partitions:[{subjectId:subject,class:"ordinary" as const,fileCount:0,fileIds:[] as string[]}]},check=vi.fn<(signal:AbortSignal)=>Promise<void>>(async()=>{}),
  rpc=vi.fn<AccountPathBRpc>(async()=>structuredClone(savedPathBReply(subject,reference.authorityReceipt,saved)));
 return {options:{context,reference,signal:abort.signal,check,rpc},saved,rpc,check,abort};
}
async function bytes(source:AsyncIterable<Uint8Array>){const values=[];for await(const item of source)values.push(Buffer.from(item));return Buffer.concat(values).toString("utf8");}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("consumed actual saved Path B member protocol (mocked RPC, no database/provider credit)",()=>{
 it.each([false,true])("retains complete saved catalogue, outcomes, PRS and revision proofs (polygenic%s)",async polygenic=>{
  const f=fixture(polygenic),prepared=await prepareAccountPathBMembers(f.options);
  expect(prepared.records()).toEqual([f.saved.record]);expect(prepared.excludedHeldUploads).toBe(1);
  expect(prepared.resultSources).toEqual([{fileId:f.saved.value.fileId,subjectId:f.saved.value.subjectId,purpose:f.saved.value.purpose,
   bindingRevision:1,projection:"saved-path-b-results-v1",rawSourceDisposition:"held-original-out-of-scope",...f.saved.value.source}]);
  expect(prepared.factories.map(f=>f.name)).toEqual(["reports.json","prs.json","reports.txt"].map(n=>`subjects/${f.saved.value.subjectId}/${n}`));
  for(const kind of ["reports","prs"] as const){const member=prepared.factories.find(m=>m.name.endsWith(`/${kind}.json`))!,document=JSON.parse(await bytes(member.chunks(f.abort.signal)));
   expect(document.rows).toEqual([{fileId:f.saved.value.fileId,subjectId:f.saved.value.subjectId,purpose:f.saved.value.purpose,
    completedAt:f.saved.value.completedAt,bindingRevision:1,source:f.saved.value.source,...(kind==="reports"?{reports:f.saved.value.reports}:
     {prsCount:f.saved.value.prsCount,prsCoverage:f.saved.value.prsCoverage,disposition:"coverage-only-no-personal-score-published"})}]);
   expect(JSON.stringify(document)).not.toMatch(/raw_score|percentile|calibrated_risk/u);}
  const text=await bytes(prepared.factories.find(m=>m.name.endsWith("/reports.txt"))!.chunks(f.abort.signal));
  for(const fragment of ["Original saved finding","Original stored summary.","Original source","12345678","A/G","Source revision: 2",f.saved.value.source.decodedSha256])expect(text).toContain(fragment);
  expect(f.rpc.mock.calls.every(([name,args])=>name==="export_archive_account_path_b_v1"&&Object.keys(args).sort().join(",")==="p_attempt_id,p_authority_receipt,p_export_id,p_subject_id")).toBe(true);
  expect(JSON.stringify(prepared.resultSources)).not.toContain(f.options.context.actor.sessionId);
 });
 it("admits only independently proven zero inventory, without a result or raw-source member",async()=>{
  const f=fixture();f.rpc.mockResolvedValue(savedPathBReply(f.saved.value.subjectId,f.options.reference.authorityReceipt));
  const p=await prepareAccountPathBMembers(f.options);expect(p.factories).toEqual([]);expect(p.records()).toEqual([]);expect(p.resultSources).toEqual([]);await p.check(f.abort.signal);
 });
 it.each(["rpc-error","foreign-receipt","foreign-subject","missing-row","changed-hash","extra-secret","source-revision","catalog-layer","partial-catalog","wrong-computation","duplicate-outcome","unexpected-prs","nonfinite-score",
  "raw-score","calibrated-risk","percentile","nonfinite-coverage","count-mismatch","missing-count","fractional-count","duplicate-coverage","monogenic-coverage","missing-coverage"])('refuses %s before factories or archive writes',async mode=>{
  const f=fixture(["nonfinite-score","raw-score","calibrated-risk","percentile","nonfinite-coverage","duplicate-coverage"].includes(mode)),reply=structuredClone(savedPathBReply(f.saved.value.subjectId,f.options.reference.authorityReceipt,f.saved));
  if(mode==="rpc-error")f.rpc.mockResolvedValue({data:null,error:{code:"42501"}});
  else{const row=JSON.parse(reply.data.snapshot.records[0].rowText);if(mode==="foreign-receipt")reply.data.authorityReceipt="f".repeat(64);
   if(mode==="foreign-subject")reply.data.snapshot.subjectId=randomUUID();if(mode==="missing-row")reply.data.snapshot.records=[];
   if(mode==="changed-hash")reply.data.snapshot.sha256="f".repeat(64);if(mode==="extra-secret")row.sessionId=randomUUID();
   if(mode==="source-revision")row.source.normalizationRevision=3;if(mode==="catalog-layer")row.reports[0].catalogSnapshot.template.layer="estimate";
   if(mode==="partial-catalog")row.reports[0].catalogSnapshot.template.variants=[];if(mode==="wrong-computation")row.source.computationRevision=`path-b-reports-v1:${"e".repeat(64)}`;
   if(mode==="duplicate-outcome")row.reports[0].variants.push(row.reports[0].variants[0]);if(mode==="unexpected-prs")row.prs=[{pgs_id:"synthetic-score",raw_score:1,coverage:1,matched:1}];
   if(mode==="nonfinite-score")row.prsCoverage[0].raw_score=Infinity;if(mode==="raw-score")row.prsCoverage[0].raw_score=1;
   if(mode==="calibrated-risk")row.prsCoverage[0].calibrated_risk=0.1;if(mode==="percentile")row.prsCoverage[0].percentile=0.5;
   if(mode==="nonfinite-coverage")row.prsCoverage[0].coverage=Infinity;if(mode==="count-mismatch")row.prsCount=1;
   if(mode==="missing-count")delete row.prsCount;if(mode==="fractional-count")row.prsCount=0.5;
   if(mode==="duplicate-coverage"){row.prsCoverage.push(row.prsCoverage[0]);row.prsCount=2;}
   if(mode==="monogenic-coverage"){row.prsCoverage=[{pgs_id:"synthetic-score",coverage:1,matched:1}];row.prsCount=1;}
   if(mode==="missing-coverage")delete row.prsCoverage;
   if(reply.data.snapshot.records.length){reply.data.snapshot.records[0].rowText=JSON.stringify(row);
    if(!["changed-hash"].includes(mode))reply.data.snapshot.sha256=createHash("sha256").update(createHash("sha256").update("account-class-members-v1|path_b_report_bindings").digest())
     .update(`${reply.data.snapshot.records[0].id}:${reply.data.snapshot.records[0].subjectId}:${reply.data.snapshot.records[0].rowText}\n`).digest("hex");}
   f.rpc.mockResolvedValue(reply);}
  await expect(prepareAccountPathBMembers(f.options)).rejects.toThrow();
 });
 it("refuses a same-count changed saved result at member open and current revocation at member EOF",async()=>{
  const f=fixture(),p=await prepareAccountPathBMembers(f.options);f.saved.value.reports[0].variants[0].outcome.interpretation="Changed after capture";
  f.rpc.mockResolvedValue(savedPathBReply(f.saved.value.subjectId,f.options.reference.authorityReceipt,{...f.saved,snapshot:{...f.saved.snapshot,
   records:[{...f.saved.record,rowText:JSON.stringify(f.saved.value)}]}}));await expect(bytes(p.factories[0].chunks(f.abort.signal))).rejects.toThrow();
  const g=fixture(),current=await prepareAccountPathBMembers(g.options),iterator=current.factories[0].chunks(g.abort.signal)[Symbol.asyncIterator]();await iterator.next();
  g.check.mockRejectedValue(new Error("current authority revoked"));await expect((async()=>{for(;;)if((await iterator.next()).done)break;})()).rejects.toThrow("current authority revoked");
 });
 it.each(["rpc","authority"])('preserves the existing30-second %s bound and complete cancellation',async mode=>{
  const f=fixture();vi.useFakeTimers();if(mode==="rpc")f.rpc.mockImplementation(()=>new Promise(()=>{}));else f.check.mockImplementation(()=>new Promise(()=>{}));
  const pending=prepareAccountPathBMembers(f.options),refused=expect(pending).rejects.toThrow();await vi.advanceTimersByTimeAsync(30001);await refused;expect(vi.getTimerCount()).toBe(0);
 });
 it("refuses cancellation and expired jobs before any source selection",async()=>{
  const f=fixture();f.abort.abort();await expect(prepareAccountPathBMembers(f.options)).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
  const g=fixture();g.options.context.deadline=new Date(Date.now()-1).toISOString();await expect(prepareAccountPathBMembers(g.options)).rejects.toThrow();expect(g.rpc).not.toHaveBeenCalled();
 });
});
