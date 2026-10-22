import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, signIn } from "../helpers";
import { ownRunCompletions, uploadOwnFileWithChosenReports } from "../own-report-helpers";
import { allowCopilot, CAFFEINE_ANSWER, CAFFEINE_PROMPT, CAFFEINE_SLUG, COPILOT_MODEL_HOST,
  expectClosedCompletion, expectedCaffeineCitations, lastToolResult, saveCopilotProvider, startCopilotFixture,
  type CopilotFixture } from "../fixtures/canonical-copilot-browser";
import { COPY_IDS, FAMILY_SCOPE_LABEL } from "../../src/copy/copilot/group-scopes";
import { checkedAppEnvironment } from "../../scripts/ci-browser-config";
import { assertFreshJurisdictionRows, DENSITY_TEST_DENY_SENTENCE, type FreshJurisdictionRows } from "../../scripts/density-jurisdiction-states";
import { checkedCompleteCopilotFacts, checkedCopilotOwnCompletions, COMPLETE_COPILOT_FACT_KEYS, remainingDensityRecipe, type CompleteCopilotFacts } from "../../scripts/density-remaining-real-states";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";

type Environment = Readonly<Record<string,string|undefined>>;
type Viewport = typeof DENSITY_VIEWPORTS[number];
const SOURCES = Object.freeze([
 "scripts/density-remaining-real-states.ts", "scripts/density-jurisdiction-states.ts", "scripts/density-capture-plan.ts",
 "scripts/density-current.ts", "scripts/ci-browser-config.ts", "scripts/owned-linux-runtime.ts",
 "scripts/local-e2e-project.ts", "e2e/fixtures/canonical-copilot-browser.ts", "e2e/fixtures/canonical-copilot-provider.ts",
 "e2e/copilot.spec.ts", "e2e/copilot-family.spec.ts", "e2e/copilot-group-scopes.spec.ts", "e2e/own-report-helpers.ts",
 "e2e/helpers.ts", "src/app/(app)/copilot/[scope]/page.tsx", "src/components/chat/group-scope-pages.tsx",
 "src/lib/copilot/own-chat.ts", "src/lib/copilot/own-chat-route.ts", "src/lib/copilot/family-chat.ts",
 "src/lib/copilot/own-provider-authority.ts", "src/app/api/settings/jurisdiction/route.ts",
 "e2e/fixtures/tiny-grch38.vcf",
]);
async function freshJurisdictionSnapshot(accountId: string, denied: boolean): Promise<FreshJurisdictionRows> {
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(accountId), "Actual actor required");
  const admin = adminClient(), facts: Record<string, Record<string, unknown>[]> = {};
  const save = async (name: string, query: PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown; count: number | null }> | null) => {
    const result = query ? await query : null;
    if (result) {
      expect(result.error, `complete jurisdiction ${name}`).toBeNull(); expect(result.count).not.toBeNull();
      expect(result.data!.length).toBe(result.count);
    }
    facts[name] = [...(result?.data ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  };
  for (const [name, query] of [
    ["profiles", admin.from("profiles").select("*", { count: "exact" }).eq("id", accountId)],
    ["subjects", admin.from("subjects").select("*", { count: "exact" }).or(`owner_account_id.eq.${accountId},subject_account_id.eq.${accountId}`)],
    ["subject_principals", admin.from("subject_principals").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["genome_files", admin.from("genome_files").select("*", { count: "exact" }).eq("user_id", accountId)],
    ["subject_consents", admin.from("subject_consents").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["consent_signatures", admin.from("consent_signatures").select("*", { count: "exact" }).eq("signer_account_id", accountId)],
    ["consent_grants", admin.from("consent_grants").select("*", { count: "exact" }).eq("user_id", accountId)],
    ["directional_grants_received", admin.from("directional_grants").select("*", { count: "exact" }).eq("recipient_account_id", accountId)],
    ["family_sharing_pauses", admin.from("family_sharing_pauses").select("*", { count: "exact" }).or(`account_low_id.eq.${accountId},account_high_id.eq.${accountId}`)],
    ["cohorts", admin.from("embryo_cohorts").select("*", { count: "exact" }).eq("owner_account_id", accountId)],
    ["drafts", admin.from("embryo_cohort_drafts").select("*", { count: "exact" }).eq("owner_account_id", accountId)],
    ["account_operation_nonces", admin.from("account_operation_nonces").select("*", { count: "exact" }).eq("account_id", accountId)],
    ["published_attestations", admin.from("consent_artifacts").select("*", { count: "exact" })
      .eq("artifact_key", "attestation.jurisdiction").is("superseded_at", null)],
  ] as const) await save(name, query);
  const subjects = facts.subjects.map(row => row.id as string), principals = facts.subject_principals.map(row => row.id as string);
  assert([...subjects, ...principals].every(id => typeof id === "string"
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)), "Exact native subject/principal identifiers required before scoped reads");
  await save("family_pairs", subjects.length ? admin.from("family_pairs").select("*", { count: "exact" })
    .or(`subject_a_id.in.(${subjects.join(",")}),subject_b_id.in.(${subjects.join(",")})`) : null);
  await save("purpose_grants", principals.length ? admin.from("purpose_grants").select("*", { count: "exact" })
    .or(`data_subject_principal_id.in.(${principals.join(",")}),signer_principal_id.in.(${principals.join(",")})`) : null);
  await save("invitations", principals.length ? admin.from("subject_invitations").select("*", { count: "exact" }).in("inviter_principal_id", principals) : null);
  await save("participant_sets", principals.length ? admin.from("embryo_participant_sets").select("*", { count: "exact" }).in("principal_id", principals) : null);
  assertFreshJurisdictionRows(facts, accountId, denied); return facts;
}

async function completeOwnRows(accountId:string,fileId:string,chatId:string): Promise<{
  rows: CompleteCopilotFacts; completions: [{purpose: "reports.polygenic"; complete: true; completed_at: string}];
}> {
  assert([accountId,fileId,chatId].every(id=>/^[a-f0-9-]{36}$/.test(id)), "Exact native identifiers required");
  const admin=adminClient(),facts:CompleteCopilotFacts={};
  const save=async(name:string,query:PromiseLike<{data:Record<string,unknown>[]|null;error:unknown;count:number|null}>|null)=>{
    const r=query?await query:null;if(r){expect(r.error,`complete native Copilot ${name}`).toBeNull();expect(r.count).not.toBeNull();expect(r.data!.length).toBe(r.count);}
    facts[name]=[...(r?.data??[])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  };
  for(const [name,table,column] of [["profiles","profiles","id"],["subjects","subjects","subject_account_id"],
    ["principals","subject_principals","account_id"],["files","genome_files","user_id"],["settings","llm_settings","user_id"],
    ["keys","llm_keys","user_id"],["consents","subject_consents","account_id"],["signatures","consent_signatures","signer_account_id"],
    ["chats","chats","user_id"],["tokens","copilot_context_tokens","account_id"],["nonces","account_operation_nonces","account_id"]] as const)
    await save(name,admin.from(table).select("*",{count:"exact"}).eq(column,accountId));
  const subjects=facts.subjects.map(r=>r.id as string),principals=facts.principals.map(r=>r.id as string);
  assert([...subjects,...principals].every(id=>/^[a-f0-9-]{36}$/.test(id)), "Exact actor subject and principal required");
  await save("grants",principals.length?admin.from("purpose_grants").select("*",{count:"exact"}).in("data_subject_principal_id",principals):null);
  const grantIds=facts.grants.map(r=>r.grant_id as string);assert(grantIds.every(id=>/^[a-f0-9-]{36}$/.test(id)), "Exact grant binding required");
  await save("directions",grantIds.length?admin.from("directional_grants").select("*",{count:"exact"}).in("grant_id",grantIds):null);
  await save("messages",admin.from("chat_messages").select("*",{count:"exact"}).eq("user_id",accountId));
  for(const name of ["user_prs","user_variants","report_observed_calls","ancestry_results"])
    await save(name,admin.from(name).select("*",{count:"exact"}).eq("file_id",fileId));
  expect(Object.keys(facts).sort()).toEqual([...COMPLETE_COPILOT_FACT_KEYS].sort());
  checkedCompleteCopilotFacts(facts,accountId,fileId,chatId);
  const completed=await ownRunCompletions(fileId);
  checkedCopilotOwnCompletions(completed);
  return { rows: facts, completions: completed };
}
async function unopenedRows(accountId:string){
 const rows:Record<string,Record<string,unknown>[]>= {},admin=adminClient();
 for(const [name,column] of [["llm_settings","user_id"],["llm_keys","user_id"],["chats","user_id"],
   ["chat_messages","user_id"],["copilot_context_tokens","account_id"]] as const){
  const r=await admin.from(name).select("*",{count:"exact"}).eq(column,accountId);
  expect(r.error).toBeNull();expect(r.count).not.toBeNull();expect(r.data!.length).toBe(r.count);rows[name]=r.data!;expect(rows[name]).toEqual([]);
 }return rows;
}
async function assertUnavailable(page:Page){
 const unavailable=page.locator('[data-slot="copilot-local-unavailable"]');await expect(unavailable).toHaveCount(1);
 await expect(unavailable).toHaveAttribute("data-state","not-covered");
 await expect(page.getByRole("heading",{level:1})).toHaveText(COPY_IDS["copilot.transport.local-unavailable.heading"]);
 for(const key of ["copilot.transport.local-unavailable.reason","copilot.transport.local-unavailable.requirement"] as const)
  await expect(unavailable.getByText(COPY_IDS[key],{exact:true})).toBeVisible();
 await expect(unavailable.getByRole("link",{name:COPY_IDS["actions.back"],exact:true})).toHaveAttribute("href","/overview");
 await expect(page.getByLabel("Message the copilot")).toHaveCount(0);await expect(page.getByTestId("data-flow-indicator")).toHaveCount(0);
 await expect(page.locator('[data-slot="copilot-family-members"], [data-role="assistant"], [data-figure-kind], [data-claim-block]')).toHaveCount(0);
 const html=await page.content();expect(html).not.toContain("family-context");expect(html).not.toMatch(/contextToken/);
}
async function assertJurisdiction(page:Page){
 await expect(page.getByRole("heading",{level:1})).toHaveText(`Ask about ${FAMILY_SCOPE_LABEL}`);
 const refusal=page.locator('[data-slot="copilot-family-jurisdiction"]');await expect(refusal).toHaveCount(1);
 await expect(refusal.getByRole("status")).toHaveText(DENSITY_TEST_DENY_SENTENCE);
 await expect(page.getByLabel("Message the copilot")).toHaveCount(0);await expect(page.getByTestId("data-flow-indicator")).toHaveCount(0);
 await expect(page.locator('[data-slot="copilot-family-members"], [data-slot="copilot-local-unavailable"], [data-role="assistant"], [data-figure-kind]')).toHaveCount(0);
}
/** Three additional exact registered states. Each runtime/viewport is genuinely
 * fresh. Root's existing actual app configuration reader must bind the literal
 * main or local-attested variant; this proposal does not create an attestation,
 * a paid provider, a captured flow or an aggregate-origin exception. */
export function realRemainingCopilotDensityFixtures(input:{
 root:string;browser:Browser;origin:string;localModelOrigin:string;register:DensityRegister;
 withFreshNativeRuntime:<T>(row:DensityStateCase,viewport:Viewport,work:(environment:Environment,operator?:OwnedLinuxCapability)=>Promise<T>)=>Promise<T>;
 readActualAppEnvironment:(origin:string)=>Promise<unknown>;
 observeState:(row:DensityStateCase,page:Page,sourceSha256:string,facts:{accountId:string;nativeSnapshot:unknown})=>Promise<unknown>;
}):DensityStateFixture[]{
 assert(input.origin==="http://localhost:3100" && input.localModelOrigin==="http://localhost:3103", "Original distinct main/local-attested origins required");
 const sourcePath="e2e/helpers/density-remaining-copilot-state-fixtures.ts";
 if(SOURCES.some(name=>!fs.existsSync(path.join(input.root,name))))return [];
 const sources=[sourcePath,...SOURCES].map(name=>({name,sha256:createHash("sha256").update(fs.readFileSync(path.join(input.root,name))).digest("hex")}));
 const sourceSha256=sources[0].sha256;
 const assertSource=()=>{for(const s of sources)assert(createHash("sha256").update(fs.readFileSync(path.join(input.root,s.name))).digest("hex")===s.sha256,"Complete reviewed source changed");};
 return densityCapturePlan(input.register,[]).states.flatMap(row=>{
  const recipe=remainingDensityRecipe(row);if(!recipe || recipe==="overview-jurisdiction")return [];
  return [{routeId:row.route.id,state:row.state,sourcePath,sourceSha256,withState:async({viewport},capture)=>{
   assertSource();await input.withFreshNativeRuntime(row,viewport,async(environment,operator)=>{
    assert(fs.realpathSync(process.cwd())===fs.realpathSync(input.root),"Exact composed public source required");
    for(const name of ["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY","INHERIT_UPLOAD_SIGNING_JWK",
      "RUNNER_TEMP","INHERIT_CI_RUNTIME_UID","INHERIT_CI_RUNTIME_GID","INHERIT_CI_BROWSER_RUNTIME","INHERIT_LOCAL_E2E_PROJECT",
      "INHERIT_LOCAL_E2E_WORKDIR","DOCKER_HOST","DOCKER_CONTEXT","JOBS_SECRET","CANONICAL_COPILOT_CONTROL_URL"])
      assert(environment[name]===process.env[name],"Actual caller and owned native runtime must match");
    if(operator){const{ownedLinuxEnvironment}=await import("../../scripts/owned-linux-runtime");for(const[name,value]of Object.entries(ownedLinuxEnvironment(operator)))assert(process.env[name]===value,"Actual owned runtime required");}
    const{localE2eProject}=await import("../../scripts/local-e2e-project");assert(localE2eProject(environment).projectId==="sequence","Fresh native project required");
    const appOrigin=recipe==="copilot-jurisdiction"?input.localModelOrigin:input.origin;
    const app=checkedAppEnvironment(await input.readActualAppEnvironment(appOrigin),recipe==="copilot-jurisdiction"?3103:3100);
    for(const name of ["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY","INHERIT_UPLOAD_SIGNING_JWK","JOBS_SECRET"])
      assert(app[name]===environment[name],"Actual selected app must share exact native/signing/job identity");
    const context=await input.browser.newContext({baseURL:appOrigin,viewport,deviceScaleFactor:1,colorScheme:"light",reducedMotion:"reduce",locale:"en-US",timezoneId:"UTC",serviceWorkers:"block"});
    const page=await context.newPage(),USER={email:`density-remaining-copilot-${randomUUID()}@e2e.local`,password:"e2e-copilot-pw"};
    let fixture:CopilotFixture|undefined,fileId="",chatId="",originalHistory:unknown;
    const MOCK_PORT=8123;
    try{
      const accountId=await createConfirmedUser(USER.email,USER.password);await signIn(page,USER.email,USER.password);
      if(recipe==="copilot-complete"){
        fixture=await startCopilotFixture(MOCK_PORT);
        expect(await fixture.snapshot()).toEqual({calls:0,denied:0,requests:[]});
  fileId = await uploadOwnFileWithChosenReports(page,
    path.join(input.root, "e2e/fixtures/tiny-grch38.vcf"),
    { fileType: "vcf", purposes: ["reports.polygenic"] });
  await saveCopilotProvider(page, fixture.baseUrl);

  // Saving an endpoint grants nothing. The canonical route has no composer
  // before the separate Settings action, instead of the legacy popup-on-send.
  await page.goto("/copilot/me");
  await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
  await expect(page.getByText("Choose what Copilot may use before asking about your file. Saving a provider does not grant that permission.", { exact: true })).toBeVisible();
  expect((await fixture.snapshot()).calls).toBe(0);
  await page.getByRole("link", { name: "Review Copilot settings", exact: true }).click();
  const permission = page.getByRole("region", { name: "Copilot permission", exact: true });
  await expect(permission).toContainText(`${COPILOT_MODEL_HOST}:${MOCK_PORT}`);
  await expect(permission).toContainText("Individual genotypes you ask about");
  await expect(permission).toContainText("Score-panel coverage and why a validated score is unavailable");
  await expect(permission).not.toContainText("score, percentile");
  await expect(permission).toContainText("Your chat messages");
  await expect(permission).toContainText("Your original DNA file is not sent");
  await allowCopilot(page);

  await fixture.configure({ prompt: CAFFEINE_PROMPT,
    tool: { name: "get_report", arguments: { slug: CAFFEINE_SLUG } }, answer: CAFFEINE_ANSWER });
  await page.goto("/copilot/me");
  await expect(page.getByTestId("data-flow-indicator")).toContainText("Cloud mode");
  const answered = page.waitForResponse(response => new URL(response.url()).pathname === "/api/chat");
  await page.getByLabel("Message the copilot").fill(CAFFEINE_PROMPT);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const response = await answered;
  expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
  await expect(page.getByText(CAFFEINE_ANSWER, { exact: true })).toBeVisible();
  const receipt = await fixture.snapshot();
  expect(receipt.calls).toBe(2);
  const report = lastToolResult(receipt);
  await expectClosedCompletion(response, CAFFEINE_ANSWER, expectedCaffeineCitations(report));
  expect(report).toMatchObject({ slug: CAFFEINE_SLUG,
    sources: [expect.objectContaining({ file_id: fileId, purpose: "reports.polygenic", covered: true,
      variants: expect.arrayContaining([expect.objectContaining({ rsid: "rs762551", outcome: expect.objectContaining({ genotype: "AC" }) })]) })] });
  const source = (report.sources as Array<Record<string, unknown>>)[0];
  const snapshot = source.catalogSnapshot as { schemaVersion: number; templateSha256: string;
    template: { title: string; citations: unknown[] } };
  expect(snapshot.schemaVersion).toBe(1);
  expect(snapshot.templateSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(source.title).toBe("Caffeine metabolism · CYP1A2");
  expect(source.title).toBe(snapshot.template.title);
  expect(source.citations).toEqual(snapshot.template.citations);
  expect(source.citations).toEqual(expect.arrayContaining([expect.objectContaining({ pmid: "10233211" })]));
  expect(report.unavailable_sources).toEqual([]);
  await expect(page.getByText("get_report", { exact: true })).toHaveCount(0);
  // Reopen server-owned history through the actual user control.
  await page.reload();
  await page.getByText("Past conversations", { exact:true }).click();
  const historyRead=page.waitForResponse(result => /^\/api\/chats\/[0-9a-f-]{36}$/.test(new URL(result.url()).pathname));
  await page.getByRole("button", { name:/^Conversation from / }).click();
  const historyResponse=await historyRead;
  expect(historyResponse.status()).toBe(200);
  const savedHistory=await historyResponse.json();
  originalHistory = savedHistory; chatId = savedHistory.chatId;
  assert(typeof chatId === "string" && /^[a-f0-9-]{36}$/.test(chatId), "Actual native history identity required");
  expect(savedHistory.messages).toHaveLength(2);
  expect(savedHistory.messages[1]).toMatchObject({ content:CAFFEINE_ANSWER,citations:expectedCaffeineCitations(report) });
  expect(savedHistory.messages[1].createdAt).toMatch(/Z$/);
  await expect(page.getByText(CAFFEINE_ANSWER, { exact:true })).toBeVisible();
  expect((await fixture.snapshot()).calls).toBe(2);

      }else if(recipe==="copilot-uncovered"){
  await page.goto("/overview");
  // Overview gives each box's label the DOM id `box-{id with dots as dashes}-label`.
  const box = page.locator('[data-overview-box] a[aria-labelledby="box-family-copilot-label"]');
  await expect(box).toHaveAttribute("href", "/copilot/family");
  // The embryo cohort scope is not built: its box keeps landing on the hub.
  await expect(page.locator('[data-overview-box] a[aria-labelledby="box-embryos-copilot-label"]'))
    .toHaveAttribute("href", "/embryos");

  const context = page.waitForResponse(response => new URL(response.url()).pathname === "/copilot/family");
  await box.click();
  expect((await context).status()).toBe(200);
  const unavailable = page.locator('[data-slot="copilot-local-unavailable"]');
  await expect(unavailable).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPY_IDS["copilot.transport.local-unavailable.heading"]);
  await expect(unavailable.getByText(COPY_IDS["copilot.transport.local-unavailable.reason"], { exact: true })).toBeVisible();
  await expect(unavailable.getByText(COPY_IDS["copilot.transport.local-unavailable.requirement"], { exact: true })).toBeVisible();
  await expect(unavailable.getByRole("link", { name: COPY_IDS["actions.back"], exact: true })).toHaveAttribute("href", "/overview");

  // The closed projection: no composer, no conversation, no group, no model.
  await expect(page.getByLabel("Message the copilot")).toHaveCount(0);
  await expect(page.getByTestId("data-flow-indicator")).toHaveCount(0);
  await expect(page.getByText(`Ask about ${FAMILY_SCOPE_LABEL}`)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain("family-context");
  expect(html).not.toMatch(/contextToken/);

  await page.getByRole("link", { name: COPY_IDS["actions.back"], exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
        // The full original back-action audit ended at Overview. Open the same
        // actual box again to capture its genuine unavailable destination.
        const response=await page.goto("/copilot/family");expect(response?.status()).toBe(200);
      }else{
        const old=await freshJurisdictionSnapshot(accountId,false),artifact=old.published_attestations[0];
        const response=await page.request.put("/api/settings/jurisdiction",{headers:{origin:appOrigin,"content-type":"application/json"},
          data:{code:"XX",attestationVersion:artifact.version,attestationHash:artifact.body_sha256,affirmed:true}});
        expect(response.status()).toBe(200);
        expect(JSON.parse((await response.body()).toString("utf8"))).toEqual({status:"updated",jurisdiction:"XX",capabilityReevaluation:"complete"});
        const declared=await freshJurisdictionSnapshot(accountId,true);
        for(const name of Object.keys(old).filter(name=>name!=="profiles") as(keyof FreshJurisdictionRows)[])expect(declared[name]).toEqual(old[name]);
        expect((await page.goto("/copilot/family"))?.status()).toBe(200);await assertJurisdiction(page);
      }
      const currentHistory=async()=>{assert(chatId && originalHistory);const response=await page.request.get(`/api/chats/${chatId}`);
        expect(response.status()).toBe(200);const actual=JSON.parse((await response.body()).toString("utf8"));expect(actual).toEqual(originalHistory);return actual;};
      const facts=async()=>recipe==="copilot-complete"?{
        rows:await completeOwnRows(accountId,fileId,chatId),history:await currentHistory(),provider:await fixture!.snapshot()
      }:{rows:await freshJurisdictionSnapshot(accountId,recipe==="copilot-jurisdiction"),unopened:await unopenedRows(accountId)};
      const original=await facts(),apiWrites:string[]=[];page.on("request",request=>{const url=new URL(request.url());
        if(url.origin===appOrigin && url.pathname.startsWith("/api/") && request.method()!=="GET")apiWrites.push(`${request.method()} ${url.pathname}`);});
      const assertState=async()=>{
        expect(new URL(page.url()).origin).toBe(appOrigin);expect(new URL(page.url()).pathname).toBe(recipe==="copilot-complete"?"/copilot/me":"/copilot/family");
        if(recipe==="copilot-uncovered")await assertUnavailable(page);else if(recipe==="copilot-jurisdiction")await assertJurisdiction(page);else{
          await expect(page.getByText(CAFFEINE_ANSWER,{exact:true})).toBeVisible();await expect(page.getByLabel("Message the copilot")).toBeVisible();
          await expect(page.getByText("get_report",{exact:true})).toHaveCount(0);await expect(page.getByText("Thinking…",{exact:true})).toHaveCount(0);
          expect((await fixture!.snapshot()).calls).toBe(2);expect((await fixture!.snapshot()).denied).toBe(0);
        }
      };
      const observe=async()=>{assertSource();await assertState();const nativeSnapshot=await facts();expect(nativeSnapshot).toEqual(original);expect(apiWrites).toEqual([]);
        return input.observeState(row,page,sourceSha256,{accountId,nativeSnapshot});};
      await observe();await capture({page,observe});await observe();
    }finally{try{if(fixture)await fixture.stop();}finally{await context.close();}}
   });assertSource();
  }} satisfies DensityStateFixture];
 });
}
