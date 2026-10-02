import http from "node:http";
import {randomUUID} from "node:crypto";
import {expect,test} from "./audited-test";
import {assertNoThirdParty,drainMailUntil,expectAxeClean,watchRequests} from "./helpers";
import {withEmbryoJourney} from "../scripts/ci-embryo-journey";
import {participantCPassword,seedParticipantC,type ParticipantCMail} from "./participant-c-journey";
import {createReviewCase,reviewFixtureSql,signInReviewer} from "./helpers/claim-review-fixture";
import {syntheticHistoricalTransfer} from "./helpers/historical-embryo-transfer";
import {currentDocumentaryCase,keylessEffectProof,nativeReviewRequest,openSyntheticReviewPdf,reviewId} from "./helpers/keyless-review-journey";
import {expectFullDocumentReceipts,keylessSourceProof,otherCurrentParent,saveNativeMatchingDetails,
  sendSyntheticDeliveredCallback,syntheticDeliveredCallback} from "./helpers/keyless-positive-journey";
import {observeNativeResponses} from "./helpers/native-response-observer";
import {keylessReviewDocument} from "./fixtures/keyless-review-documents";
import {keylessVerificationResponse,reviewPageCase} from "../src/lib/future-person/review-page-contract";

// Explicit software provider fixture. IDs come from actual accepted local
// submissions; the unchanged native webhook verifies a per-run ephemeral key.
// No provider, human, elapsed-year/day or final-release acceptance is claimed.
test.use({baseURL:"http://localhost:3105"});
type Delivered=ParticipantCMail&{id:string;subject:string};
const messages:Delivered[]=[];
let receiver:http.Server;
test.beforeAll(async()=>{
  receiver=http.createServer((request,response)=>{
    if(request.method!=="POST"||request.url!=="/emails"){response.writeHead(404).end();return;}
    let body="",size=0;
    request.on("data",bytes=>{size+=bytes.length;if(size>65_536)request.destroy();else body+=String(bytes);});
    request.on("end",()=>{
      try{
        const row=JSON.parse(body) as {to?:unknown;subject?:unknown;html?:unknown};
        if(!(typeof row.to==="string"||Array.isArray(row.to)&&row.to.every(value=>typeof value==="string"))
          ||typeof row.subject!=="string"||typeof row.html!=="string"||messages.length>=128)throw new Error("unavailable");
        const id=randomUUID();messages.push({id,to:row.to,subject:row.subject,html:row.html});
        response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({id}));
      }catch{response.writeHead(400).end();}
    });
  });
  await new Promise<void>(resolve=>receiver.listen(8124,"127.0.0.1",resolve));
});
test.afterAll(async()=>{receiver?.closeAllConnections();if(receiver)await new Promise<void>(resolve=>receiver.close(()=>resolve()));});

test("Keyless positive documentary match: native owner notice, authenticated synthetic delivery and a real thirty-day release hold",async({page,browser,baseURL},testInfo)=>{
  test.setTimeout(300_000);
  if(baseURL!=="http://localhost:3105")throw new Error("Exact isolated embryo app required");
  const suffix=randomUUID(),ownerEmail=`cmp-t6-${suffix}@e2e.local`,parentEmail=`cmp-t6-${suffix}-parent@e2e.local`;
  await withEmbryoJourney(process.env,async runtime=>{
    const seeded=await seedParticipantC({page,browser,ownerEmail,parentEmail,password:participantCPassword,messages,runtime});
    const claimantContext=await browser.newContext({baseURL}),reviewContext=await browser.newContext({baseURL}),freshContext=await browser.newContext({baseURL});
    try{
      const embryo=reviewId(seeded.embryos[0].id),sibling=reviewId(seeded.embryos[1].id);
      const source=await keylessSourceProof(seeded.cohortId),otherAccount=await otherCurrentParent(seeded.cohortId,seeded.owner);
      const siblingBefore=await reviewFixtureSql(`select encode(extensions.digest(convert_to(to_jsonb(e)::text,'UTF8'),'sha256'),'hex')
        from public.embryos e where e.id='${sibling}'`);
      const historical=await syntheticHistoricalTransfer({embryoId:embryo,parents:[
        {page,accountId:seeded.owner},{page:seeded.other,accountId:otherAccount}]});
      expect(await keylessSourceProof(seeded.cohortId)).toBe(source);
      const identity={fullName:`Synthetic Claimant ${suffix.replaceAll("-","")}`,dateOfBirth:historical.documentaryBirth,
        placeOfBirth:`Synthetic City ${suffix.replaceAll("-","")}`,parentNames:["Synthetic Parent","Synthetic Parent"]};
      await saveNativeMatchingDetails(seeded.other,embryo,identity,historical.closingDate);
      expect(await keylessSourceProof(seeded.cohortId)).toBe(source);
      const papers={photo:keylessReviewDocument("photo",identity),birth:keylessReviewDocument("birth",identity)};
      const claimant=await claimantContext.newPage();
      const claim=await createReviewCase(claimant,claimantContext,{photo:{bytes:papers.photo,extension:"pdf",mimeType:"application/pdf"},
        birth:{bytes:papers.birth,extension:"pdf",mimeType:"application/pdf"},claimant:identity});
      const reviewer=await signInReviewer(reviewContext,baseURL),review=await reviewContext.newPage();
      await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewId(reviewer)}');
        select private.assign_claim_review_v1('${reviewId(claim)}','${reviewer}');`);
      expect((await review.goto(`/reviews/future-person/claims/${claim}`))?.status()).toBe(200);
      const documentary=await currentDocumentaryCase(review,claim),initial=await keylessEffectProof(claim);
      await expect(review.getByRole("heading",{name:"Parent details",exact:true})).toHaveCount(0);
      await expect(review.getByRole("button",{name:"Check details",exact:true})).toHaveCount(0);
      const lookup={reviewRevision:1,nonce:documentary.lookup,documentaryAttestation:{fullName:identity.fullName,dateOfBirth:identity.dateOfBirth,
        photoIdentityReviewed:true,birthRecordReviewed:true,adultAgeConfirmed:true}};
      const unread=await nativeReviewRequest(review,`/api/reviews/future-person/claims/${claim}/verify-documents`,lookup,documentary.csrf);
      expect(unread.status).toBe(404);expect(unread.body).toEqual({error:"not_found"});expect(await keylessEffectProof(claim)).toBe(initial);
      await openSyntheticReviewPdf(review,"photo");await openSyntheticReviewPdf(review,"birth");
      await expectFullDocumentReceipts(claim,reviewer,papers);
      const comparison=review.getByRole("group",{name:"Identity checked from both documents",exact:true});
      await comparison.getByLabel("Full name",{exact:true}).fill(identity.fullName);
      await comparison.getByLabel("Birth date",{exact:true}).fill(identity.dateOfBirth);
      await comparison.getByRole("checkbox",{name:"This person is an adult.",exact:true}).check();
      const checked=await observeNativeResponses(review,{check:`^/api/reviews/future-person/claims/${claim}/verify-documents$`});
      try{
        await comparison.getByRole("button",{name:"Check details",exact:true}).click();
        const response=await checked.read("check");expect(response.status).toBe(200);
        const proof=keylessVerificationResponse.parse(JSON.parse(response.text));
        expect(proof.verificationProof).not.toBeNull();expect(proof.reviewCase.case).toEqual({kind:"unclaimed_keyless",candidateClass:"exactly_one",
          selectedProfile:{childDateOfBirth:identity.dateOfBirth,childPlaceOfBirth:identity.placeOfBirth,parentNames:identity.parentNames}});
        expect(JSON.stringify(proof)).not.toMatch(/ciphertext|wrapped|profileId|subjectId|embryoId|candidateCount|ownerAccountId|Hmac|outboxId|assignmentRevision/u);
      }finally{await checked.dispose();}
      expect(await keylessEffectProof(claim)).toBe(initial);
      await expect(review.getByRole("heading",{name:"Parent details",exact:true})).toBeVisible();
      await review.getByLabel("Choice",{exact:true}).selectOption("keyless-document-match");
      const attestation=review.getByRole("group",{name:"Identity checked from the documents",exact:true});
      await attestation.getByLabel("Full name",{exact:true}).fill(identity.fullName);
      await attestation.getByLabel("Birth date",{exact:true}).fill(identity.dateOfBirth);
      await attestation.getByRole("checkbox",{name:"This person is an adult.",exact:true}).check();
      await attestation.getByRole("checkbox",{name:"The birth record and the parent name match.",exact:true}).check();
      await review.getByLabel("Reason",{exact:true}).fill("Both synthetic full papers and the current parent details support this documentary match. A separate owner notice and fresh review are required.");
      const mailStart=messages.length,decision=await observeNativeResponses(review,{save:`^/api/reviews/future-person/claims/${claim}$`});
      try{
        await review.getByRole("button",{name:"Save choice",exact:true}).click();
        expect(await decision.read("save")).toEqual({status:200,text:JSON.stringify({claimId:claim,state:"approved_pending_owner_notice",reviewRevision:2})});
        await expect(review.getByRole("status")).toHaveText("Decision saved.");
      }finally{await decision.dispose();}
      const accepted=await drainMailUntil(review.request,()=>messages.slice(mailStart).find(message=>[message.to].flat().includes(ownerEmail)
        &&message.subject==="A claim needs your review on Inherit"),"the actual unique claim owner notice");
      expect(await reviewFixtureSql(`select count(*)||'/'||bool_and(n.delivered_at is null and n.notice_deadline is null
        and n.provider_attempt_id is null and m.state='submitted' and k.state='open'
        and d.status='accepted' and a.submitted_at is not null and a.completed_at is not null and a.attempt_ordinal=m.attempt_count
        and a.outbox_id=m.id and a.provider='resend' and a.outcome_code='accepted'
        and a.provider_message_id_hmac is not null and m.last_outcome_code='accepted' and m.claimed_at is null)
        from public.future_person_claim_notices n join public.mail_outbox m on m.id=n.outbox_id
        join public.future_person_claim_review_packages k on k.claim_id=n.claim_id
        join public.mail_deliveries d on d.outbox_id=m.id join public.mail_provider_attempts a on a.id=d.provider_attempt_id
        where n.claim_id='${claim}' and n.owner_account_id='${seeded.owner}'`)).toBe("1/true");
      const pending=await keylessEffectProof(claim),callback=syntheticDeliveredCallback(accepted.id);
      const invalid=await review.request.post("/api/webhooks/resend",{headers:{...callback.headers,"svix-signature":"v1,invalid"},data:callback.payload});
      expect(invalid.status()).toBe(401);expect(await keylessEffectProof(claim)).toBe(pending);
      for(const difference of [-10*60_000,10*60_000]){
        const wrongClock=syntheticDeliveredCallback(accepted.id,new Date(Date.now()+difference));
        const earlyClock=await review.request.post("/api/webhooks/resend",{headers:wrongClock.headers,data:wrongClock.payload});
        expect(earlyClock.status()).toBe(401);expect(await keylessEffectProof(claim)).toBe(pending);
      }
      const deliveryBefore=new Date(await reviewFixtureSql("select clock_timestamp()")).toISOString();
      await sendSyntheticDeliveredCallback(review.request,callback);
      const deliveryAfter=new Date(await reviewFixtureSql("select clock_timestamp()")).toISOString();
      const delivered=await keylessEffectProof(claim);expect(delivered===pending).toBe(false);
      await sendSyntheticDeliveredCallback(review.request,callback);expect(await keylessEffectProof(claim)).toBe(delivered);
      expect(await reviewFixtureSql(`select count(*)||'/'||bool_and(n.delivered_at between '${deliveryBefore}'::timestamptz and '${deliveryAfter}'::timestamptz
        and n.notice_deadline=n.delivered_at+interval '30 days'
        and n.notice_deadline>clock_timestamp() and n.provider_attempt_id=d.provider_attempt_id and m.state='delivered' and d.status='delivered'
        and d.provider_event_hmac is not null and t.expires_at=n.notice_deadline and r.fixed_deadline=n.notice_deadline
        and p.phase_deadline=n.notice_deadline and p.status='pending')
        from public.future_person_claim_notices n join public.mail_outbox m on m.id=n.outbox_id
        join public.mail_deliveries d on d.outbox_id=m.id join public.token_candidates t on t.id=n.candidate_id
        join public.retention_rows r on r.target_kind='claim' and r.target_id=n.claim_id and r.retention_id='future-person.owner-notice-30d'
        join public.retention_due_phases p on p.retention_row_id=r.id and p.phase_id='owner-objection-window-complete'
        where n.claim_id='${claim}'`)).toBe("1/true");
      const second=await signInReviewer(freshContext,baseURL),fresh=await freshContext.newPage();expect(second===reviewer).toBe(false);
      await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewId(second)}');
        select private.assign_keyless_review_operation_v1('${claim}','${second}','claim-release');`);
      expect((await fresh.goto(`/reviews/future-person/claims/${claim}`))?.status()).toBe(200);
      const current=await nativeReviewRequest(fresh,`/api/reviews/future-person/claims/${claim}`);
      expect(current.status).toBe(200);const record=reviewPageCase.parse(current.body);
      expect(Boolean(current.csrf&&/^[a-f0-9]{64}$/u.test(current.csrf)&&current.nonce&&current.nonce.length<=2048)).toBe(true);
      expect(record.reviewRevision).toBe(2);expect(record.notice.state).toBe("notice_pending");
      await expect(fresh.getByRole("button",{name:"Save choice",exact:true})).toHaveCount(0);
      await expect(fresh.getByText("This claim is waiting. Open the case again when its next review is assigned.",{exact:true})).toBeVisible();
      await expect(fresh.getByRole("button",{name:"Open Picture ID",exact:true})).toHaveCount(0);
      await expect(fresh.getByRole("button",{name:"Open Birth record",exact:true})).toHaveCount(0);
      await expect(fresh.getByRole("img")).toHaveCount(0);await expect(fresh.getByRole("checkbox")).toHaveCount(0);
      const secondDocumentProof=()=>reviewFixtureSql(`select
        (select count(*) from private.claim_review_downloads where review_id='${claim}' and reviewer_account_id='${second}')||'/'||
        (select count(*) from private.claim_review_receipt_sessions receipt join private.claim_review_downloads download on download.id=receipt.download_id
          where download.review_id='${claim}' and download.reviewer_account_id='${second}')||'/'||
        (select count(*) from private.claim_review_chunk_receipts receipt join private.claim_review_downloads download on download.id=receipt.download_id
          where download.review_id='${claim}' and download.reviewer_account_id='${second}')||'/'||
        (select count(*) from private.claim_review_reads where review_id='${claim}' and reviewer_account_id='${second}' and document_id is not null)`);
      expect(await secondDocumentProof()).toBe("0/0/0/0");
      const hold=await keylessEffectProof(claim);
      for(const document of [record.evidence.photoIdentityDocumentId,record.evidence.birthRecordDocumentId]){
        const response=await nativeReviewRequest(fresh,`/api/legal-evidence/${reviewId(document)}/review-download`);
        expect(response.status).toBe(404);expect(response.body).toEqual({error:"not_found"});
        expect(response.cache).toBe("private, no-store");expect(response.referrer).toBe("no-referrer");
        expect(await secondDocumentProof()).toBe("0/0/0/0");expect(await keylessEffectProof(claim)).toBe(hold);
      }
      for(const nonce of [documentary.nonce,current.nonce]){
        const response=await nativeReviewRequest(fresh,`/api/reviews/future-person/claims/${claim}/release`,{
          decision:"approve-release",reviewRevision:2,noticeRevision:2,nonce,
          reason:"A synthetic callback is not thirty days of elapsed owner notice or an issued final release scope."},current.csrf??undefined);
        expect(response.status).toBe(404);expect(response.body).toEqual({error:"not_found"});
        expect(response.cache).toBe("private, no-store");expect(response.referrer).toBe("no-referrer");expect(await keylessEffectProof(claim)).toBe(hold);
        expect(await secondDocumentProof()).toBe("0/0/0/0");
      }
      expect(await keylessSourceProof(seeded.cohortId)).toBe(source);
      expect(await reviewFixtureSql(`select encode(extensions.digest(convert_to(to_jsonb(e)::text,'UTF8'),'sha256'),'hex')
        from public.embryos e where e.id='${sibling}'`)).toBe(siblingBefore);
      expect(await reviewFixtureSql(`select s.lifecycle||'/'||c.status||'/'||(s.claimant_principal_id is null)||'/'||
        (select count(*) from private.future_person_custody_slices x where x.subject_id=s.id)
        from public.future_person_claims c join public.embryos e on e.id=c.embryo_id join public.subjects s on s.id=e.subject_id
        where c.id='${claim}'`)).toBe("active/owner_notice/true/0");
      const observed=watchRequests(fresh);await expectAxeClean(fresh);await assertNoThirdParty(fresh,observed,"assigned native positive notice and real release hold, both themes");
      await testInfo.attach("keyless-positive-proof",{contentType:"application/json",body:JSON.stringify({
        historicalProducer:historical.evidence,providerEvidence:"authenticated-synthetic-native-delivery-fixture",
        documentaryEvidence:"actual-encrypted-uploads-scan-EOF-client-ACK-render-attestation",
        ownerPeriod:"unchanged-real-thirty-day-hold",separateReviewer:true,finalRelease:"refused-before-real-deadline",
        canonicalAndSignedHistoryUnchanged:true,siblingUnchanged:true,acceptanceCredit:false})});
    }finally{await claimantContext.close();await reviewContext.close();await freshContext.close();await seeded.closeCoParent();}
  });
});
