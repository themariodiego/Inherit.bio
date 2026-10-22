import type {Page} from "@playwright/test";
import {expect} from "../audited-test";
import {CLAIMANT_DELETE_CONTROL} from "../fixtures/claimant-record-page-text";
import {reviewFixtureSql} from "./claim-review-fixture";
import {keylessSourceProof} from "./keyless-positive-journey";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH=/^[0-9a-f]{64}$/u;
function scope(value:string,shape:RegExp){if(!shape.test(value))throw new Error("Invalid synthetic claimed-record scope");return value;}

export type ClaimedRecordProof={digest:string;source:string;lifecycle:string;deletionPlans:number;untilRequestRows:number;
  liveRightsView:boolean;activeSessions:number};

/** Metadata-only proof of what a claimant delete would remove or keep: the
 * claimed subject and embryo rows, the claim, its claimant principal, identity
 * HMACs and Recovery Key hash, the custody slices, every retention row, due
 * phase and purge manifest on the subject or the claimant, the rights sessions
 * on the subject, the sibling embryo and the cohort's canonical source. Rows
 * are hashed in the database; no key, contact, document or DNA leaves it. */
export async function claimedRecordProof(input:{subjectId:string;claimId:string;cohortId:string;siblingId:string;
  sessionHash:string}):Promise<ClaimedRecordProof>{
  const subject=scope(input.subjectId,UUID),claim=scope(input.claimId,UUID),sibling=scope(input.siblingId,UUID);
  const session=scope(input.sessionHash,HASH);
  const targets=`(select '${subject}'::uuid union all select cp.id from public.future_person_claimant_principals cp where cp.claim_id='${claim}')`;
  const rows=(relation:string,where:string)=>`(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from ${relation} x where ${where})`;
  const value=JSON.parse(await reviewFixtureSql(`with proof as(select jsonb_build_object(
    'subject',${rows("public.subjects","x.id='"+subject+"'")},
    'embryo',${rows("public.embryos","x.subject_id='"+subject+"'")},
    'sibling',${rows("public.embryos","x.id='"+sibling+"'")},
    'claim',${rows("public.future_person_claims","x.id='"+claim+"'")},
    'claimants',${rows("public.future_person_claimant_principals","x.claim_id='"+claim+"'")},
    'identity',${rows("public.future_person_claimant_identity_hmacs","x.claimant_principal_id in(select id from public.future_person_claimant_principals where claim_id='"+claim+"')")},
    'recovery',${rows("public.future_person_recovery_key_hashes","x.claimant_principal_id in(select id from public.future_person_claimant_principals where claim_id='"+claim+"')")},
    'custody',${rows("private.future_person_custody_slices","x.subject_id='"+subject+"'")},
    'retention',${rows("public.retention_rows",`x.target_id in${targets}`)},
    'phases',${rows("public.retention_due_phases",`x.retention_row_id in(select id from public.retention_rows where target_id in${targets})`)},
    'manifests',${rows("public.purge_manifests",`x.retention_row_id in(select id from public.retention_rows where target_id in${targets})`)},
    'sessions',${rows("public.rights_sessions","x.target_id='"+subject+"'")}) value)
    select jsonb_build_object('digest',encode(extensions.digest(convert_to(value::text,'UTF8'),'sha256'),'hex'),
      'lifecycle',(select lifecycle from public.subjects where id='${subject}'),
      'deletionPlans',(select count(*) from public.purge_manifests m join public.retention_rows r on r.id=m.retention_row_id
        where r.target_id='${subject}' and r.retention_id='future-person.claimant-reverification-until-request'),
      'untilRequestRows',(select count(*) from public.retention_rows where target_id='${subject}'
        and retention_id='future-person.claimant-reverification-until-request'),
      'liveRightsView',public.future_person_rights_view_v1('${session}') is not null,
      'activeSessions',(select count(*) from public.rights_sessions where session_hash='${session}' and target_id='${subject}' and status='active'))
    from proof`)) as Omit<ClaimedRecordProof,"source">;
  const source=await keylessSourceProof(input.cohortId);
  expect(value.digest).toMatch(HASH);expect(source).toMatch(HASH);
  return {...value,source};
}

/** Step 5 on the standard app. The TEST claimant deletion executor needs a
 * direct superuser database connection, which the isolated CI runtime blocks
 * by design (owner decision 2026-10-22, "How G5.4's claimant delete is
 * proven"). So this app offers no delete control, mints no delete nonce, and
 * the registered DELETE answers the closed 404 to the page's own CSRF. This
 * proves the closed door only; the working DELETE is proven by
 * supabase/tests/future_person_claimant_erasure_completion.sql and
 * src/lib/future-person/claimant-deletion-route.test.ts. A later runtime that
 * admits the executor replaces this one call, and steps 1-4 stay as they are. */
export async function proveClaimantDeleteClosed(page:Page,input:{csrf:string;proof:()=>Promise<ClaimedRecordProof>}):Promise<ClaimedRecordProof>{
  expect(input.csrf,"the page's own claimant CSRF, taken from its real request").toMatch(HASH);
  await expect(page.getByRole("group",{name:CLAIMANT_DELETE_CONTROL.legend,exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:CLAIMANT_DELETE_CONTROL.button,exact:true})).toHaveCount(0);
  for(const text of [CLAIMANT_DELETE_CONTROL.warning,CLAIMANT_DELETE_CONTROL.acknowledgement])
    await expect(page.getByText(text,{exact:true})).toHaveCount(0);
  const before=await input.proof();
  expect({lifecycle:before.lifecycle,deletionPlans:before.deletionPlans,untilRequestRows:before.untilRequestRows,
    liveRightsView:before.liveRightsView,activeSessions:before.activeSessions},"the claimed record is live and no deletion was ever requested")
    .toEqual({lifecycle:"claimed_unbound",deletionPlans:0,untilRequestRows:0,liveRightsView:true,activeSessions:1});
  const response=await page.evaluate(async csrf=>{
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20_000);
    try{
      const reply=await fetch("/api/future-person/claim/session",{method:"DELETE",credentials:"same-origin",cache:"no-store",
        signal:abort.signal,headers:{"X-Inherit-CSRF":csrf}});
      const text=await reply.text();if(text.length>1024)throw new Error("Unexpected native response size");
      return {status:reply.status,text,cache:reply.headers.get("cache-control"),referrer:reply.headers.get("referrer-policy")};
    }finally{clearTimeout(timer);abort.abort();}
  },input.csrf);
  expect(response,"the registered claimant DELETE is the closed 404 on this app").toEqual({status:404,
    text:JSON.stringify({error:"not_found"}),cache:"private, no-store",referrer:"no-referrer"});
  const after=await input.proof();
  expect(after,"nothing the delete would remove has changed, and the sibling and canonical source are untouched").toEqual(before);
  return after;
}
