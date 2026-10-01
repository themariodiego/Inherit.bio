import {expect,test} from "./audited-test";
import {assertNoThirdParty,expectAxeClean,watchRequests} from "./helpers";
import {createReviewCase,reviewFixtureSql,signInReviewer} from "./helpers/claim-review-fixture";
import {observeNativeResponses} from "./helpers/native-response-observer";
import {currentDocumentaryCase,expectNoUniqueKeylessResponse,keylessEffectProof,nativeReviewRequest,openSyntheticReviewPdf,reviewId} from "./helpers/keyless-review-journey";
import {keylessReviewDocument} from "./fixtures/keyless-review-documents";
import {randomBytes} from "node:crypto";

// Real Auth/TOTP, native encrypted uploads/compose/scan, current named owner
// assignment and actual EOF/client ACKs. No parent/source/history/notice row is
// changed to invent a positive match or an elapsed provider deadline. These
// software fixtures confer no human, real provider or positive release credit.
test("Keyless documentary review: actual full papers, read-only no-match and separate refusal",async({page,context,browser,baseURL})=>{
  if(!baseURL)throw new Error("Local app origin unavailable");
  const suffix=randomBytes(4).toString("hex"),identity={fullName:`Synthetic Claimant ${suffix}`,placeOfBirth:`Synthetic Town ${suffix}`,
    parentNames:[`Synthetic Parent One ${suffix}`,`Synthetic Parent Two ${suffix}`]};
  const claim=await createReviewCase(page,context,{photo:{bytes:keylessReviewDocument("photo",identity),extension:"pdf",mimeType:"application/pdf"},
    birth:{bytes:keylessReviewDocument("birth",identity),extension:"pdf",mimeType:"application/pdf"},claimant:identity});
  const reviewer=await signInReviewer(context,baseURL);
  await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewId(reviewer)}'::uuid);
    select private.assign_claim_review_v1('${reviewId(claim)}'::uuid,'${reviewId(reviewer)}'::uuid);`);
  expect((await page.goto(`/reviews/future-person/claims/${claim}`))?.status()).toBe(200);
  await expect(page.getByRole("button",{name:"Open Picture ID",exact:true})).toBeEnabled();
  const current=await currentDocumentaryCase(page,claim),unchanged=await keylessEffectProof(claim);
  expect(unchanged).toMatch(/^[a-f0-9]{64}$/u);
  const lookup={reviewRevision:1,nonce:current.lookup,documentaryAttestation:{fullName:identity.fullName,dateOfBirth:"2000-01-31",
    photoIdentityReviewed:true,birthRecordReviewed:true,adultAgeConfirmed:true}};
  const lookupPath=`/api/reviews/future-person/claims/${claim}/verify-documents`;
  const expectOpaque=async(path:string,body:unknown)=>{
    const response=await nativeReviewRequest(page,path,body,current.csrf);
    expect(response.status).toBe(404);expect(response.body).toEqual({error:"not_found"});
    expect(response.cache).toBe("private, no-store");expect(response.referrer).toBe("no-referrer");
    expect(await keylessEffectProof(claim)).toBe(unchanged);
  };
  await expect(page.getByRole("button",{name:"Check details",exact:true})).toHaveCount(0);
  await expectOpaque(lookupPath,lookup);
  await openSyntheticReviewPdf(page,"photo");
  await expect(page.getByRole("button",{name:"Check details",exact:true})).toHaveCount(0);
  await expectOpaque(lookupPath,lookup);
  expect(await reviewFixtureSql(`select count(*) from private.claim_review_reads where review_id='${claim}'::uuid and document_id is not null and delivery_verified_at is not null`)).toBe("1");
  await openSyntheticReviewPdf(page,"birth");
  expect(await reviewFixtureSql(`select count(*)||'/'||bool_and(r.delivery_verified_at is not null and r.document_sha256=d.sha256
    and r.assignment_revision=a.assignment_revision and r.reviewer_account_id='${reviewer}'::uuid)
    from private.claim_review_reads r join private.claim_documents d on d.id=r.document_id
    join private.claim_review_assignments a on a.review_id=r.review_id and a.status='current'
    where r.review_id='${claim}'::uuid and r.document_id is not null`)).toBe("2/true");
  await expectOpaque(lookupPath,{...lookup,reviewRevision:2});
  await expectOpaque(lookupPath,{...lookup,selectedProfile:current.record.evidence.photoIdentityDocumentId});
  await expectOpaque(lookupPath,{...lookup,nonce:current.nonce});

  const controls=page.getByRole("group",{name:"Identity checked from both documents",exact:true});
  await expect(controls).toBeVisible();await controls.getByLabel("Full name",{exact:true}).fill(identity.fullName);
  await controls.getByLabel("Birth date",{exact:true}).fill("2000-01-31");
  await expect(controls.getByRole("button",{name:"Check details",exact:true})).toBeDisabled();
  await controls.getByRole("checkbox",{name:"This person is an adult.",exact:true}).check();
  for(let pass=0;pass<2;pass++){
    const observed=await observeNativeResponses(page,{verify:`^${lookupPath}$`});
    try{
      await controls.getByRole("button",{name:"Check details",exact:true}).click();
      const response=await observed.read("verify");expect(response.status).toBe(200);expectNoUniqueKeylessResponse(response.text,claim);
      await expect(controls.getByRole("status")).toHaveText("No single record could be found. Do not choose a record.");
    }finally{await observed.dispose();}
    expect(await keylessEffectProof(claim)).toBe(unchanged);
  }
  await expect(page.getByLabel("Choice",{exact:true}).locator("option")).toHaveText(["Refuse claim","Ask for more information"]);
  await expect(page.getByRole("heading",{name:"Parent details",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Start owner notice",exact:true})).toHaveCount(0);
  await expectOpaque(`/api/reviews/future-person/claims/${claim}`,{decision:"keyless-document-match",reviewRevision:1,nonce:current.nonce,
    reason:"A no-match fixture must never become owner-notice authority.",documentaryAttestation:{...lookup.documentaryAttestation,recordedParentLinkConfirmed:true},verificationProof:null});
  await expectOpaque(`/api/reviews/future-person/claims/${claim}/release`,{decision:"approve-release",reviewRevision:1,noticeRevision:1,
    nonce:current.nonce,reason:"The initial documentary proof cannot authorize a separate release.",now:"2099-01-01T00:00:00Z"});
  const other=await browser.newContext({baseURL});
  try{
    const otherReviewer=await signInReviewer(other,baseURL);
    await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewId(otherReviewer)}'::uuid);`);
    const otherPage=await other.newPage();expect((await otherPage.goto(`/reviews/future-person/claims/${claim}`))?.status()).toBe(404);
    const denied=await nativeReviewRequest(otherPage,lookupPath,lookup,current.csrf);expect(denied.status).toBe(404);
    expect(denied.body).toEqual({error:"not_found"});expect(await keylessEffectProof(claim)).toBe(unchanged);
  }finally{await other.close();}
  const observed=watchRequests(page);await expectAxeClean(page);await assertNoThirdParty(page,observed,"real keyless documentary controls, both themes");
  await page.getByLabel("Reason",{exact:true}).fill("The synthetic documentary papers match no unique eligible record. No record was chosen.");
  const decision=await observeNativeResponses(page,{save:`^/api/reviews/future-person/claims/${claim}$`});
  try{
    await page.getByRole("button",{name:"Save choice",exact:true}).click();
    expect(await decision.read("save")).toEqual({status:200,text:JSON.stringify({claimId:claim,state:"refused",reviewRevision:2})});
    await expect(page.getByRole("status")).toHaveText("Decision saved.");
  }finally{await decision.dispose();}
  await expect(page.getByRole("img")).toHaveCount(0);await expect(controls).toHaveCount(0);
  const closed=await keylessEffectProof(claim);expect(closed===unchanged).toBe(false);
  const stale=await nativeReviewRequest(page,lookupPath,lookup,current.csrf);expect(stale.status).toBe(404);expect(stale.body).toEqual({error:"not_found"});
  const replay=await nativeReviewRequest(page,`/api/reviews/future-person/claims/${claim}`,{decision:"reject",reviewRevision:1,nonce:current.nonce,
    reason:"The original documentary decision cannot be replayed after refusal."},current.csrf);
  expect(replay.status).toBe(404);expect(replay.body).toEqual({error:"not_found"});expect(await keylessEffectProof(claim)).toBe(closed);
  expect(await reviewFixtureSql(`select r.state||'/'||r.review_revision||'/'||
    (i.identity_key_shredded_at is not null and octet_length(i.wrapped_data_key)=29 and octet_length(i.identity_ciphertext)=29 and i.key_hash is null)||'/'||
    (select count(*) from private.claim_review_decisions d where d.review_id=r.id)||'/'||
    (select bool_and(s.wrapped_document_key is null and s.document_key_shredded_at is not null) from private.claim_document_sessions s where s.intake_id=r.id)
    from private.claim_reviews r join private.future_person_claim_intakes i on i.id=r.id where r.id='${claim}'::uuid`)).toBe("refused/2/true/1/true");
});

test("Keyless documentary review: all bytes without the last acknowledgement remain unread",async({page,context,baseURL})=>{
  if(!baseURL)throw new Error("Local app origin unavailable");
  const claim=await createReviewCase(page,context),reviewer=await signInReviewer(context,baseURL);
  await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewId(reviewer)}'::uuid);
    select private.assign_claim_review_v1('${reviewId(claim)}'::uuid,'${reviewId(reviewer)}'::uuid);`);
  expect((await page.goto(`/reviews/future-person/claims/${claim}`))?.status()).toBe(200);
  await expect(page.getByRole("button",{name:"Open Picture ID",exact:true})).toBeEnabled();
  const current=await currentDocumentaryCase(page,claim),unchanged=await keylessEffectProof(claim);
  let canceled=0;const chunks:number[]=[];
  page.on("response",response=>{if(response.request().method()==="GET"&&/^\/api\/downloads\/[^/]+\/chunks\/[01]$/u.test(new URL(response.url()).pathname)&&response.status()===200)
    chunks.push(Number(new URL(response.url()).pathname.slice(-1)));});
  await page.route("**/api/downloads/*/chunks/1/acknowledge",async route=>{canceled++;await route.abort("aborted");});
  const first=await observeNativeResponses(page,{ack:"^/api/downloads/[^/]+/chunks/0/acknowledge$"});
  try{
    await page.getByRole("button",{name:"Open Picture ID",exact:true}).click();
    expect(await first.read("ack")).toEqual({status:204,text:""});
    await expect(page.getByRole("status")).toHaveText("The full document could not be read. Reload this page before trying again.");
    expect(chunks).toEqual([0,1]);expect(canceled).toBe(1);
    await expect(page.getByRole("img")).toHaveCount(0);await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button",{name:"Check details",exact:true})).toHaveCount(0);
    await expect(page.getByRole("button",{name:"Save choice",exact:true})).toBeDisabled();
    expect(await reviewFixtureSql(`select count(*)||'/'||coalesce(bool_and(x.sequence=0 and x.acknowledged_at is not null),false)
      from private.claim_review_downloads d join private.claim_review_chunk_receipts x on x.download_id=d.id
      where d.review_id='${claim}'::uuid and x.acknowledged_at is not null`)).toBe("1/true");
    expect(await reviewFixtureSql(`select private.claim_document_fully_read_v1('${claim}'::uuid,'${reviewer}'::uuid,r.photo_document_id)
      from private.claim_reviews r where r.id='${claim}'::uuid`)).toBe("f");
    const response=await nativeReviewRequest(page,`/api/reviews/future-person/claims/${claim}/verify-documents`,{reviewRevision:1,nonce:current.lookup,
      documentaryAttestation:{fullName:"Synthetic Claimant",dateOfBirth:"2000-01-31",photoIdentityReviewed:true,birthRecordReviewed:true,adultAgeConfirmed:true}},current.csrf);
    expect(response.status).toBe(404);expect(response.body).toEqual({error:"not_found"});expect(await keylessEffectProof(claim)).toBe(unchanged);
  }finally{await first.dispose();await page.unroute("**/api/downloads/*/chunks/1/acknowledge");}
});
