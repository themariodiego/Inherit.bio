import {spawn} from "node:child_process";
import type {Page,Route} from "@playwright/test";
import {z} from "zod";
import {expect} from "../audited-test";
import config from "../../playwright.config";
import {localE2eProject} from "../../scripts/local-e2e-project";
import {reviewFixtureSql} from "./claim-review-fixture";

const UUID=z.uuid();
const receipt=z.object({evidence:z.literal("time-compressed-synthetic-owner-producer"),
  recordedAt:z.iso.datetime({offset:true}),effectiveAt:z.iso.datetime({offset:true}),
  documentaryBirth:z.iso.date(),closingDate:z.iso.datetime({offset:true})}).strict();
const metadata=z.object({full:z.string().regex(/^[a-f0-9]{64}$/u),immutable:z.string().regex(/^[a-f0-9]{64}$/u),
  nonces:z.number().int().nonnegative(),proposals:z.number().int().nonnegative()}).strict();
function id(value:string){if(!UUID.safeParse(value).success)throw new Error("Historical fixture unavailable");return value;}

/** Stateless hashes of current source, signed history and complete operation
 * effects. No raw key, document, token or personal field enters a receipt. */
async function proof(embryo:string){
  const value=await reviewFixtureSql(`with current_proof as(select jsonb_build_object(
    'embryo',to_jsonb(e),'subject',to_jsonb(s),'cohort',to_jsonb(c),
    'proposals',(select jsonb_agg(to_jsonb(p) order by p.id) from public.embryo_disposition_proposals p where p.embryo_id=e.id),
    'nonces',(select jsonb_agg(to_jsonb(n) order by n.nonce_hash) from public.embryo_operation_nonces n where n.target_kind='embryo' and n.target_id=e.id),
    'mail',(select jsonb_agg(to_jsonb(m) order by m.id) from public.mail_outbox m where m.target_id=e.subject_id),
    'sources',(select jsonb_agg(to_jsonb(x) order by x.file_id) from private.embryo_canonical_sources x where x.cohort_id=c.id),
    'memberships',(select jsonb_agg(to_jsonb(m) order by m.file_id,m.part_id) from private.embryo_canonical_source_parts m
      join private.embryo_canonical_sources x on x.file_id=m.file_id where x.cohort_id=c.id),
    'parts',(select jsonb_agg(to_jsonb(p) order by p.id) from private.embryo_canonical_parts p where p.id in
      (select m.part_id from private.embryo_canonical_source_parts m join private.embryo_canonical_sources x on x.file_id=m.file_id where x.cohort_id=c.id)),
    'signatures',(select jsonb_agg(to_jsonb(cs) order by cs.id) from public.consent_signatures cs where cs.target_kind='cohort_draft' and cs.target_id=c.draft_id),
    'basis',(select to_jsonb(b) from public.embryo_basis_bindings b where b.cohort_id=c.id),
    'attestations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.attestations a where a.target_kind='cohort_draft' and a.target_id=c.draft_id)
    ) value from public.embryos e join public.subjects s on s.id=e.subject_id
      join public.embryo_cohorts c on c.id=e.cohort_id where e.id='${id(embryo)}'::uuid)
    select jsonb_build_object('full',encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex'),
      'immutable',encode(extensions.digest(convert_to((value-array['embryo','subject','cohort','proposals','nonces','mail'])::text,'UTF8'),'sha256'),'hex'),
      'nonces',jsonb_array_length(coalesce(nullif(value->'nonces','null'),'[]')),
      'proposals',jsonb_array_length(coalesce(nullif(value->'proposals','null'),'[]'))) from current_proof`);
  return metadata.parse(JSON.parse(value));
}

/** Capture genuine issuance only. The actual product composes its own request;
 * it is aborted before dispatch, never rewritten or given a fake response. */
async function issuedToken(page:Page,embryo:string):Promise<string>{
  const origin=new URL(page.url()).origin,path=`/api/embryos/${id(embryo)}/disposition`;
  const pattern=(url:URL)=>url.origin===origin&&url.pathname===path;
  let matches=0,token:string|null=null;
  const handler=async(route:Route)=>{
    const request=route.request();
    if(request.method()!=="POST"){await route.continue();return;}
    matches++;
    try{
      const data=JSON.parse(request.postData()??"") as Record<string,unknown>;
      if(Object.keys(data).sort().join(",")!=="action,disposition,nonce"||data.action!=="propose"
        ||data.disposition!=="transferred"||typeof data.nonce!=="string"||data.nonce.length>4096)
        throw new Error("Historical fixture unavailable");
      token=data.nonce;
    }catch{token=null;}
    await route.abort("aborted");
  };
  await page.route(pattern,handler);
  try{
    const control=page.locator(`[data-slot="embryo-disposition-control"][data-embryo-id="${embryo}"]`);
    await expect(control).toBeVisible();
    await control.getByLabel("Status",{exact:true}).selectOption("transferred");
    await control.getByRole("button",{name:"Record change",exact:true}).click();
    await expect(control.getByRole("status")).toHaveText("We could not confirm the change. Refresh this page and check the record.");
    if(matches!==1||token===null)throw new Error("Historical fixture unavailable");
    return token;
  }finally{await page.unroute(pattern,handler);}
}

/** Current native issuance plus a labeled owner-only historical producer.
 * This is not a native second-parent confirmation, old signing, actual elapsed
 * years, provider delivery, human review or approval of a thirty-day release.
 * No existing journey, default document, timeout or retry is changed. */
export async function syntheticHistoricalTransfer(input:{embryoId:string;parents:readonly[
  {page:Page;accountId:string},{page:Page;accountId:string}]}):Promise<z.infer<typeof receipt>>{
  localE2eProject(process.env);
  const embryo=id(input.embryoId),[one,two]=input.parents;
  id(one.accountId);id(two.accountId);
  if(one.accountId===two.accountId||one.page===two.page)throw new Error("Historical fixture unavailable");
  await one.page.goto("/settings/data");await two.page.goto("/settings/data");
  const origin=new URL(one.page.url()).origin;
  if(new URL(two.page.url()).origin!==origin)throw new Error("Historical fixture unavailable");
  const servers=Array.isArray(config.webServer)?config.webServer:[config.webServer];
  const server=servers.find(value=>value?.env?.NEXT_PUBLIC_SITE_URL===origin);
  if(!server?.env||server.env.INHERIT_TEST_JURISDICTION!=="1"||!server.env.BYOK_ENCRYPTION_KEY)
    throw new Error("Historical fixture unavailable");
  const before=await proof(embryo);
  const parents=[{accountId:one.accountId,token:await issuedToken(one.page,embryo)},
    {accountId:two.accountId,token:await issuedToken(two.page,embryo)}];
  expect(await proof(embryo),"both aborted native requests leave every captured operation/source/signature effect unchanged").toEqual(before);
  const output=await new Promise<string>((resolve,reject)=>{
    const child=spawn(process.execPath,["--conditions=react-server","--import","./scripts/server-only-shim.mjs","--import","tsx",
      "scripts/tools/historical-embryo-transfer.run.mts"],{stdio:["pipe","pipe","pipe"],
      env:{...process.env,...server.env,NODE_ENV:"test"}});
    let text="",diagnostic=false;
    const refuse=()=>{clearTimeout(timer);child.kill("SIGTERM");reject(new Error("Historical fixture unavailable"));};
    const timer=setTimeout(refuse,25_000);
    child.stdout.on("data",bytes=>{text+=String(bytes);if(text.length>4096)refuse();});
    child.stderr.on("data",()=>{diagnostic=true;});child.once("error",refuse);child.stdin.once("error",refuse);
    child.once("close",code=>{clearTimeout(timer);if(code!==0||diagnostic)refuse();else resolve(text.trim());});
    child.stdin.end(JSON.stringify({embryoId:embryo,parents}));
  });
  const result=receipt.parse(JSON.parse(output));
  expect(Date.parse(result.effectiveAt)<Date.parse(result.recordedAt),"synthetic effective and actual recording clocks are explicit").toBe(true);
  expect(Date.parse(result.closingDate)>Date.parse(result.recordedAt),"the actual producer leaves the registered claim window open").toBe(true);
  const after=await proof(embryo);
  expect(after.full===before.full,"the actual owner producer made the bounded historical event").toBe(false);
  expect(after.immutable,"the canonical source, basis and signed parent history remain byte-identical").toBe(before.immutable);
  expect(after.nonces,"the two actual current scopes are each consumed exactly once").toBe(before.nonces+2);
  expect(after.proposals,"the genuine first parent created exactly one proposal").toBe(before.proposals+1);
  return result;
}
