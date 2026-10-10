import {createHash} from "node:crypto";
import type {APIRequestContext,Page} from "@playwright/test";
import {expect} from "../audited-test";
import {reviewFixtureSql} from "./claim-review-fixture";
import {reviewId} from "./keyless-review-journey";
import {observeNativeResponses} from "./native-response-observer";
import {syntheticDeliveredCallback} from "../fixtures/synthetic-notice-callback";
export {syntheticDeliveredCallback} from "../fixtures/synthetic-notice-callback";

/** Only immutable metadata is hashed. Source bytes, names, keys and tokens
 * never enter a test attachment or log. SQL does not create any authority. */
export async function keylessSourceProof(cohortId:string){
  return reviewFixtureSql(`select encode(extensions.digest(convert_to(jsonb_build_object(
    'sources',(select jsonb_agg(to_jsonb(s) order by s.file_id) from private.embryo_canonical_sources s where s.cohort_id='${reviewId(cohortId)}'),
    'memberships',(select jsonb_agg(to_jsonb(m) order by m.file_id,m.sequence) from private.embryo_canonical_source_parts m
      join private.embryo_canonical_sources s on s.file_id=m.file_id where s.cohort_id='${cohortId}'),
    'parts',(select jsonb_agg(to_jsonb(p) order by p.id) from private.embryo_canonical_parts p where p.id in
      (select m.part_id from private.embryo_canonical_source_parts m join private.embryo_canonical_sources s on s.file_id=m.file_id where s.cohort_id='${cohortId}')),
    'signatures',(select jsonb_agg(to_jsonb(cs) order by cs.id) from public.consent_signatures cs join public.embryo_cohorts c
      on cs.target_kind='cohort_draft' and cs.target_id=c.draft_id where c.id='${cohortId}'),
    'attestations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.attestations a join public.embryo_cohorts c
      on a.target_kind='cohort_draft' and a.target_id=c.draft_id where c.id='${cohortId}'),
    'basis',(select to_jsonb(b) from public.embryo_basis_bindings b where b.cohort_id='${cohortId}')
    )::text,'UTF8'),'sha256'),'hex')`);
}

/** Exact current two-parent membership, read after genuine native signing. */
export async function otherCurrentParent(cohortId:string,owner:string){
  const rows=JSON.parse(await reviewFixtureSql(`select coalesce(jsonb_agg(distinct p.account_id),'[]')
    from public.embryo_participant_sets m join public.subject_principals p on p.id=m.principal_id
    where m.cohort_id='${reviewId(cohortId)}' and m.set_kind='disposition_authorities'
      and m.revoked_at is null and p.status='active' and p.account_id is not null and p.account_id<>'${reviewId(owner)}'`)) as unknown;
  expect(Array.isArray(rows)&&rows.length===1,"the actual published pair has exactly one other current account").toBe(true);
  return reviewId((rows as string[])[0]);
}

/** The actual parent uses the registered rights control independently of
 * embryo.analysis. Its proof/nonce and current signature come from the page. */
export async function saveNativeMatchingDetails(page:Page,embryo:string,identity:{dateOfBirth:string;placeOfBirth:string;parentNames:string[]},closingDate:string){
  await page.goto("/settings/data");
  const form=page.locator(`[data-slot="future-person-profile-control"][data-embryo-id="${reviewId(embryo)}"]`);
  await expect(form).toBeVisible();
  for(const name of ["Child birth date","Where the child was born","Parent name"])await expect(form.getByLabel(name,{exact:true})).toHaveValue("");
  await form.getByLabel("Child birth date",{exact:true}).fill(identity.dateOfBirth);
  await form.getByLabel("Where the child was born",{exact:true}).fill(identity.placeOfBirth);
  await form.getByLabel("Parent name",{exact:true}).fill(identity.parentNames.join("\n"));
  const observed=await observeNativeResponses(page,{save:`^/api/embryos/${embryo}/future-person-identity$`},"PUT");
  try{
    await form.getByRole("button",{name:"Save details",exact:true}).click();
    const result=await observed.read("save");expect(result.status).toBe(200);
    const body=JSON.parse(result.text);expect(Object.keys(body).sort()).toEqual(["expiresAt","status"]);
    expect(body.status).toBe("saved");expect(Date.parse(body.expiresAt)).toBe(Date.parse(closingDate));
    await expect(form.getByRole("button",{name:"Delete details",exact:true})).toBeVisible();
    for(const name of ["Child birth date","Where the child was born","Parent name"])await expect(form.getByLabel(name,{exact:true})).toHaveValue("");
  }finally{await observed.dispose();}
  expect(await reviewFixtureSql(`select count(*)||'/'||bool_and(fi.state='current' and fi.profile_format_version=1
    and octet_length(fi.wrapped_profile_key)=72 and octet_length(fi.parent_supplied_ciphertext)>28
    and (select array_agg(k::bigint order by k::bigint) from jsonb_object_keys(fi.match_indexes) k)=private.hmac_lookup_revisions_v1('contact'))
    from public.future_person_identity fi where fi.embryo_id='${embryo}'`)).toBe("1/true");
}

/** Bind software document receipt proof to both actual immutable SHA values,
 * current assignment and reviewer. A partial/canceled read cannot match. */
export async function expectFullDocumentReceipts(claim:string,reviewer:string,bytes:{photo:Buffer;birth:Buffer}){
  const photo=createHash("sha256").update(bytes.photo).digest("hex"),birth=createHash("sha256").update(bytes.birth).digest("hex");
  expect(await reviewFixtureSql(`select count(*)||'/'||count(distinct r.document_id)||'/'||bool_and(r.delivery_verified_at is not null
    and r.document_sha256=d.sha256 and r.assignment_revision=a.assignment_revision
    and r.reviewer_account_id='${reviewId(reviewer)}' and d.sha256=case when r.document_id=c.photo_document_id then '${photo}' else '${birth}' end
    and r.review_revision=c.review_revision and r.account_auth_session_revision=p.auth_session_revision
    and r.originating_session_revision=coalesce(s.refresh_token_counter,0)+1
    and r.chunk_sequence=0 and ceil(d.byte_count/4000000.0)=1
    and d.byte_count=case when r.document_id=c.photo_document_id then ${bytes.photo.length} else ${bytes.birth.length} end)
    from private.claim_review_reads r join private.claim_documents d on d.id=r.document_id
    join private.claim_reviews c on c.id=r.review_id
    join private.claim_review_assignments a on a.review_id=c.id and a.status='current' and a.reviewer_account_id=r.reviewer_account_id
    join public.profiles p on p.id=r.reviewer_account_id
    join auth.sessions s on s.id=r.auth_session_id and s.user_id=r.reviewer_account_id
    where r.review_id='${reviewId(claim)}' and r.document_id in(c.photo_document_id,c.birth_record_document_id)
      and r.reviewer_account_id='${reviewer}' and r.assignment_revision=a.assignment_revision`)).toBe("2/2/true");
}

/** A signed callback to the unchanged real HTTP handler, using the accepted
 * ID returned by the local synthetic provider. This is explicitly software
 * provider evidence, not real provider delivery or elapsed owner time. */
export async function sendSyntheticDeliveredCallback(request:APIRequestContext,callback:ReturnType<typeof syntheticDeliveredCallback>){
  const response=await request.post("/api/webhooks/resend",{headers:callback.headers,data:callback.payload});
  expect(response.status()).toBe(204);expect(await response.body()).toHaveLength(0);
}
