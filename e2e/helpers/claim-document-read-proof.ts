import {spawn} from "node:child_process";
import {createServerClient} from "@supabase/ssr";
import type {BrowserContext} from "@playwright/test";
import {z} from "zod";
import {ANON_KEY,SUPABASE_URL} from "../helpers";
import {localE2eProject} from "../../scripts/local-e2e-project";
import {claimDocumentReadProofSql} from "./claim-document-read-proof-sql";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const proof=z.object({authCurrent:z.boolean(),documentCurrent:z.boolean(),receiptsCurrent:z.boolean(),
  deliveredChunks:z.number().int().nonnegative(),expectedChunks:z.number().int().positive(),fullyRead:z.enum(["t","f"])}).strict();

/** Quiet owner metadata only. Claims arrive unchanged from Auth's verified SDK;
 * stdin keeps them out of process arguments and every failure is a fixed code. */
async function ownerRead(query:string,claims:object):Promise<string> {
  const json=JSON.stringify(claims).replaceAll("'","''");
  const input=`begin read only; set local statement_timeout='15s'; set local lock_timeout='2s';
    set local request.jwt.claims='${json}';\n${query};\nrollback;\n`;
  return new Promise((resolve,reject)=>{
    const child=spawn("docker",["exec","-i",localE2eProject(process.env).dbContainer,"psql","-U","postgres","-d","postgres",
      "-XAtq","--set=ON_ERROR_STOP=1"],{stdio:["pipe","pipe","pipe"]});
    const chunks:Buffer[]=[];let bytes=0,settled=false;
    const finish=(value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);
      if(value===undefined)reject(new Error("Current document read proof unavailable"));else resolve(value);};
    const timer=setTimeout(()=>{child.kill("SIGKILL");finish();},15_000);
    child.stdout.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65_536){child.kill("SIGKILL");finish();}else chunks.push(chunk);});
    child.stderr.on("data",()=>{/* No Auth context, native error text or payload leaves this fixture. */});
    child.on("error",()=>finish());child.stdin.on("error",()=>finish());
    child.on("close",code=>finish(code===0?Buffer.concat(chunks).toString("utf8").trim():undefined));
    child.stdin.end(input);
  });
}

/** Read the real fresh browser cookie with the same SSR SDK used at sign-in.
 * No token is decoded, edited, fabricated, returned or logged by this helper. */
export async function currentClaimDocumentReadProof(context:BrowserContext,review:string,account:string) {
  const query=claimDocumentReadProofSql(review,account),cookies=await context.cookies();
  const auth=createServerClient(SUPABASE_URL,ANON_KEY,{cookies:{getAll:()=>cookies,
    setAll:()=>{throw new Error("Fresh reviewer proof must not rotate browser cookies");}}});
  const verified=await auth.auth.getClaims();
  if(verified.error||!verified.data)throw new Error("Actual reviewer session verification failed");
  const claims=verified.data.claims;
  if(claims.sub!==account||claims.aal!=="aal2"||typeof claims.session_id!=="string"||!UUID.test(claims.session_id)
    ||claims.role!=="authenticated"||!claims.amr?.some(entry=>entry.method==="totp")) {
    throw new Error("Actual reviewer session verification failed");
  }
  return proof.parse(JSON.parse(await ownerRead(query,claims)));
}
