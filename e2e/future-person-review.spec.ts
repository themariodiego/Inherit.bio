import {createServerClient} from "@supabase/ssr";
import type {BrowserContext} from "@playwright/test";
import {ANON_KEY,SUPABASE_URL,assertNoThirdParty,expectAxeClean,watchRequests} from "./helpers";
import {expect,test} from "./audited-test";
import {observeNativeResponses} from "./helpers/native-response-observer";
import {createReviewCase,reviewFixtureSql,signInReviewer} from "./helpers/claim-review-fixture";
import {auditAssignedAppeal} from "./helpers/public-appeal-review-audit";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Read the actual browser cookie through Auth's SDK; never manufacture claims. */
async function reviewerSession(context:BrowserContext,reviewer:string):Promise<string> {
  const cookies=await context.cookies();
  const auth=createServerClient(SUPABASE_URL,ANON_KEY,{cookies:{getAll:()=>cookies,
    setAll:()=>{throw new Error("Fresh reviewer proof must not rotate browser cookies");}}});
  const verified=await auth.auth.getClaims();
  if(verified.error||!verified.data)throw new Error("Actual reviewer session verification failed");
  const claims=verified.data.claims;
  expect(claims.sub,"the browser carries the genuine reviewer's Auth session").toBe(reviewer);
  expect(claims.aal,"the browser retains genuine MFA authority").toBe("aal2");
  if(typeof claims.session_id!=="string"||!UUID.test(claims.session_id))throw new Error("Actual reviewer session identity unavailable");
  return claims.session_id;
}

/** Ordinary case reads are audited; none may masquerade as any document delivery. */
async function expectCaseAuditWithoutDocumentReceipt(claim:string,reviewer:string,session:string):Promise<void> {
  if(![claim,reviewer,session].every(value=>UUID.test(value)))throw new Error("Malformed synthetic audit identity");
  expect(await reviewFixtureSql(`select count(*) from private.claim_review_reads where review_id='${claim}'::uuid
    and (document_id is not null or chunk_sequence is not null or delivery_verified_at is not null)`)).toBe("0");
  expect(await reviewFixtureSql(`select (count(*)>0)::text||'/'||coalesce(bool_and(
    r.reviewer_account_id='${reviewer}'::uuid and r.auth_session_id='${session}'::uuid
    and r.review_revision=c.review_revision and c.review_revision=1
    and r.document_id is null and r.chunk_sequence is null and r.delivery_verified_at is null
    and r.assignment_revision is null and r.document_sha256 is null
    and r.account_auth_session_revision is null and r.originating_session_revision is null
    and exists(select 1 from auth.sessions a where a.id=r.auth_session_id and a.user_id=r.reviewer_account_id
      and (a.not_after is null or a.not_after>clock_timestamp()))),false)::text
    from private.claim_review_reads r join private.claim_reviews c on c.id=r.review_id
    where r.review_id='${claim}'::uuid`),"real case reads exist only under this reviewer/session/current revision and have no document receipt fields").toBe("true/true");
}

// Titles bind the real assertions to the new route's required states. Static
// discovery is distinct from execution; full CI must still run these journeys.
// Their fixture is actual Auth + upload/Storage/scan/claim completion; only
// naming a reviewer and assigning the exact case are owner-only operations.

test("/reviews/future-person/claims/[id] complete: full bytes, separate human reads and a real refusal",async({page,context,browser,baseURL})=>{
  if(!baseURL)throw new Error("Local app origin unavailable");
  const claim=await createReviewCase(page,context);
  const reviewer=await signInReviewer(context,baseURL);
  const authSession=await reviewerSession(context,reviewer);
  await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewer}'::uuid);
    select private.assign_claim_review_v1('${claim}'::uuid,'${reviewer}'::uuid);`);
  const response=await page.goto(`/reviews/future-person/claims/${claim}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading",{name:"Review claim",exact:true})).toBeVisible();
  await expect(page.getByText("Claimant: Synthetic Claimant. Birth date: 2000-01-31.",{exact:true})).toBeVisible();
  const observed=watchRequests(page);
  await expectAxeClean(page);
  await assertNoThirdParty(page,observed,"the genuine assigned reviewer page, both themes");
  await expectCaseAuditWithoutDocumentReceipt(claim,reviewer,authSession);
  const save=page.getByRole("button",{name:"Save choice",exact:true});
  await page.getByLabel("Reason",{exact:true}).fill("The synthetic blank papers do not prove a link to any record.");
  await expect(save).toBeDisabled();
  await expect(page.getByLabel("Choice",{exact:true}).locator("option")).toHaveText(["Refuse claim","Ask for more information"]);
  const photo=page.getByRole("heading",{name:"Picture ID",exact:true}).locator("..");
  const birth=page.getByRole("heading",{name:"Birth record",exact:true}).locator("..");
  const acknowledgements:string[]=[];
  page.on("request",request=>{if(request.method()==="POST"&&/\/chunks\/[0-4]\/acknowledge$/u.test(new URL(request.url()).pathname))acknowledgements.push(request.url());});
  const observer=await observeNativeResponses(page,{
    first:"^/api/downloads/[^/]+/chunks/0/acknowledge$",second:"^/api/downloads/[^/]+/chunks/1/acknowledge$",
  });
  try {
    await photo.getByRole("button",{name:"Open Picture ID",exact:true}).click();
    await expect(photo.getByRole("img",{name:"Photo identity document",exact:true})).toBeVisible();
    await expect.poll(()=>photo.getByRole("img").evaluate(image=>({width:(image as HTMLImageElement).naturalWidth,height:(image as HTMLImageElement).naturalHeight})))
      .toEqual({width:3,height:2});
    expect(await observer.read("first")).toEqual({status:204,text:""});
    expect(await observer.read("second")).toEqual({status:204,text:""});
    expect(acknowledgements.length).toBe(2);
  } finally {await observer.dispose();}
  await expect(photo.getByRole("checkbox")).not.toBeChecked();
  await photo.getByRole("checkbox").check();
  await expect(save).toBeDisabled();
  await birth.getByRole("button",{name:"Open Birth record",exact:true}).click();
  await expect(birth.getByRole("img",{name:"Birth record, page 1",exact:true})).toBeVisible();
  await expect(birth.getByRole("status")).toHaveText("Page 1 of 2");
  await expect(birth.getByRole("checkbox")).toHaveCount(0);
  await expect(save).toBeDisabled();
  await birth.getByRole("button",{name:"Go on",exact:true}).click();
  await expect(birth.getByRole("status")).toHaveText("Page 2 of 2");
  await expect(birth.getByRole("img",{name:"Birth record, page 2",exact:true})).toBeVisible();
  await expect.poll(()=>birth.getByRole("img").evaluate(element=>{
    const canvas=element as HTMLCanvasElement;return Array.from(canvas.getContext("2d")!.getImageData(200,600,1,1).data);
  })).toEqual([0,0,255,255]);
  expect(acknowledgements.length).toBe(3);
  expect(await reviewFixtureSql(`select count(*)||'/'||bool_and(r.document_sha256=d.sha256 and r.delivery_verified_at is not null
    and r.assignment_revision=a.assignment_revision) from private.claim_review_reads r
    join private.claim_documents d on d.id=r.document_id
    join private.claim_review_assignments a on a.review_id=r.review_id and a.status='current'
    where r.review_id='${claim}'::uuid and r.reviewer_account_id='${reviewer}'::uuid`)).toBe("3/true");
  await expect(birth.getByRole("checkbox")).not.toBeChecked();
  await expect(save).toBeDisabled();
  await birth.getByRole("checkbox").check();
  await expect(save).toBeEnabled();

  // A different actual stepped-up named reviewer still cannot read this case.
  const other=await browser.newContext();
  try {
    const otherReviewer=await signInReviewer(other,baseURL);
    await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${otherReviewer}'::uuid);`);
    const otherPage=await other.newPage();
    expect((await otherPage.goto(`${baseURL}/reviews/future-person/claims/${claim}`))?.status()).toBe(404);
    await expect(otherPage.getByText("Synthetic Claimant",{exact:false})).toHaveCount(0);
  } finally {await other.close();}

  const decision=await observeNativeResponses(page,{save:`^/api/reviews/future-person/claims/${claim}$`});
  try {
    await save.click();await expect(page.getByRole("status")).toHaveText("Decision saved.");
    expect(await decision.read("save")).toEqual({status:200,text:JSON.stringify({claimId:claim,state:"refused",reviewRevision:2})});
  } finally {await decision.dispose();}
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(page.getByText("Synthetic Claimant",{exact:false})).toHaveCount(0);
  expect(await reviewFixtureSql(`select r.state||'/'||(i.identity_key_shredded_at is not null)||'/'||
    (select bool_and(s.wrapped_document_key is null and s.document_key_shredded_at is not null)
     from private.claim_document_sessions s where s.intake_id=r.id)
    from private.claim_reviews r join private.future_person_claim_intakes i on i.id=r.id where r.id='${claim}'::uuid`)).toBe("refused/true/true");
  await auditAssignedAppeal(page,browser,reviewer);
});

test("/reviews/future-person/claims/[id] processing: a canceled second chunk cannot become a read",async({page,context,baseURL})=>{
  if(!baseURL)throw new Error("Local app origin unavailable");
  const claim=await createReviewCase(page,context);const reviewer=await signInReviewer(context,baseURL);
  const authSession=await reviewerSession(context,reviewer);
  await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewer}'::uuid);
    select private.assign_claim_review_v1('${claim}'::uuid,'${reviewer}'::uuid);`);
  expect((await page.goto(`/reviews/future-person/claims/${claim}`))?.status()).toBe(200);
  await expect(page.getByRole("button",{name:"Open Picture ID",exact:true})).toBeEnabled();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let held=0,acks=0;
  page.on("request",request=>{if(request.method()==="POST"&&/\/acknowledge$/u.test(new URL(request.url()).pathname))acks++;});
  await page.route("**/api/downloads/*/chunks/1",async route=>{held++;await gate;await route.abort("aborted");});
  const firstChunk=page.waitForResponse(response=>/^\/api\/downloads\/[^/]+\/chunks\/0$/u.test(new URL(response.url()).pathname));
  try {
    await page.getByRole("button",{name:"Open Picture ID",exact:true}).click();
    const chunk=await firstChunk;expect(chunk.status()).toBe(200);
    expect(chunk.headers()["content-type"]).toBe("application/octet-stream");
    expect(chunk.headers()["content-encoding"]).toBe("identity");
    expect(chunk.headers()["content-length"]).toBe("4000000");
    await expect(page.getByRole("button",{name:"Open Picture ID",exact:true})).toHaveText("Reading file…");
    await expect(page.getByRole("button",{name:"Open Picture ID",exact:true})).toBeDisabled();
    await expect(page.getByRole("button",{name:"Open Birth record",exact:true})).toBeDisabled();
    await expect(page.getByRole("button",{name:"Save choice",exact:true})).toBeDisabled();
    await expect.poll(()=>held,{message:"the actual first bytes precede the held second chunk"}).toBe(1);
    expect(acks).toBe(0);
    await expectCaseAuditWithoutDocumentReceipt(claim,reviewer,authSession);
    release();
    await expect(page.getByRole("status")).toHaveText("The full document could not be read. Reload this page before trying again.");
    await expect(page.getByRole("button",{name:"Save choice",exact:true})).toBeDisabled();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    expect(await reviewFixtureSql(`select private.claim_document_fully_read_v1('${claim}'::uuid,'${reviewer}'::uuid,d)
      from private.claim_documents d join private.claim_reviews r on r.photo_document_id=d.id where r.id='${claim}'::uuid`)).toBe("f");
    expect(acks).toBe(0);
    await expectCaseAuditWithoutDocumentReceipt(claim,reviewer,authSession);
    expect(await reviewFixtureSql(`select state||'/'||review_revision||'/'||
      (select count(*) from private.claim_review_decisions where review_id=r.id)
      from private.claim_reviews r where r.id='${claim}'::uuid`)).toBe("document_review_pending/1/0");
    expect((await page.goto(`/reviews/future-person/claims/${claim}`))?.status()).toBe(200);
    await expect(page.getByRole("button",{name:"Save choice",exact:true})).toBeDisabled();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  } finally {release();await page.unroute("**/api/downloads/*/chunks/1");}
});
