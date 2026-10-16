import { readFileSync } from "node:fs";
import path from "node:path";
import { describe,it,expect } from "vitest";
import { checkedCompleteCopilotFacts, checkedCopilotOwnCompletions, COMPLETE_COPILOT_FACT_KEYS, remainingDensityRecipe, type CompleteCopilotFacts } from "./density-remaining-real-states";
import { densityCapturePlan } from "./density-capture-plan";
import type { DensityRegister } from "./density-current";
import { resolveResultSurfaceState, type SurfaceStateInput } from "../src/lib/embryos/access";
import { isUntouchedPendingInput, parsePendingEmbryoInput, type PendingEmbryoInput } from "../src/lib/embryos/pending-input";
import { untouchedPending } from "../src/lib/embryos/pending-input-fixture.test-support";
const read=(name:string)=>readFileSync(path.join(process.cwd(),name),"utf8");
const register=JSON.parse(read("docs/route-register.json")) as DensityRegister;
const copilot=read("e2e/helpers/density-remaining-copilot-state-fixtures.ts"),hp=read("e2e/helpers/density-health-picture-state-fixtures.ts");
const EXACT_SOURCE_HASHES = [
 'createHash("sha256").update(fs.readFileSync(path.join(input.root,name))).digest("hex")',
 'createHash("sha256").update(fs.readFileSync(path.join(input.root,s.name))).digest("hex")',
] as const;
/** Test-only exception for exactly the two complete fixed SHA256 file-read
 * expressions. Neither crypto generally nor arbitrary update calls are
 * allowed. Exact multiplicity closes changes to algorithm/path/chain. */
function readOnlyCopilotSource(source:string):string{
 let remainder=source;
 for(const expression of EXACT_SOURCE_HASHES){
  if(remainder.split(expression).length-1!==1)throw new Error("Exact source hash expression changed");
  remainder=remainder.replace(expression,"");
 }
 for(const forbidden of ['.insert(','.upsert(','.update(','.fulfill(','.setContent(','addInitScript','screenshot('])
  if(remainder.includes(forbidden))throw new Error("Provider source contains an unapproved write or substitute");
 return remainder;
}
const id=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;
function facts():CompleteCopilotFacts{
 const f=Object.fromEntries(COMPLETE_COPILOT_FACT_KEYS.map(k=>[k,[]])) as CompleteCopilotFacts;
 f.profiles=[{id:id(1),kept:"full"}];f.subjects=[{id:id(2),owner_account_id:id(1),subject_account_id:id(1),subject_class:"self",lifecycle:"active"}];
 f.principals=[{id:id(3),account_id:id(1),subject_id:id(2),principal_kind:"account_subject",status:"active"}];
 f.files=[{id:id(4),user_id:id(1),subject_id:id(2),status:"stored",sha256:"a".repeat(64),upload_revision:1,normalization_revision:1,single_logical_sample_verified_at:"2026-10-11T00:00:00Z"}];
 f.settings=[{user_id:id(1),provider:"openai_compatible",base_url:"https://model.copilot.test:8123/v1",model:"mock-model",key_last4:null}];
 f.chats=[{id:id(5),user_id:id(1),subject_id:id(2),scope_kind:"self",legacy_unverified:false,canonical_authority:{actual:"fixture-only-unit"}}];
 f.messages=[{chat_id:id(5),user_id:id(1),role:"user"},{chat_id:id(5),user_id:id(1),role:"assistant"}];return f;
}
describe("five remaining genuine-state correspondence and four additive source providers",()=>{
 it("derives only the actual four registered remaining pairs and leaves embryo empty held",()=>{
  const rows=densityCapturePlan(register,[]).states,actual=rows.filter(r=>remainingDensityRecipe(r));
  expect(actual.map(r=>[r.route.id,r.state])).toEqual([["app.overview","jurisdiction-unavailable"],["copilot.scope","complete"],["copilot.scope","not-covered"],["copilot.scope","jurisdiction-unavailable"]]);
  expect(remainingDensityRecipe(rows.find(r=>r.route.id==="embryos.detail" && r.state==="empty")!)).toBeNull();
 });
 it.each([{id:"family.health-picture"},{path:"/chat"},{kind:"endpoint"},{auth:"public"},{stateProfile:"own-product-result"}])("refuses foreign route identity %j",patch=>{
  const row=densityCapturePlan(register,[]).states.find(r=>r.route.id==="copilot.scope" && r.state==="complete")!;
  expect(remainingDensityRecipe({...row,route:{...row.route,...patch}} as typeof row)).toBeNull();
 });
 it.each(["empty","processing","consent-required","partial-coverage","awaiting-choice"])("does not adopt the original or waived Copilot state %s",state=>{
  const row=densityCapturePlan(register,[]).states.find(r=>r.route.id==="copilot.scope")!;expect(remainingDensityRecipe({...row,state})).toBeNull();
 });
 it("accepts complete source/current-chat bags without fabricating any native rows",()=>expect(()=>checkedCompleteCopilotFacts(facts(),id(1),id(4),id(5))).not.toThrow());
 it.each(["foreign-actor","missing-bag","extra-bag","wrong-source","pending-source","unverified","stale-revision","legacy-chat","foreign-chat","missing-turn","extra-turn","foreign-turn","paid-key","wrong-provider"])("refuses genuine complete-state prerequisite defect %s",fault=>{
  const f=facts();if(fault==="foreign-actor")f.profiles[0].id=id(9);else if(fault==="missing-bag")delete f.nonces;
  else if(fault==="extra-bag")f.unexpected=[];else if(fault==="wrong-source")f.files[0].id=id(9);else if(fault==="pending-source")f.files[0].status="uploaded";
  else if(fault==="unverified")f.files[0].single_logical_sample_verified_at=null;else if(fault==="stale-revision")f.files[0].normalization_revision=null;
  else if(fault==="legacy-chat")f.chats[0].legacy_unverified=true;else if(fault==="foreign-chat")f.chats[0].subject_id=id(9);
  else if(fault==="missing-turn")f.messages.pop();else if(fault==="extra-turn")f.messages.push({...f.messages[0]});else if(fault==="foreign-turn")f.messages[0].user_id=id(9);
  else if(fault==="paid-key")f.keys.push({secret:"unit-refusal"});else f.settings[0].base_url="http://localhost:8123/v1";
  expect(()=>checkedCompleteCopilotFacts(f,id(1),id(4),id(5))).toThrow();
 });
  it("uses the unchanged original native completion ABI with its genuine current-source predicate",()=>{
   const timestamp="2026-10-11T00:00:00Z";
   expect(()=>checkedCopilotOwnCompletions([{purpose:"reports.polygenic",complete:true,completed_at:timestamp}])).not.toThrow();
   expect(copilot).toContain("checkedCopilotOwnCompletions(completed)");
   expect(copilot).toContain("return { rows: facts, completions: completed }");
   const original=read("e2e/own-report-helpers.ts");
   for(const text of ["r.state='complete' and r.completed_at is not null", "r.source_revision=f.upload_revision",
     "r.source_sha256=f.sha256 and p.revoked_at is null and p.grant_revision=r.grant_revision", "r.completed_at"])
     expect(original).toContain(text);
  });
  it.each(["invented-fields","missing-time","invalid-time","incomplete","wrong-purpose","extra-row","extra-field"])("refuses native completion ABI defect %s",fault=>{
   const row:Record<string,unknown>={purpose:"reports.polygenic",complete:true,completed_at:"2026-10-11T00:00:00Z"};
   const rows:unknown[]=[row];
   if(fault==="invented-fields")rows[0]={purpose:"reports.polygenic",state:"complete",completed:true,same_source:true,live_exact_purpose:true};
   else if(fault==="missing-time")row.completed_at=null;else if(fault==="invalid-time")row.completed_at="not-a-time";
   else if(fault==="incomplete")row.complete=false;else if(fault==="wrong-purpose")row.purpose="reports.monogenic";
   else if(fault==="extra-row")rows.push({...row});else row.extra=true;
   expect(()=>checkedCopilotOwnCompletions(rows)).toThrow();
  });
  it("retains the actual original canonical source/citation/history/permission audit rather than seeded answer rows",()=>{
  for(const fragment of ['await uploadOwnFileWithChosenReports','await allowCopilot(page)','await startCopilotFixture(MOCK_PORT)',
   'expectedCaffeineCitations(report)','expect(report.unavailable_sources).toEqual([])','const savedHistory=await historyResponse.json()',
   'expect(savedHistory.messages).toHaveLength(2)','expect((await fixture.snapshot()).calls).toBe(2)',
   'await currentHistory()','await ownRunCompletions(fileId)','checkedCompleteCopilotFacts(facts,accountId,fileId,chatId)'])expect(copilot).toContain(fragment);
  for(const forbidden of ['.insert(','.upsert(','.update(','.fulfill(','.setContent(','addInitScript','screenshot('])expect(readOnlyCopilotSource(copilot)).not.toContain(forbidden);
 });
 it("keeps original independent main, OFF and local attested origins with no aggregate normalization",()=>{
  expect(copilot).toContain('input.localModelOrigin==="http://localhost:3103"');expect(copilot).toContain('checkedAppEnvironment(await input.readActualAppEnvironment(appOrigin)');
  expect(hp).toContain('const OFF = "http://localhost:3101"');expect(hp).toContain('const main = checkedAppEnvironment(await readActualAppEnvironment(origin.origin), 3100)');
  expect(hp).toContain('const off = checkedAppEnvironment(await readActualAppEnvironment("http://localhost:3101"), 3101)');
  expect(hp).toContain('return healthPictureFixtures(input, "health-picture")');expect(hp).toContain('return healthPictureFixtures(input, "overview-jurisdiction", input.readActualAppEnvironment)');
 });
 it("retains current native declaration/attestation and full no-read refusal facts",()=>{
  for(const fragment of ['await page.request.put("/api/settings/jurisdiction"','artifact.body_sha256','assertFreshJurisdictionRows(facts, accountId, denied)',
   'await unopenedRows(accountId)','expect(nativeSnapshot).toEqual(original)','await assertJurisdiction(page)','await assertUnavailable(page)','expect(apiWrites).toEqual([])'])expect(copilot).toContain(fragment);
 });
 it("keeps genuine whole Overview control/refusal shape and every current Family bag",()=>{
  const original=read('e2e/family-health-picture.spec.ts');const start=original.indexOf('  const OFF = "http://localhost:3101";');
  const end=original.indexOf('\n});\n\n/**\n * `/family/health-picture partial-coverage`',start);
  expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
  expect(hp).toContain(original.slice(start,end).replace('  await signIn(page, A.email, A.password);\n  await passGate(page);\n',''));
  expect(hp).toContain('expect(nativeSnapshot, "Every complete actual Health Picture protected row remains current around capture").toEqual(fixed)');
  expect(hp).toContain('routeId: row.route.id, state: row.state');
 });
 it("keeps pending processing except for the exact native untouched-input exception and retains original browser checks",()=>{
  const resolver=read('src/lib/embryos/access.ts'),fixture=read('e2e/embryos.spec.ts');
  const untouched=resolver.indexOf('if (input.cohort.status === "upload_pending" && input.embryoStatus === "pending"');
  const processing=resolver.indexOf('if (input.cohort.status === "ingesting" || input.embryoStatus === "pending") return "processing";');
  const originalEmpty=resolver.indexOf('if (input.cohort.status === "upload_pending") return "empty";');
  for(const index of [untouched,processing,originalEmpty])expect(index).toBeGreaterThan(0);
  expect(untouched).toBeLessThan(processing);expect(processing).toBeLessThan(originalEmpty);
  const exception=resolver.slice(untouched,processing);
  for(const exact of ['input.pendingInput?.cohortId === input.cohort.id','input.pendingInput.embryoId === input.embryoId',
   'input.pendingInput.subjectId === input.subjectId','input.pendingInput.accountId === input.accountId',
   'isUntouchedPendingInput(input.pendingInput)) return "empty";'])expect(exception).toContain(exact);
  expect(resolver.indexOf('if (input.decision.status !== "permitted")')).toBeLessThan(untouched);
  expect(fixture).toContain('cohortStatus: "upload_pending",\n    embryos: [{ ordinal: 0, status: "qc_pass", callRate: 0.99 }]');
  expect(read('supabase/migrations/20260905103317_embryo_cohort_runtime.sql')).toContain("v_cohort_id, v_subject_id, v_ordinal, 'pending'");
 });
});

describe("exact source-hash exception retains no-write refusal",()=>{
 it("admits only the actual two complete read-only SHA256 expressions once each",()=>{
  const remainder=readOnlyCopilotSource(copilot);
  for(const expression of EXACT_SOURCE_HASHES)expect(remainder).not.toContain(expression);
  expect(copilot.split(EXACT_SOURCE_HASHES[0]).length-1).toBe(1);
  expect(copilot.split(EXACT_SOURCE_HASHES[1]).length-1).toBe(1);
 });
 it.each(["insert","update","upsert","algorithm","argument","chain","extra-update","duplicate-first","duplicate-second","missing-expression"])("refuses injected/altered source %s",fault=>{
  let altered=copilot;
  if(["insert","update","upsert"].includes(fault))altered+=`\nawait admin.from("subjects").${fault}({id:"injected"});`;
  else if(fault==="algorithm")altered=altered.replace(EXACT_SOURCE_HASHES[0],EXACT_SOURCE_HASHES[0].replace('"sha256"','"sha512"'));
  else if(fault==="argument")altered=altered.replace(EXACT_SOURCE_HASHES[0],EXACT_SOURCE_HASHES[0].replace('input.root,name','input.root,"other-file"'));
  else if(fault==="chain")altered=altered.replace(EXACT_SOURCE_HASHES[1],EXACT_SOURCE_HASHES[1].replace('.digest("hex")','.digest("base64")'));
  else if(fault==="extra-update")altered+=`\n${EXACT_SOURCE_HASHES[0]}.update("injected");`;
  else if(fault==="duplicate-first")altered+=`\n${EXACT_SOURCE_HASHES[0]}`;
  else if(fault==="duplicate-second")altered+=`\n${EXACT_SOURCE_HASHES[1]}`;
  else altered=altered.replace(EXACT_SOURCE_HASHES[1],"");
  expect(()=>readOnlyCopilotSource(altered)).toThrow();
 });
});

/** Pure native-format controls are not runtime captures. The genuine V30
 * provider must still finalize and read its actual complete current row bags. */
function pendingDetailFixture(): { base: SurfaceStateInput; pendingInput: PendingEmbryoInput } {
 const pendingInput=untouchedPending();
 const base:SurfaceStateInput={
  decision:{capability:"embryo_analysis",status:"permitted",userFacingCopy:"copy",jurisdictionCode:null,source:"unset"},
  cohort:{id:pendingInput.cohortId,status:"upload_pending",createdAt:"2026-09-01T00:00:00.000Z",embryoCount:2,
   viewerRole:"required_upload_principal",requiredUploadPrincipalAccountIds:[pendingInput.accountId],
   requiredUploadPrincipalsWithoutAccount:0,analysisGranted:false,analysisGrantsMissing:2,viewerAnalysisGranted:false,
   embryos:[],retentionExpiresAt:"2028-09-01T00:00:00.000Z"},
  embryoStatus:"pending",embryoId:pendingInput.embryoId,subjectId:pendingInput.subjectId,accountId:pendingInput.accountId,
  acknowledged:false,
 };
 return {base,pendingInput};
}

describe("native untouched-input exception remains narrow and source-bound",()=>{
 it("requires one strict native snapshot instead of pending status or a made-up passing QC",()=>{
  const {base,pendingInput}=pendingDetailFixture();
  const scope={accountId:pendingInput.accountId,cohortId:pendingInput.cohortId,embryoId:pendingInput.embryoId,subjectId:pendingInput.subjectId};
  expect(parsePendingEmbryoInput(pendingInput,scope)).toEqual(pendingInput);
  expect(pendingInput.qcCount).toBe(0);expect(pendingInput.embryoStatus).toBe("pending");
  expect(isUntouchedPendingInput(pendingInput)).toBe(true);
  expect(resolveResultSurfaceState({...base,pendingInput})).toBe("empty");
  expect(resolveResultSurfaceState(base)).toBe("processing");
 });
 it("refuses null, unknown and malformed snapshots rather than treating them as empty evidence",()=>{
  const {base,pendingInput}=pendingDetailFixture();
  const scope={accountId:pendingInput.accountId,cohortId:pendingInput.cohortId,embryoId:pendingInput.embryoId,subjectId:pendingInput.subjectId};
  const missingCount={...pendingInput} as Partial<PendingEmbryoInput>;delete missingCount.fileCount;
  for(const [name,raw] of [["null",null],["unknown",{}],["missing-count",missingCount],
   ["null-count",{...pendingInput,fileCount:null}],["negative-count",{...pendingInput,fileCount:-1}],
   ["extra-field",{...pendingInput,cookie_hash:"refusal-only-unit"}],
   ["unknown-session",{...pendingInput,sessions:[{...pendingInput.sessions[0],status:"unknown"}]}]] as const){
   expect(parsePendingEmbryoInput(raw,scope),name).toBeNull();
   expect(isUntouchedPendingInput(raw as unknown as PendingEmbryoInput),name).toBe(false);
   expect(resolveResultSurfaceState({...base,pendingInput:raw as unknown as PendingEmbryoInput}),name).toBe("processing");
  }
 });
 it("does not borrow another selected account, cohort, embryo or subject's snapshot",()=>{
  const {base,pendingInput}=pendingDetailFixture();
  const scope={accountId:pendingInput.accountId,cohortId:pendingInput.cohortId,embryoId:pendingInput.embryoId,subjectId:pendingInput.subjectId};
  for(const key of ["accountId","cohortId","embryoId","subjectId"] as const){
   const foreign={...pendingInput,[key]:"ffffffff-ffff-4fff-8fff-ffffffffffff"};
   expect(parsePendingEmbryoInput(foreign,scope),key).toBeNull();
   expect(resolveResultSurfaceState({...base,pendingInput:foreign}),key).toBe("processing");
  }
 });
 it("keeps every native file, QC, reservation and queued/running work count processing",()=>{
  const {base,pendingInput}=pendingDetailFixture();
  for(const field of ["fileCount","qcCount","chunkCount","fragmentCount","workCount","activeWorkCount"] as const){
   const active={...pendingInput,[field]:1,...(field==="activeWorkCount"?{workCount:1}:{})};
   expect(isUntouchedPendingInput(active),field).toBe(false);
   expect(resolveResultSurfaceState({...base,pendingInput:active}),field).toBe("processing");
  }
  for(const field of ["acceptedBytes","acceptedChunks","acceptedRecords","expectedNextSequence"] as const){
   const reserved={...pendingInput,sessions:[{...pendingInput.sessions[0],[field]:1}]};
   expect(isUntouchedPendingInput(reserved),field).toBe(false);
   expect(resolveResultSurfaceState({...base,pendingInput:reserved}),field).toBe("processing");
  }
  const running={...pendingInput,workCount:1,activeWorkCount:1};
  expect(resolveResultSurfaceState({...base,pendingInput:running})).toBe("processing");
  expect(resolveResultSurfaceState({...base,pendingInput:{...pendingInput,fileCount:1,qcCount:0}})).toBe("processing");
 });
 it("retains stale/expired/completed refusal, jurisdiction precedence and active/ingesting processing",()=>{
  const {base,pendingInput}=pendingDetailFixture();
  for(const sessions of [[],[{...pendingInput.sessions[0],expiresAt:pendingInput.snapshotAt}],
   [{...pendingInput.sessions[0],ingestRevision:2}],[{...pendingInput.sessions[0],lifecycleRevision:2}],
   [{...pendingInput.sessions[0],completedAt:pendingInput.snapshotAt}],
   [{...pendingInput.sessions[0],workerJobId:pendingInput.embryoId}],
   [{...pendingInput.sessions[0],status:"sanitization_pending" as const}]]){
   const stale={...pendingInput,sessions};
   expect(isUntouchedPendingInput(stale)).toBe(false);
   expect(resolveResultSurfaceState({...base,pendingInput:stale})).toBe("processing");
  }
  expect(resolveResultSurfaceState({...base,pendingInput,decision:{...base.decision,status:"unreviewed"}})).toBe("jurisdiction-unavailable");
  for(const status of ["ingesting","active"] as const)
   expect(resolveResultSurfaceState({...base,cohort:{...base.cohort!,status},pendingInput})).toBe("processing");
 });
 it("keeps unknown native reads an explicit refusal and captures the actual before-file page with whole current bags",()=>{
  const reader=read("src/lib/embryos/pending-input-read.ts"),page=read("src/app/(app)/embryos/[embryoId]/page.tsx");
  expect(reader).toContain('result.error === null ? parsePendingEmbryoInput(result.data, expected.data) : null');
  expect(reader).toContain('if (!parsed) throw unavailable();');
  expect(page).toContain('if (permits(cohortDecision) && cohort.status === "upload_pending" && embryo.status === "pending")');
  expect(page).toContain('if (pendingInputReadFailed)');expect(page).toContain('{READ_FAILED_SENTENCE}');
  const provider=read("e2e/density-embryo-empty-state-fixtures.ts"),journey=read("e2e/participant-c-journey.ts");
  for(const exact of ['new URL(input.page.url()).origin !== "http://localhost:3105"','await withEmbryoJourney(input.environment',
   'await seedParticipantC(','beforeFile: async scope =>','await readPendingEmbryoInput(adminClient(), selection)',
   'toEqual([scope.nativeSessionId])','expect(await pendingBag(scope.cohortId)).toBe(before)',
   'await scope.ownerPage.context().newPage()','toHaveAttribute("data-state", "empty")',
   'finally { await readPage.close(); }','finally { await journey.closeCoParent(); }'])expect(provider).toContain(exact);
  expect(provider).not.toMatch(/\.(insert|update|upsert)\(|setContent\(|route\.fulfill/u);
  expect(journey.indexOf("await options.beforeFile")).toBeGreaterThan(journey.indexOf("await signStatements(page, FINALIZE_BUTTON, owner)"));
  expect(journey.indexOf("await options.beforeFile")).toBeLessThan(journey.indexOf(".setInputFiles(path.resolve(fixture))"));
  expect(journey).toContain('expect(reserved.data!.map(row => row.status)).toEqual(["pending", "pending"])');
  expect(journey).toContain("await runtime.runWorker(cohortId)");
  expect(journey).toContain("allPartsCurrent: true, pendingOrdinals: 0, pendingVariants: 0");
 });
});
