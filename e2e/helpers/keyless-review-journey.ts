import type {Page} from "@playwright/test";
import {expect} from "../audited-test";
import {reviewFixtureSql} from "./claim-review-fixture";
import {keylessEffectProofSql} from "./keyless-effect-proof-sql";
import {keylessVerificationResponse,reviewPageCase} from "../../src/lib/future-person/review-page-contract";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function reviewId(value:string){if(!UUID.test(value))throw new Error("Invalid synthetic review scope");return value;}
/** Stateless owner-only metadata proof. Read audit rows and real download
 * receipts are intentionally separate from decision/notice/custody effects. */
export async function keylessEffectProof(claim:string):Promise<string>{
  const id=reviewId(claim);
  return reviewFixtureSql(keylessEffectProofSql(id));
}

/** Send an actual same-origin fetch using the real browser cookies. Neither
 * requests nor responses are substituted, and nothing is written to a log. */
export async function nativeReviewRequest(page:Page,path:string,body?:unknown,csrf?:string){
  return page.evaluate(async ({path,body,csrf})=>{
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20_000);
    try{
      const response=await fetch(path,{method:body===undefined?"GET":"POST",credentials:"same-origin",cache:"no-store",signal:abort.signal,
        ...(body===undefined?{}:{headers:{"content-type":"application/json",...(csrf?{"x-inherit-csrf":csrf}:{})},body:JSON.stringify(body)})});
      const text=await response.text();if(text.length>16_384)throw new Error("Unexpected native response size");
      return {status:response.status,body:JSON.parse(text) as unknown,cache:response.headers.get("cache-control"),
        referrer:response.headers.get("referrer-policy"),csrf:response.headers.get("x-inherit-csrf"),
        nonce:response.headers.get("x-inherit-review-nonce"),lookup:response.headers.get("x-inherit-keyless-lookup-nonce")};
    }finally{clearTimeout(timer);abort.abort();}
  },{path,body,csrf});
}
export async function currentDocumentaryCase(page:Page,claim:string){
  const result=await nativeReviewRequest(page,`/api/reviews/future-person/claims/${reviewId(claim)}`);
  expect(result.status).toBe(200);expect(result.cache).toBe("private, no-store");expect(result.referrer).toBe("no-referrer");
  expect(Boolean(result.csrf&&/^[0-9a-f]{64}$/u.test(result.csrf))).toBe(true);
  expect(Boolean(result.nonce&&result.nonce.length<=2048)).toBe(true);
  expect(Boolean(result.lookup&&result.lookup.length<=2048)).toBe(true);
  const record=reviewPageCase.parse(result.body);expect(record.claimId).toBe(claim);
  expect(record.reviewRevision).toBe(1);expect(record.mode).toBe("keyless");expect(record.state).toBe("document_review_pending");
  expect(record.case).toEqual({kind:"keyless_none",selectorOutcome:"no_unique_candidate",allowedDecisions:["reject","needs-more-information"]});
  expect(record.notice).toEqual({state:"not_applicable",noticeRevision:null});
  return {record,csrf:result.csrf!,nonce:result.nonce!,lookup:result.lookup!};
}
export function expectNoUniqueKeylessResponse(text:string,claim:string){
  const result=keylessVerificationResponse.parse(JSON.parse(text));
  expect(Object.keys(result).sort()).toEqual(["reviewCase","verificationProof"]);
  expect(result.verificationProof).toBeNull();expect(result.reviewCase.claimId).toBe(claim);expect(result.reviewCase.reviewRevision).toBe(1);
  expect(result.reviewCase.case).toEqual({kind:"keyless_none",selectorOutcome:"no_unique_candidate",allowedDecisions:["reject","needs-more-information"]});
  expect(result.reviewCase.notice).toEqual({state:"not_applicable",noticeRevision:null});
  expect(JSON.stringify(result)).not.toMatch(/ciphertext|wrapped|profileId|subjectId|embryoId|candidateCount|ownerAccountId|Hmac|outboxId|assignmentRevision/u);
  return result;
}

/** Both actual pages must be rendered before a distinct human-read control
 * exists. Software fixture attestations are not a human-review credit. */
export async function openSyntheticReviewPdf(page:Page,kind:"photo"|"birth"){
  const label=kind==="photo"?"Picture ID":"Birth record",title=kind==="photo"?"Photo identity document":"Birth record";
  const section=page.getByRole("heading",{name:label,exact:true}).locator("..");
  await section.getByRole("button",{name:`Open ${label}`,exact:true}).click();
  await expect(section.getByRole("img",{name:`${title}, page 1`,exact:true})).toBeVisible();
  await expect(section.getByRole("status")).toHaveText("Page 1 of 2");
  await expect(section.getByRole("checkbox")).toHaveCount(0);
  const pixel=()=>section.getByRole("img").evaluate(element=>{
    const canvas=element as HTMLCanvasElement;return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(canvas.width*.25),Math.floor(canvas.height*.85),1,1).data);
  });
  await expect.poll(pixel,{message:"the real local PDF renderer displays this synthetic first page"}).toEqual([255,0,0,255]);
  await section.getByRole("button",{name:"Go on",exact:true}).click();
  await expect(section.getByRole("img",{name:`${title}, page 2`,exact:true})).toBeVisible();
  await expect(section.getByRole("status")).toHaveText("Page 2 of 2");
  await expect.poll(pixel,{message:"the full second page is actually rendered before attestation"}).toEqual([0,0,255,255]);
  await expect(section.getByRole("checkbox")).not.toBeChecked();
  await section.getByRole("checkbox").check();
}
