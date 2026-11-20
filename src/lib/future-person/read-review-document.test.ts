import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readReviewDocument } from "./read-review-document";
import { csrfHandle } from "@/lib/security/session-csrf-client";

/**
 * 2026-11-19 (G8.5, the migration stage): the receipt and each acknowledgement carry the page's
 * one-time reviewer tokens for their routes, through their chains; the receipt's answer no longer
 * hands over a receipt digest for the acknowledgements (it handed over "b".repeat(64), which
 * every acknowledgement carried).
 */
const token=(n:number)=>`${1_800_000_000_000+n}.${"T".repeat(42)}${n}.${"0".repeat(63)}${n}`;
const ID="7e000000-0000-4000-8000-000000000001";
const SESSION="7e000000-0000-4000-8000-000000000002";
const bytes=Uint8Array.from({length:4_000_001},(_,index)=>index%251);
const digest=crypto.createHash("sha256").update(bytes).digest("hex");
const challenge="a".repeat(64);
const calls:Array<{url:string;body:unknown;csrf:string|null}>=[];
afterEach(()=>{vi.unstubAllGlobals();calls.length=0;});
function fixture(mode:"complete"|"partial"|"corrupt"|"canceled",controller?:AbortController) {
  vi.stubGlobal("fetch",vi.fn(async(url:string,options?:RequestInit)=>{
    calls.push({url,body:options?.body?JSON.parse(String(options.body)):null,csrf:new Headers(options?.headers).get("x-inherit-csrf")});
    if(url.endsWith("review-download"))return Response.json({session:SESSION,filename:"photo-identity.pdf",sizeBytes:bytes.length,sha256:digest,chunkBytes:4_000_000,chunkCount:2,chunkRoute:`/api/downloads/${SESSION}/chunks/{sequence}`});
    if(url.endsWith("/receipt"))return Response.json({session:SESSION,chunks:[0,1].map(sequence=>({sequence,challenge,nonce:`synthetic-${sequence}`}))},{status:201,headers:{"x-inherit-csrf":token(9)}});
    if(url.endsWith("0/acknowledge"))return new Response(null,{status:204,headers:{"x-inherit-csrf":token(8)}});
    if(url.endsWith("acknowledge"))return new Response(null,{status:204});
    const sequence=Number(url.split("/").at(-1));
    const part=bytes.slice(sequence*4_000_000,(sequence+1)*4_000_000);
    if(mode==="corrupt"&&sequence===1)part[0]^=1;
    if(mode==="canceled"&&sequence===0)controller!.abort();
    const sent=mode==="partial"&&sequence===0?part.subarray(0,-1):part;
    return new Response(sent,{headers:{"content-type":"application/octet-stream","content-encoding":"identity","content-length":String(part.length)}});
  }));
}
describe("browser document receipt requires complete client delivery",()=>{
  it("acknowledges both exact chunks only after the whole digest matches",async()=>{
    fixture("complete");
    const receipt=token(1),acknowledge=token(2);
    const result=await readReviewDocument(ID,"page-nonce",csrfHandle(receipt),csrfHandle(acknowledge));
    expect(result.filename).toBe("photo-identity.pdf");
    expect(result.bytes.length).toBe(bytes.length);
    expect(crypto.createHash("sha256").update(result.bytes).digest("hex")).toBe(digest);
    expect(calls.map(call=>call.url)).toEqual([
      `/api/legal-evidence/${ID}/review-download`,`/api/downloads/${SESSION}/receipt`,
      `/api/downloads/${SESSION}/chunks/0`,`/api/downloads/${SESSION}/chunks/1`,
      `/api/downloads/${SESSION}/chunks/0/acknowledge`,`/api/downloads/${SESSION}/chunks/1/acknowledge`,
    ]);
    for(let sequence=0;sequence<2;sequence++)expect(calls[4+sequence]!.body).toEqual({
      proof:crypto.createHash("sha256").update(Buffer.from(challenge,"hex")).update(bytes.subarray(sequence*4_000_000,(sequence+1)*4_000_000)).digest("hex"),nonce:`synthetic-${sequence}`,
    });
    // The receipt carries its route's token; the first acknowledgement the acknowledgement route's,
    // and the second the successor the first answer issued. No request carries the receipt's successor.
    expect(calls.map(call=>call.csrf)).toEqual([null,receipt,null,null,acknowledge,token(8)]);
    result.bytes.fill(0);
  });
  it.each(["partial","corrupt"] as const)("%s delivery never sends an acknowledgement",async(mode)=>{
    fixture(mode);
    await expect(readReviewDocument(ID,"page-nonce",csrfHandle(token(3)),csrfHandle(token(4)))).rejects.toThrow();
    expect(calls.filter(call=>call.url.endsWith("acknowledge"))).toEqual([]);
  });
  it("a canceled response cannot settle either document chunk",async()=>{
    const controller=new AbortController();fixture("canceled",controller);
    await expect(readReviewDocument(ID,"page-nonce",csrfHandle(token(5)),csrfHandle(token(6)),controller.signal)).rejects.toThrow("canceled");
    expect(calls.filter(call=>call.url.endsWith("acknowledge"))).toEqual([]);
    expect(calls.filter(call=>call.url.endsWith("/chunks/1"))).toEqual([]);
  });
});
