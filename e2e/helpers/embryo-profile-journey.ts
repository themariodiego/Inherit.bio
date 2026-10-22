import {expect,type Browser,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {adminClient,createConfirmedUser,signIn} from "../helpers";
import {reviewFixtureSql} from "./claim-review-fixture";
import {observeNativeResponses} from "./native-response-observer";
import {readEmbryoDispositionReceipt} from "../../src/lib/embryos/disposition-receipt";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function id(value:string):string{if(!UUID.test(value))throw new Error("Synthetic journey scope must be a UUID");return value;}

/** Metadata hashes only: no document, key, DNA bytes or decrypted name is read.
 * The query is stateless and bound to the original synthetic published cohort. */
async function immutableProof(cohort:string):Promise<string>{
  const c=id(cohort);
  const result=await reviewFixtureSql(`select encode(extensions.digest(convert_to(jsonb_build_object(
    'sources',(select jsonb_agg(to_jsonb(s) order by s.file_id) from private.embryo_canonical_sources s where s.cohort_id='${c}'),
    'memberships',(select jsonb_agg(to_jsonb(m) order by m.file_id,m.part_id) from private.embryo_canonical_source_parts m
      join private.embryo_canonical_sources s on s.file_id=m.file_id where s.cohort_id='${c}'),
    'parts',(select jsonb_agg(to_jsonb(p) order by p.id) from private.embryo_canonical_parts p
      where p.id in(select m.part_id from private.embryo_canonical_source_parts m
        join private.embryo_canonical_sources s on s.file_id=m.file_id where s.cohort_id='${c}')),
    'basis',(select to_jsonb(b) from public.embryo_basis_bindings b where b.cohort_id='${c}'),
    'parentHistory',(select jsonb_agg(to_jsonb(cs) order by cs.id) from public.consent_signatures cs
      join public.embryo_cohorts c on cs.target_kind='cohort_draft' and cs.target_id=c.draft_id where c.id='${c}'),
    'attestations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.attestations a
      join public.embryo_cohorts c on a.target_kind='cohort_draft' and a.target_id=c.draft_id where c.id='${c}')
    )::text,'UTF8'),'sha256'),'hex')`);
  expect(result).toMatch(/^[a-f0-9]{64}$/u);return result;
}
async function nonceCount(embryo:string):Promise<number>{
  return Number(await reviewFixtureSql(`select count(*) from public.embryo_operation_nonces where target_kind='embryo' and target_id='${id(embryo)}'`));
}
async function profileProof(embryo:string):Promise<Record<string,unknown>>{
  return JSON.parse(await reviewFixtureSql(`select jsonb_build_object('rows',count(*),
    'state',max(fi.state),'version',max(fi.profile_format_version),'cipherBytes',max(octet_length(fi.parent_supplied_ciphertext)),
    'wrappedBytes',max(octet_length(fi.wrapped_profile_key)),
    'indexesExact',bool_and((select array_agg(key::bigint order by key::bigint) from jsonb_object_keys(fi.match_indexes) key)
      =private.hmac_lookup_revisions_v1('contact')),
    'indexes',max((select count(*) from jsonb_object_keys(fi.match_indexes))),
    'deadline',max(fi.fixed_expires_at),'nameNotPlaintext',bool_and(position(convert_to('Synthetic Parent','UTF8') in fi.parent_supplied_ciphertext)=0))
    from public.future_person_identity fi where fi.embryo_id='${id(embryo)}'`)) as Record<string,unknown>;
}

/** Append only after the entire original source/QC/permission/rights journey.
 * All authority is issued by real native page actions; SQL only reads proof. */
export async function proveNativeDispositionAndProfile(input:{owner:Page;other:Page;browser:Browser;cohortId:string;embryoId:string;siblingId:string}){
  const {owner,other,browser}=input,embryo=id(input.embryoId),cohort=id(input.cohortId),sibling=id(input.siblingId);
  const unchanged=await immutableProof(cohort),before=await nonceCount(embryo);
  await owner.goto("/settings/data");await other.goto("/settings/data");
  expect(await nonceCount(embryo)).toBe(before);
  const selector=`[data-slot="embryo-disposition-control"][data-embryo-id="${embryo}"]`;
  const proposalObserver=await observeNativeResponses(owner,{propose:`^/api/embryos/${embryo}/disposition$`});
  try{
    const form=owner.locator(selector);await expect(form).toBeVisible();
    await form.getByLabel("Status",{exact:true}).selectOption("transferred");
    await form.getByRole("button",{name:"Record change",exact:true}).click();
    const response=await proposalObserver.read("propose");expect(response.status).toBe(202);
    const receipt=readEmbryoDispositionReceipt(response.status,JSON.parse(response.text),{embryoId:embryo,action:"propose",disposition:"transferred"});
    expect(receipt).not.toBeNull();expect(receipt&&"status" in receipt?receipt.status:null).toBe("awaiting_other_parent");
    await expect(form.getByRole("status")).toHaveText("Waiting for the other parent.");
    await expect(form.getByRole("button",{name:"Confirm change",exact:true})).toHaveCount(0);
  }finally{await proposalObserver.dispose();}
  expect(await immutableProof(cohort)).toBe(unchanged);
  await other.reload();
  const confirmObserver=await observeNativeResponses(other,{confirm:`^/api/embryos/${embryo}/disposition$`});
  let deadline:string;
  try{
    const form=other.locator(selector);await expect(form).toBeVisible();
    await form.getByRole("button",{name:"Confirm change",exact:true}).click();
    const response=await confirmObserver.read("confirm");expect(response.status).toBe(200);
    const receipt=readEmbryoDispositionReceipt(response.status,JSON.parse(response.text),{embryoId:embryo,action:"confirm",disposition:"transferred"});
    expect(receipt!==null&&"disposition" in receipt&&receipt.disposition==="transferred").toBe(true);
    if(receipt===null||!("recordKeyCard" in receipt)||receipt.recordKeyCard===null)throw new Error("Actual replacement Card was not delivered");
    deadline=receipt.retentionExpiresAt;
    const card=form.locator('[data-slot="transfer-record-key-card"]');await expect(card).toBeVisible();
    await expect(card.getByText(receipt.recordKeyCard.recordKey,{exact:true})).toBeVisible();
    await expect(card.getByText(receipt.recordKeyCard.claimUrl,{exact:true})).toBeVisible();
    await expect(card.getByText(`Date: ${receipt.recordKeyCard.closingDateWords}.`,{exact:true})).toBeVisible();
    await expect(card.getByText("Print or copy these now. They are shown only this one time. Keep them for the future person.",{exact:true})).toBeVisible();
    await card.getByRole("button",{name:"Continue",exact:true}).click();
    await expect(other.locator(selector)).toHaveCount(0);
  }finally{await confirmObserver.dispose();}
  const stored=await adminClient().from("embryos").select("status,disposition_effective_at,retention_expires_at,subject_id").eq("id",embryo).single();
  expect(stored.error).toBeNull();expect(stored.data!.status).toBe("transferred");
  expect(Date.parse(stored.data!.retention_expires_at!)).toBe(Date.parse(deadline!));
  const grants=await adminClient().from("purpose_grants").select("grant_id").eq("target_kind","cohort").eq("target_id",cohort).eq("purpose","embryo.analysis").is("revoked_at",null);
  expect(grants.error).toBeNull();expect(grants.data).toEqual([]);
  expect(await immutableProof(cohort)).toBe(unchanged);
  const profileSelector=`[data-slot="future-person-profile-control"][data-embryo-id="${embryo}"]`;
  const profile=other.locator(profileSelector);await expect(profile).toBeVisible();
  await expect(profile.getByLabel("Child birth date",{exact:true})).toHaveValue("");
  await expect(profile.getByLabel("Where the child was born",{exact:true})).toHaveValue("");
  await expect(profile.getByLabel("Parent name",{exact:true})).toHaveValue("");
  const payload={childDateOfBirth:new Date().toISOString().slice(0,10),childPlaceOfBirth:"Synthetic City",
    parentNames:["Synthetic Parent","Synthetic Parent"],consentSignatureId:await profile.locator('input[name="consentSignatureId"]').inputValue()};
  const proof={operationNonce:await profile.locator('input[name="operationNonce"]').inputValue(),csrf:await profile.locator('input[name="csrf"]').inputValue()};
  const countBefore=await nonceCount(embryo);
  const cross=await other.request.put(`/api/embryos/${sibling}/future-person-identity`,{headers:{Origin:new URL(other.url()).origin,
    "X-Inherit-Operation-Nonce":proof.operationNonce,"X-Inherit-CSRF":proof.csrf},data:payload});
  expect(cross.status()).toBe(404);expect(await cross.json()).toEqual({error:"not_found"});
  expect(await nonceCount(embryo)).toBe(countBefore);
  const strangerContext=await browser.newContext({baseURL:new URL(other.url()).origin});
  try{
    const stranger=await strangerContext.newPage(),password="synthetic-profile-stranger-password";
    const email=`profile-stranger-${randomUUID()}@e2e.local`;await createConfirmedUser(email,password);await signIn(stranger,email,password);
    await stranger.goto("/settings/data");await expect(stranger.locator('[data-slot="embryo-disposition-control"]')).toHaveCount(0);
    await expect(stranger.locator('[data-slot="future-person-profile-control"]')).toHaveCount(0);
    const denied=await stranger.request.put(`/api/embryos/${embryo}/future-person-identity`,{headers:{Origin:new URL(stranger.url()).origin,
      "X-Inherit-Operation-Nonce":proof.operationNonce,"X-Inherit-CSRF":proof.csrf},data:payload});
    expect(denied.status()).toBe(404);expect(await denied.json()).toEqual({error:"not_found"});
  }finally{await strangerContext.close();}
  expect(await nonceCount(embryo)).toBe(countBefore);
  const saveObserver=await observeNativeResponses(other,{save:`^/api/embryos/${embryo}/future-person-identity$`},"PUT");
  try{
    await profile.getByLabel("Child birth date",{exact:true}).fill(payload.childDateOfBirth);
    await profile.getByLabel("Where the child was born",{exact:true}).fill(payload.childPlaceOfBirth);
    await profile.getByLabel("Parent name",{exact:true}).fill(payload.parentNames.join("\n"));
    await profile.getByRole("button",{name:"Save details",exact:true}).click();
    const response=await saveObserver.read("save");expect(response.status).toBe(200);
    const body=JSON.parse(response.text);expect(Object.keys(body).sort()).toEqual(["expiresAt","status"]);
    expect(body.status).toBe("saved");expect(Date.parse(body.expiresAt)).toBe(Date.parse(deadline!));
    await expect(profile.getByRole("button",{name:"Delete details",exact:true})).toBeVisible();
    for(const label of ["Child birth date","Where the child was born","Parent name"])await expect(profile.getByLabel(label,{exact:true})).toHaveValue("");
  }finally{await saveObserver.dispose();}
  expect(await nonceCount(embryo)).toBe(countBefore+1);
  const saved=await profileProof(embryo);expect(saved).toMatchObject({rows:1,state:"current",version:1,wrappedBytes:72,indexesExact:true,nameNotPlaintext:true});
  expect(Number(saved.cipherBytes)).toBeGreaterThan(28);expect(Number(saved.indexes)).toBeGreaterThan(0);
  expect(Date.parse(String(saved.deadline))).toBe(Date.parse(deadline!));
  expect(await immutableProof(cohort)).toBe(unchanged);
  await owner.reload();const ownerProfile=owner.locator(profileSelector);await expect(ownerProfile).toBeVisible();
  for(const label of ["Child birth date","Where the child was born","Parent name"])await expect(ownerProfile.getByLabel(label,{exact:true})).toHaveValue("");
  const remove=await observeNativeResponses(owner,{remove:`^/api/embryos/${embryo}/future-person-identity$`},"DELETE");
  try{
    await ownerProfile.getByRole("button",{name:"Delete details",exact:true}).click();
    expect(await remove.read("remove")).toEqual({status:204,text:""});
    await expect(ownerProfile.getByRole("button",{name:"Delete details",exact:true})).toHaveCount(0);
  }finally{await remove.dispose();}
  const erased=await profileProof(embryo);expect(erased).toMatchObject({rows:1,state:"shredded",wrappedBytes:null,indexes:0,cipherBytes:1});
  expect(Date.parse(String(erased.deadline))).toBe(Date.parse(deadline!));
  expect(await nonceCount(embryo)).toBe(countBefore+2);expect(await immutableProof(cohort)).toBe(unchanged);
  const record=await adminClient().from("embryos").select("status,retention_expires_at").eq("id",embryo).single();
  expect(record.error).toBeNull();expect(record.data!.status).toBe("transferred");
  expect(Date.parse(record.data!.retention_expires_at!)).toBe(Date.parse(deadline!));
}
