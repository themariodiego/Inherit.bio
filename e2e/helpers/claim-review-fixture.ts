import {execFile} from "node:child_process";
import {createHash,createHmac,randomBytes} from "node:crypto";
import {promisify} from "node:util";
import {deflateSync} from "node:zlib";
import {createServerClient} from "@supabase/ssr";
import type {BrowserContext,Page} from "@playwright/test";
import config from "../../playwright.config";
import {localE2eProject} from "../../scripts/local-e2e-project";
import {expect} from "../audited-test";
import {ANON_KEY,SUPABASE_URL,anonClient,createConfirmedUser} from "../helpers";
import {observeNativeResponses} from "./native-response-observer";

const run=promisify(execFile);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const reviewerPassword=()=>randomBytes(24).toString("base64url");

/** Owner-only local fixture operations; never a new API grant or an Auth JWT edit. */
export async function reviewFixtureSql(query:string):Promise<string> {
  return (await run("docker",["exec",localE2eProject(process.env).dbContainer,"psql","-U","postgres","-d","postgres",
    "-XAt","--set=ON_ERROR_STOP=1","--command",query],{timeout:15_000,maxBuffer:65_536})).stdout.trim();
}

function totp(secret:string):string {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits=0,value=0;const bytes:number[]=[];
  for(const character of secret.replace(/=+$/u,"").toUpperCase()) {
    const part=alphabet.indexOf(character);if(part<0)throw new Error("Invalid local authenticator encoding");
    value=(value<<5)|part;bits+=5;
    if(bits>=8){bits-=8;bytes.push((value>>>bits)&255);}
  }
  const key=Buffer.from(bytes);const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));
  try {
    const mac=createHmac("sha1",key).update(counter).digest();
    const offset=mac.at(-1)!&15;
    return String((mac.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,"0");
  } finally {key.fill(0);counter.fill(0);}
}

/** Auth itself issues and verifies a recent aal2 TOTP session; SSR itself makes its cookies. */
export async function signInReviewer(context:BrowserContext,baseURL:string):Promise<string> {
  const email=`claim-reviewer-${randomBytes(8).toString("hex")}@e2e.local`;
  const password=reviewerPassword();const id=await createConfirmedUser(email,password);
  const auth=anonClient();
  const signed=await auth.auth.signInWithPassword({email,password});
  expect(Boolean(signed.error),"real reviewer password authentication succeeds").toBe(false);
  const factor=await auth.auth.mfa.enroll({factorType:"totp"});
  if(factor.error||factor.data.type!=="totp")throw new Error("Real reviewer TOTP enrollment failed");
  const verified=await auth.auth.mfa.challengeAndVerify({factorId:factor.data.id,code:totp(factor.data.totp.secret)});
  if(verified.error)throw new Error("Real reviewer TOTP challenge failed");
  const claims=JSON.parse(Buffer.from(verified.data.access_token.split(".")[1]!,"base64url").toString("utf8")) as
    {aal?:string;amr?:Array<{method?:string}>};
  expect(claims.aal,"Auth issued actual stepped-up authority").toBe("aal2");
  expect(claims.amr?.some(entry=>entry.method==="totp"),"Auth recorded the real TOTP check").toBe(true);
  const jar=new Map<string,{name:string;value:string}>();
  const ssr=createServerClient(SUPABASE_URL,ANON_KEY,{cookies:{
    getAll:()=>[...jar.values()],setAll:values=>{for(const value of values)jar.set(value.name,{name:value.name,value:value.value});},
  }});
  const session=await ssr.auth.setSession({access_token:verified.data.access_token,refresh_token:verified.data.refresh_token});
  expect(Boolean(session.error),"SDK accepts the real Auth session").toBe(false);
  if(!jar.size)throw new Error("The Auth SDK emitted no local session cookie");
  await context.addCookies([...jar.values()].filter(cookie=>cookie.value).map(cookie=>({...cookie,url:baseURL,sameSite:"Lax" as const})));
  expect(UUID.test(id),"the reviewer has a real account UUID").toBe(true);
  return id;
}

function crc32(bytes:Buffer):number {
  let value=0xffffffff;
  for(const byte of bytes){value^=byte;for(let n=0;n<8;n++)value=(value>>>1)^((value&1)?0xedb88320:0);}
  return (value^0xffffffff)>>>0;
}
function pngChunk(kind:string,bytes:Buffer):Buffer {
  const type=Buffer.from(kind,"ascii");const length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([type,bytes])));
  return Buffer.concat([length,type,bytes,crc]);
}
/** Valid, distinct synthetic pictures. The first has a real ancillary chunk so delivery spans two chunks. */
export function reviewPicture(width:number,height:number,twoChunks=false):Buffer {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc(height*(1+width*3));
  for(let row=0;row<height;row++)for(let column=0;column<width;column++)rows[row*(1+width*3)+1+column*3]=180;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),
    pngChunk("IDAT",deflateSync(rows)),...(twoChunks?[pngChunk("tEXt",Buffer.concat([Buffer.from("Synthetic fixture\0"),Buffer.alloc(4_000_020,120)]))]:[]),pngChunk("IEND",Buffer.alloc(0))]);
}

async function scanUntilSessionClean(session:string):Promise<void> {
  if(!UUID.test(session))throw new Error("Malformed local evidence session");
  const servers=Array.isArray(config.webServer)?config.webServer:[config.webServer];
  // The registered non-production TEST-LOCAL scanner scans the actual opened
  // Storage bytes. No clean row, JWT claim, guard or queue is edited by the fixture.
  for(let pass=0;pass<16;pass++) {
    const state=await reviewFixtureSql(`select state from private.claim_documents where session_id='${session}'::uuid`);
    if(state==="clean")return;
    expect(state,"the genuine compose door entered quarantine").toBe("quarantined");
    const result=await run(process.execPath,["--conditions=react-server","--import","./scripts/server-only-shim.mjs","--import","tsx",
      "scripts/claim-document-scan-worker.run.mts","--once"],{timeout:15_000,maxBuffer:65_536,
      env:{...process.env,...servers[0]?.env,NODE_ENV:"test",VERCEL_ENV:"development",INHERIT_TEST_JURISDICTION:"1",INHERIT_CLAMD_ADDRESS:"test-double"}});
    expect(result.stderr,"scan worker exposes no diagnostics or plaintext").toBe("");
    expect(result.stdout.trim(),"bounded real worker returned a coded outcome").toMatch(/^claim_document_scan_(clean|idle|refused|retry|failed)$/u);
  }
  throw new Error("The genuine bounded scan worker did not reach this document");
}

/** Real claimant start, rotation, encrypted chunk upload, composition, scan and completion. */
export async function createReviewCase(page:Page,context:BrowserContext):Promise<string> {
  const block=randomBytes(4).toString("hex");
  await context.setExtraHTTPHeaders({"x-real-ip":`2001:db8:${block.slice(0,4)}:${block.slice(4)}::1`});
  await page.goto("/future-person/claim");const form=page.locator("main form");
  await form.getByRole("radio",{name:"I have no key",exact:true}).check();
  await form.getByLabel("Your full name").fill("Synthetic Claimant");
  await form.getByLabel("Your date of birth").fill("2000-01-31");
  await form.getByLabel("Where you were born").fill("Synthetic Town");
  await form.getByLabel("The name of each parent").fill("Synthetic Parent One\nSynthetic Parent Two");
  await form.getByLabel("Your email address").fill(`review-claim-${randomBytes(8).toString("hex")}@e2e.local`);
  await form.getByRole("checkbox").check();
  const started=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/future-person/claim"&&response.request().method()==="POST");
  await form.getByRole("button",{name:"Start my claim",exact:true}).click();expect((await started).status()).toBe(202);
  const documents=page.getByRole("region",{name:"Send your files"});await expect(documents).toBeVisible();
  for(const [ordinal,label,picture] of [[0,"Picture ID",reviewPicture(3,2,true)],[1,"Birth record",reviewPicture(2,3)]] as const) {
    await documents.getByLabel(label,{exact:true}).setInputFiles({name:`synthetic-${ordinal}.png`,mimeType:"image/png",buffer:picture});
    const observer=await observeNativeResponses(page,{session:"^/api/future-person/claim/session/documents$"});
    try {
      const quarantined=page.waitForResponse(response=>/^\/api\/evidence\/[^/]+\/complete$/u.test(new URL(response.url()).pathname)&&response.status()===202);
      await documents.getByRole("button",{name:"Send this file",exact:true}).nth(ordinal).click();
      const opened=await observer.read("session");expect(opened.status).toBe(201);
      const value=JSON.parse(opened.text) as {session:string};expect(UUID.test(value.session)).toBe(true);
      expect((await quarantined).status()).toBe(202);
      await scanUntilSessionClean(value.session);
      await expect(documents.getByRole("status").filter({hasText:"We have this file. A person will review it."})).toHaveCount(ordinal+1);
    } finally {await observer.dispose();}
  }
  await documents.getByRole("checkbox").check();
  const finished=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/future-person/claim/session/complete"&&response.request().method()==="POST");
  await documents.getByRole("button",{name:"Send my claim",exact:true}).click();expect((await finished).status()).toBe(202);
  await expect(page.getByRole("heading",{name:"We have your claim",exact:true})).toBeVisible();
  const cookie=(await context.cookies()).filter(cookie=>/^(__Host-)?inherit-claim$/u.test(cookie.name));
  expect(cookie.length).toBe(1);
  const digest=createHash("sha256").update(cookie[0]!.value).digest("hex");
  const id=await reviewFixtureSql(`select r.id from private.claim_reviews r join private.future_person_claim_intakes i on i.id=r.id
    where i.session_hash='${digest}' and r.mode='keyless' and r.case_kind='keyless_none' and r.state='document_review_pending'`);
  expect(UUID.test(id),"the actual completed claim has one pending case").toBe(true);
  return id;
}
