import {createHash,randomBytes,randomUUID} from "node:crypto";
import type {Browser,Page} from "@playwright/test";
import {expect} from "../audited-test";
import {adminClient,assertNoThirdParty,expectAxeClean,watchRequests} from "../helpers";
import {reviewFixtureSql,signInReviewer} from "./claim-review-fixture";

// This existing paused TEST app already opts into requester statements. No
// ordinary server or production setting changes to reach this fixture.
const ORIGIN="http://localhost:3102";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEX=/^[0-9a-f]{64}$/u;
const targetHashSql=`select md5(jsonb_build_object(
 'subjects',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.subjects s),
 'cohorts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.embryo_cohorts c))::text)`;

/** Real public form/crypto/commit, native one-use issuance and activation,
 * then the assigned reviewer's genuine Auth/MFA page. This proves the actual
 * zero-document page, not mail-provider delivery or evidence scan/storage. */
export async function auditAssignedAppeal(page:Page,browser:Browser,reviewer:string){
 if(!UUID.test(reviewer))throw new Error("Synthetic reviewer identity unavailable");
 const principal=randomUUID(),contact=`appeal-audit-${randomBytes(8).toString("hex")}@e2e.local`;
 expect(await reviewFixtureSql("select enabled::text from private.new_public_appeal_config where singleton"),
  "native TEST configuration starts closed").toBe("false");
 let caseId:string|undefined;
 try{
  await reviewFixtureSql(`update private.new_public_appeal_config set enabled=true where singleton;
   insert into public.subject_principals(id,account_id,principal_kind) values('${principal}'::uuid,'${reviewer}'::uuid,'reviewer');
   insert into private.new_public_appeal_reviewers(principal_id,principal_revision,purpose_revision) values('${principal}'::uuid,1,1);`);
  expect((await page.goto(`${ORIGIN}/legal/appeals`))?.status()).toBe(200);
  const form=page.locator("main form");
  await form.getByLabel("Request type",{exact:true}).selectOption("subject-objection");
  await form.getByLabel("Your name",{exact:true}).fill("Synthetic appeal requester");
  await form.getByLabel("Your email address",{exact:true}).fill(contact);
  await form.getByLabel("Why do you want to make this request? Use 20 to 8,000 characters.",{exact:true})
   .fill("This synthetic request has no uploaded evidence and must not grant access.");
  await form.getByRole("checkbox",{name:"These details match what I know.",exact:true}).check();
  const submitted=page.waitForResponse(response=>response.url()===`${ORIGIN}/api/appeals`&&response.request().method()==="POST");
  void submitted.catch(()=>{});
  await form.getByRole("button",{name:"Send request",exact:true}).click();
  expect((await submitted).status()).toBe(202);
  await expect(page.locator("main").getByRole("status")).toHaveText("Request sent.");
  caseId=await reviewFixtureSql(`select id from private.new_public_appeal_intakes where reviewer_principal_id='${principal}'::uuid
   and state='committed' and kind='subject-objection'`);
  if(!UUID.test(caseId))throw new Error("Actual synthetic appeal commit unavailable");
  const outbox=await reviewFixtureSql(`select outbox_id from private.new_public_appeal_intakes where id='${caseId}'::uuid`);
  if(!UUID.test(outbox))throw new Error("Actual synthetic appeal outbox unavailable");
  // Real service JWT, not edited auth claims. No bearer enters SQL argv,
  // assertion diagnostics or persisted browser traces. Each door runs once.
  const native=adminClient(),abort=new AbortController();
  const deadline=setTimeout(()=>abort.abort(),30_000);
  try{
  const issued=await native.rpc("claim_mail_outbox").retry(false).abortSignal(abort.signal);
  if(issued.error||!Array.isArray(issued.data)||issued.data.length!==1)throw new Error("Actual synthetic appeal issuance unavailable");
  const claim=issued.data[0] as {outbox_id?:unknown;attempt_ordinal?:unknown;delivery_token?:unknown};
  if(typeof claim.outbox_id!=="string"||!UUID.test(claim.outbox_id)||!Number.isSafeInteger(claim.attempt_ordinal)
   ||claim.outbox_id!==outbox||Number(claim.attempt_ordinal)<1||typeof claim.delivery_token!=="string"||!/^[A-Za-z0-9_-]{43}$/u.test(claim.delivery_token)){
   throw new Error("Actual synthetic appeal issuance unavailable");
  }
  const tokenHash=createHash("sha256").update(claim.delivery_token).digest("hex");
  claim.delivery_token=undefined;
  const sessionHash=randomBytes(32).toString("hex"),csrf=randomBytes(24).toString("base64url");
  if(!HEX.test(tokenHash)||!HEX.test(sessionHash))throw new Error("Malformed synthetic activation digest");
  const authorized=await native.rpc("authorize_mail_submission_v1",{p_outbox_id:claim.outbox_id,p_attempt_ordinal:Number(claim.attempt_ordinal)})
   .retry(false).abortSignal(abort.signal);
  if(authorized.error||authorized.data!==true)throw new Error("Actual synthetic appeal submission refused");
  const activated=await native.rpc("activate_rights_session_v1",{p_token_hash:tokenHash,p_session_hash:sessionHash,p_form_nonce:csrf})
   .retry(false).abortSignal(abort.signal);
  if(activated.error||!Array.isArray(activated.data)||activated.data.length!==1||activated.data[0]?.purpose!=="appeal-evidence"
   ||activated.data[0]?.target_kind!=="appeal-case"||activated.data[0]?.target_id!==caseId)throw new Error("Actual synthetic appeal activation refused");
  }finally{clearTimeout(deadline);abort.abort();}
  const observed=watchRequests(page);
  const entered=await page.goto(`${ORIGIN}/reviews/appeals/${caseId}`);
  expect(entered?.status()).toBe(200);
  expect(entered?.headers()["cache-control"]).toBe("private, no-store");
  expect(entered?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading",{name:"Review request",exact:true})).toBeVisible();
  await expect(page.getByText("Claimant: Synthetic appeal requester.",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Open file",exact:true})).toHaveCount(0);
  await expectAxeClean(page,async()=>{
   await expect(page.getByText("Claimant: Synthetic appeal requester.",{exact:true})).toBeVisible();
   await expect(page.getByRole("button",{name:"Refuse request",exact:true})).toBeDisabled();
  });
  await assertNoThirdParty(page,observed,"the genuinely assigned incomplete appeal in both themes",ORIGIN);
  const foreign=await browser.newContext();
  try{
   const other=await signInReviewer(foreign,ORIGIN);
   await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${other}'::uuid)`);
   const denied=await foreign.newPage();
   expect((await denied.goto(`${ORIGIN}/reviews/appeals/${caseId}`))?.status()).toBe(404);
   await expect(denied.getByText("Synthetic appeal requester",{exact:false})).toHaveCount(0);
  }finally{await foreign.close();}
  const before=await reviewFixtureSql(targetHashSql);
  const refusal=page.getByRole("heading",{name:"Refuse this request",exact:true}).locator("..");
  await refusal.getByLabel("Reason",{exact:true}).fill("The synthetic request has no evidence and is refused without changing any record.");
  await refusal.getByRole("checkbox").check();
  const decided=page.waitForResponse(response=>response.url()===`${ORIGIN}/api/reviews/appeals/${caseId}`&&response.request().method()==="POST");
  void decided.catch(()=>{});
  await refusal.getByRole("button",{name:"Refuse request",exact:true}).click();
  expect((await decided).status()).toBe(200);
  await expect(page.getByRole("status")).toHaveText("This request was closed.");
  expect(await reviewFixtureSql(`select (intake.state='closed' and intake.wrapped_case_key is null and intake.working_ciphertext is null
   and intake.case_contact_id is null and appeal.appellant_account_id is null and appeal.state='rejected'
   and not exists(select 1 from private.public_appeal_provisional_targets hold where hold.case_id=intake.id)
   and not exists(select 1 from public.rights_sessions rights where rights.target_kind='appeal-case' and rights.target_id=intake.id))::text
   from private.new_public_appeal_intakes intake join public.appeal_intakes appeal on appeal.id=intake.id where intake.id='${caseId}'::uuid`))
   .toBe("true");
  expect(await reviewFixtureSql(targetHashSql),"final rejection leaves every subject and cohort row unchanged").toBe(before);
 }finally{
  try{
   await reviewFixtureSql(`update public.appeal_intakes set state='withdrawn',decided_at=clock_timestamp()
    where id in(select id from private.new_public_appeal_intakes where reviewer_principal_id='${principal}'::uuid)
     and state in('submitted','reviewing')`);
  }finally{
   await reviewFixtureSql(`update private.new_public_appeal_reviewers set active=false where principal_id='${principal}'::uuid;
    update private.new_public_appeal_config set enabled=false where singleton;`);
   expect(await reviewFixtureSql("select enabled::text from private.new_public_appeal_config where singleton")).toBe("false");
  }
 }
}
