import http from "node:http";
import type {Page} from "@playwright/test";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {expect,test} from "./audited-test";
import {assertNoThirdParty,drainMailUntil,expectAxeClean,watchRequests} from "./helpers";
import {withEmbryoJourney} from "../scripts/ci-embryo-journey";
import {participantCPassword,seedParticipantC,type ParticipantCMail} from "./participant-c-journey";
import {createReviewCase,reviewFixtureSql,signInReviewer} from "./helpers/claim-review-fixture";
import {syntheticHistoricalTransfer} from "./helpers/historical-embryo-transfer";
import {nativeReviewRequest,openSyntheticReviewPdf,reviewId} from "./helpers/keyless-review-journey";
import {expectFullDocumentReceipts,otherCurrentParent} from "./helpers/keyless-positive-journey";
import {claimedRecordProof,proveClaimantDeleteClosed} from "./helpers/claimant-delete-closed";
import {observeNativeResponses} from "./helpers/native-response-observer";
import {keylessReviewDocument} from "./fixtures/keyless-review-documents";
import {CLAIMANT_PAGE,RELEASE_LINK_SPENT,RELEASE_MAIL} from "./fixtures/claimant-record-page-text";
import {reviewPageCase} from "../src/lib/future-person/review-page-contract";

/**
 * G5.4, the future adult's accountless path, in one browser journey on the
 * isolated embryo app (owner decisions of 16 October, "G5.4 is judged on the
 * brief's minimum under TEST-LOCAL" and "Claimant retention stated in days
 * (G5.4)", and of 22 October, "How G5.4's claimant delete is proven"):
 *
 *   1. an approved claim: a parent collects the record's replacement Record
 *      Key Card after the TEST-only historical transfer, the claimant starts a
 *      Record Key claim with real encrypted, scanned papers, and a named,
 *      stepped-up reviewer reads both in full and approves;
 *   2. the release that approval queues, with the claimant's temporary
 *      contact kept for exactly 730 days;
 *   3. the release mail, captured by this spec's local mail mock (owner
 *      decision: local mail capture is delivery proof under TEST-LOCAL);
 *   4. the claimed record's page on /withdraw/session, with its retention in
 *      days and its contact of last resort, and the Recovery Key receipt that
 *      reports the contact's 730th day;
 *   5. the claimant delete as it is on this app: closed. Its executor needs a
 *      direct superuser database connection that the isolated runtime blocks
 *      by design, so no control is offered, the DELETE is the closed 404 and
 *      nothing is deleted. The working delete is proven by pgTAP and route
 *      tests; see `e2e/helpers/claimant-delete-closed.ts`.
 *
 * Synthetic people, papers and DNA only. Naming the reviewer and assigning
 * the case are the owner-only fixture operations the review specs already use.
 * Nothing confers human-review, provider-delivery or elapsed-year credit.
 */
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

const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
const RELEASE_LINK=/http:\/\/localhost:3105\/withdraw\/request#[A-Za-z0-9_-]{43}/gu;

test("Claimed record without an account: an approved Record Key claim, its captured release mail, the claimant page's retention in days and contact, and the delete closed on this app",async({page,browser,baseURL},testInfo)=>{
  test.setTimeout(300_000);
  if(baseURL!=="http://localhost:3105")throw new Error("Exact isolated embryo app required");
  const suffix=randomUUID(),ownerEmail=`cmp-t6-${suffix}@e2e.local`,parentEmail=`cmp-t6-${suffix}-parent@e2e.local`;
  const contactEmail=`claimant-${randomBytes(8).toString("hex")}@e2e.local`;
  await withEmbryoJourney(process.env,async runtime=>{
    const seeded=await seedParticipantC({page,browser,ownerEmail,parentEmail,password:participantCPassword,messages,runtime});
    const claimantContext=await browser.newContext({baseURL}),reviewContext=await browser.newContext({baseURL});
    const releaseContext=await browser.newContext({baseURL}),replayContext=await browser.newContext({baseURL});
    try{
      const embryo=reviewId(seeded.embryos[0].id),subject=reviewId(seeded.embryos[0].subject_id),sibling=reviewId(seeded.embryos[1].id);
      const siblingRow=()=>reviewFixtureSql(`select encode(extensions.digest(convert_to(to_jsonb(e)::text,'UTF8'),'sha256'),'hex')
        from public.embryos e where e.id='${sibling}'`);
      const siblingBefore=await siblingRow();expect(siblingBefore).toMatch(/^[0-9a-f]{64}$/u);
      const name=randomBytes(4).toString("hex");
      let claim="",reviewer="",review:Page|null=null,identity={fullName:"",dateOfBirth:"",placeOfBirth:"",parentNames:[] as string[]};
      let decidedFrom="",decidedTo="",contactDay="",link="";

      await test.step("1. An approved claim: the parent's replacement Record Key Card, the claimant's real papers and a named reviewer's approval",async()=>{
        const otherAccount=await otherCurrentParent(seeded.cohortId,seeded.owner);
        const historical=await syntheticHistoricalTransfer({embryoId:embryo,parents:[
          {page,accountId:seeded.owner},{page:seeded.other,accountId:otherAccount}]});
        // The proposing parent collects the transfer's replacement Card through
        // the real settings control. The raw key exists only in that response.
        await page.goto("/settings/data");
        const control=page.locator(`[data-slot="record-key-card-control"][data-cohort-id="${seeded.cohortId}"]`);
        await expect(control).toHaveCount(1);
        let recordKey="";
        const cards=await observeNativeResponses(page,{cards:`^/api/embryo-cohorts/${seeded.cohortId}/record-key-cards$`});
        try{
          await control.getByRole("button",{name:"Show my cards",exact:true}).click();
          const reply=await cards.read("cards");expect(reply.status).toBe(200);
          const delivered=(JSON.parse(reply.text) as {record_key_cards:{embryo_id:string;record_key:string;delivery_kind:string}[]})
            .record_key_cards.filter(card=>card.embryo_id===embryo);
          expect(delivered.map(card=>card.delivery_kind),"exactly one replacement Card for the transferred record").toEqual(["transfer_replacement"]);
          recordKey=delivered[0]!.record_key;
          const shown=await control.locator(`[data-slot="record-key-card"][data-embryo-id="${embryo}"] [data-slot="record-key-value"]`).textContent();
          // Compare as booleans so a failed assertion cannot print the key.
          expect(shown===recordKey,"the page shows the delivered key").toBe(true);
          await control.getByRole("button",{name:"Continue",exact:true}).click();
        }finally{await cards.dispose();await page.goto("/overview").catch(()=>undefined);}
        expect(await reviewFixtureSql(`select count(*) from public.future_person_record_key_hashes
          where embryo_id='${embryo}' and status='current' and key_hash='${sha256(recordKey)}'`),"the collected key is the record's current Card").toBe("1");

        identity={fullName:`Synthetic Claimant ${name}`,dateOfBirth:historical.documentaryBirth,placeOfBirth:`Synthetic City ${name}`,
          parentNames:["Synthetic Parent","Synthetic Parent"]};
        const papers={photo:keylessReviewDocument("photo",identity),birth:keylessReviewDocument("birth",identity)};
        const claimant=await claimantContext.newPage();
        claim=await createReviewCase(claimant,claimantContext,{photo:{bytes:papers.photo,extension:"pdf",mimeType:"application/pdf"},
          birth:{bytes:papers.birth,extension:"pdf",mimeType:"application/pdf"},claimant:identity,recordKey:{key:recordKey,contactEmail}});
        recordKey="";

        reviewer=await signInReviewer(reviewContext,baseURL);const reviewing=await reviewContext.newPage();review=reviewing;
        await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewId(reviewer)}');
          select private.assign_claim_review_v1('${reviewId(claim)}','${reviewer}');`);
        expect((await reviewing.goto(`/reviews/future-person/claims/${claim}`))?.status()).toBe(200);
        const current=await nativeReviewRequest(reviewing,`/api/reviews/future-person/claims/${claim}`);
        expect(current.status).toBe(200);expect(current.cache).toBe("private, no-store");expect(current.referrer).toBe("no-referrer");
        const record=reviewPageCase.parse(current.body);
        expect({claimId:record.claimId,mode:record.mode,state:record.state,reviewRevision:record.reviewRevision,claimant:record.claimant,
          kind:record.case.kind,notice:record.notice}).toEqual({claimId:claim,mode:"record-key",state:"document_review_pending",reviewRevision:1,
          claimant:{fullName:identity.fullName,dateOfBirth:identity.dateOfBirth},kind:"record_key",notice:{state:"not_applicable",noticeRevision:null}});
        if(record.case.kind!=="record_key")throw new Error("The Card did not select its record");
        await expect(reviewing.getByText(`Recorded parent names: ${record.case.recordedParentLink.recordedParentNames.join(", ")}.`,{exact:true})).toBeVisible();
        await expect(reviewing.getByLabel("Choice",{exact:true}).locator("option")).toHaveText(["Refuse claim","Ask for more information","Approve claim"]);
        await openSyntheticReviewPdf(reviewing,"photo");await openSyntheticReviewPdf(reviewing,"birth");
        await expectFullDocumentReceipts(claim,reviewer,papers);
        await reviewing.getByLabel("Choice",{exact:true}).selectOption("approve-record-key");
        const attestation=reviewing.getByRole("group",{name:"Identity checked from the documents",exact:true});
        await attestation.getByLabel("Full name",{exact:true}).fill(identity.fullName);
        await attestation.getByLabel("Birth date",{exact:true}).fill(identity.dateOfBirth);
        await attestation.getByRole("checkbox",{name:"This person is an adult.",exact:true}).check();
        await attestation.getByRole("checkbox",{name:"The birth record and the parent name match.",exact:true}).check();
        await reviewing.getByLabel("Reason",{exact:true}).fill("Both synthetic full papers name this adult and the recorded parents. The Record Key selected the record.");
        decidedFrom=new Date(await reviewFixtureSql("select clock_timestamp()")).toISOString();
        const decision=await observeNativeResponses(reviewing,{save:`^/api/reviews/future-person/claims/${claim}$`});
        try{
          await reviewing.getByRole("button",{name:"Save choice",exact:true}).click();
          expect(await decision.read("save")).toEqual({status:200,text:JSON.stringify({claimId:claim,state:"release_queued",reviewRevision:2})});
          await expect(reviewing.getByRole("status")).toHaveText("Decision saved.");
        }finally{await decision.dispose();}
        decidedTo=new Date(await reviewFixtureSql("select clock_timestamp()")).toISOString();
        await expect(reviewing.getByRole("img")).toHaveCount(0);
        await expect(reviewing.getByText(identity.fullName,{exact:false})).toHaveCount(0);
      });

      await test.step("2. The release: the record leaves parental custody, and the claimant's contact is kept for exactly 730 days",async()=>{
        expect(await reviewFixtureSql(`select r.state||'/'||r.review_revision||'/'||c.status||'/'||c.claim_method||'/'||s.lifecycle||'/'||
          (s.owner_account_id is null and s.subject_account_id is null and s.cohort_id is null)||'/'||(s.claimant_principal_id=cp.id)||'/'||cp.status
          from private.claim_reviews r join public.future_person_claims c on c.id=r.id
          join public.future_person_claimant_principals cp on cp.claim_id=c.id
          join public.embryos e on e.id=c.embryo_id join public.subjects s on s.id=e.subject_id
          where r.id='${claim}' and e.id='${embryo}' and s.id='${subject}'`),"the approval resolved the case and gave the record to one claimant, with no account")
          .toBe("closed/2/approved/record_key/claimed_unbound/true/true/current");
        // Owner decision 2026-10-16, "Claimant retention stated in days (G5.4)":
        // future-person.claimed-unbound-24mo is exactly 730 days from the release.
        expect(await reviewFixtureSql(`select count(*)||'/'||coalesce(bool_and(t.fixed_deadline=c.created_at+interval '730 days'
          and extract(epoch from t.fixed_deadline-c.created_at)=730*86400
          and c.created_at between '${decidedFrom}'::timestamptz and '${decidedTo}'::timestamptz
          and t.state='scheduled' and p.phase_deadline=t.fixed_deadline and p.status='pending' and cp.contact_expires_at=t.fixed_deadline
          and o.template_id='future-person-release' and o.target_id='${subject}'
          and o.expires_at=least(c.created_at+interval '7 days',t.fixed_deadline)),false)
          from public.future_person_claimant_principals cp
          join public.retention_rows t on t.target_id=cp.id and t.retention_id='future-person.claimed-unbound-24mo'
          join public.retention_due_phases p on p.retention_row_id=t.id
          join public.encrypted_contact_references c on c.id=(p.immutable_envelope->>'contactReferenceId')::uuid
          join public.mail_outbox o on o.id=(p.immutable_envelope->>'outboxId')::uuid
          where cp.claim_id='${claim}'`),"one contact clock at exactly 730 days, with the release mail's own 7-day window inside it").toBe("1/true");
        contactDay=await reviewFixtureSql(`select to_char(t.fixed_deadline at time zone 'UTC','YYYY-MM-DD')
          from public.future_person_claimant_principals cp
          join public.retention_rows t on t.target_id=cp.id and t.retention_id='future-person.claimed-unbound-24mo'
          where cp.claim_id='${claim}'`);
        expect(contactDay).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
        expect(await reviewFixtureSql(`select count(*) from public.future_person_claim_notices
          where claim_id='${claim}' and notice_kind='release'`)).toBe("1");
        expect(await reviewFixtureSql(`select count(*) from public.retention_rows where target_id='${subject}'
          and retention_id='future-person.claimant-reverification-until-request'`),"a claimed record has no deletion clock before the claimant asks").toBe("0");
      });

      await test.step("3. The release mail: captured by the local mail mock, sent only to the claimant's own address, with one link that works once",async()=>{
        if(!review)throw new Error("The reviewer page is unavailable");
        const isRelease=(message:Delivered)=>[message.to].flat().includes(contactEmail)&&message.subject===RELEASE_MAIL.subject;
        const mail=await drainMailUntil((review as Page).request,()=>messages.find(isRelease),"the claimant's release mail");
        expect(messages.filter(isRelease)).toHaveLength(1);
        expect([mail.to].flat()).toEqual([contactEmail]);
        const html=mail.html??"";
        expect(html).toContain(RELEASE_MAIL.approved);expect(html).toContain(RELEASE_MAIL.once);
        const links=[...new Set(html.match(RELEASE_LINK)??[])];
        expect(links,"exactly one private link, carried in the fragment").toHaveLength(1);
        link=links[0]!;
        expect(await reviewFixtureSql(`select m.state||'/'||d.status from public.future_person_claim_notices n
          join public.mail_outbox m on m.id=n.outbox_id join public.mail_deliveries d on d.outbox_id=m.id
          where n.claim_id='${claim}' and n.notice_kind='release'`),"the mail job submitted the release and the provider accepted it").toBe("submitted/accepted");
      });

      let csrf="",sessionHash="";
      const claimed=await releaseContext.newPage();
      await test.step("4. /withdraw/[token] complete: the release link opens the claimed record's page on /withdraw/session, with its retention in days and its contact, and no account",async()=>{
        const observed=watchRequests(claimed);
        await claimed.goto(link);
        await expect(claimed.getByRole("heading",{name:"Open your request",exact:true})).toBeVisible();
        await claimed.getByRole("button",{name:"Continue",exact:true}).click();
        await claimed.waitForURL(/\/withdraw\/session$/u);
        await expect(claimed.getByRole("heading",{name:CLAIMANT_PAGE.heading,exact:true,level:1})).toBeVisible();
        await expect(claimed.getByText(CLAIMANT_PAGE.intro,{exact:true})).toBeVisible();
        await expect(claimed.locator('[data-slot="claimant-retention"]')).toHaveText(CLAIMANT_PAGE.retention);
        await expect(claimed.locator('[data-slot="claimant-contact"]')).toHaveText(CLAIMANT_PAGE.contact);
        const cookies=await releaseContext.cookies();
        expect(cookies.filter(cookie=>cookie.name.startsWith("sb-")),"no account session exists in this browser").toEqual([]);
        const rights=cookies.filter(cookie=>/^(__Host-)?inherit-rights$/u.test(cookie.name));
        expect(rights).toHaveLength(1);
        sessionHash=sha256(rights[0]!.value);
        expect(await reviewFixtureSql(`select purpose||'/'||target_kind||'/'||(target_id='${subject}')||'/'||status
          from public.rights_sessions where session_hash='${sessionHash}'`)).toBe("approved-future-person-release/claimed-subject/true/active");
        await expectAxeClean(claimed);
        await assertNoThirdParty(claimed,observed,"the claimed record's page, both themes","http://localhost:3105");

        // The mail says the link works once: a second opening opens nothing.
        const replay=await replayContext.newPage();
        await replay.goto(link);await replay.getByRole("button",{name:"Continue",exact:true}).click();
        await expect(replay.getByRole("status")).toHaveText(RELEASE_LINK_SPENT);
        expect((await replayContext.cookies()).filter(cookie=>/^(__Host-)?inherit-rights$/u.test(cookie.name))).toEqual([]);

        // The Recovery Key receipt reports the contact's 730th day, the date the page's sentence states.
        const recovery=claimed.getByRole("group",{name:CLAIMANT_PAGE.recoveryLegend,exact:true});
        await recovery.getByRole("checkbox",{name:CLAIMANT_PAGE.recoveryAcknowledgement,exact:true}).check();
        const sent=claimed.waitForRequest(request=>request.method()==="POST"
          &&new URL(request.url()).pathname==="/api/future-person/claim/session/recovery-key");
        const issued=await observeNativeResponses(claimed,{key:"^/api/future-person/claim/session/recovery-key$"});
        try{
          await recovery.getByRole("button",{name:CLAIMANT_PAGE.recoveryButton,exact:true}).click();
          csrf=(await sent).headers()["x-inherit-csrf"]??"";
          const reply=await issued.read("key");expect(reply.status).toBe(201);
          const receipt=JSON.parse(reply.text) as Record<string,unknown>;
          expect(Object.keys(receipt).sort()).toEqual(["contactMaterialExpiresOn","reverificationBinding","recordRetention","recoveryKey"]);
          expect({contactMaterialExpiresOn:receipt.contactMaterialExpiresOn,reverificationBinding:receipt.reverificationBinding,
            recordRetention:receipt.recordRetention}).toEqual({contactMaterialExpiresOn:contactDay,
            reverificationBinding:"retained-until-account-binding-key-rotation-or-claimant-deletion",
            recordRetention:"claimed-record-is-not-deleted-by-temporary-contact-expiry"});
          const key=String(receipt.recoveryKey);
          expect(/^[0-9A-HJKMNP-TV-Z]{20}$/u.test(key)).toBe(true);
          await expect(claimed.getByText(CLAIMANT_PAGE.recoveryShown,{exact:true})).toBeVisible();
          expect(await claimed.locator("p.font-mono").textContent()===key,"the page shows the issued key once").toBe(true);
          expect(await reviewFixtureSql(`select count(*) from public.future_person_recovery_key_hashes k
            join public.future_person_claimant_principals cp on cp.id=k.claimant_principal_id
            where cp.claim_id='${claim}' and k.status='current' and k.recovery_key_hash='${sha256(key)}'`)).toBe("1");
        }finally{await issued.dispose();}
        // Leave no raw key in the page for later snapshots.
        await claimed.reload();
        await expect(claimed.locator("p.font-mono")).toHaveCount(0);
        await expect(claimed.locator('[data-slot="claimant-retention"]')).toHaveText(CLAIMANT_PAGE.retention);
      });

      await test.step("5. The claimant delete on this app: no delete control is offered, a DELETE with the page's own CSRF gets the closed 404, and nothing is deleted",async()=>{
        await proveClaimantDeleteClosed(claimed,{csrf,proof:()=>claimedRecordProof({subjectId:subject,claimId:claim,
          cohortId:seeded.cohortId,siblingId:sibling,sessionHash})});
        await claimed.reload();
        await expect(claimed.getByRole("heading",{name:CLAIMANT_PAGE.heading,exact:true,level:1})).toBeVisible();
        await expect(claimed.locator('[data-slot="claimant-contact"]')).toHaveText(CLAIMANT_PAGE.contact);
        expect(await siblingRow(),"the sibling's record is untouched from before the transfer to the end").toBe(siblingBefore);
      });

      await testInfo.attach("claimed-record-proof",{contentType:"application/json",body:JSON.stringify({
        historicalProducer:"time-compressed-synthetic-owner-producer",documentaryEvidence:"actual-encrypted-uploads-scan-EOF-client-ACK-render-attestation",
        releaseMail:"local-mail-mock-capture",contactDays:730,claimantPage:"retention-in-days-and-contact-asserted",
        claimantDelete:"closed-on-standard-app-not-executed",acceptanceCredit:false})});
    }finally{
      await claimantContext.close();await reviewContext.close();await releaseContext.close();await replayContext.close();
      await seeded.closeCoParent();
    }
  });
});
