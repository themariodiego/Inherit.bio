begin;
select no_plan();
\ir fixtures/future_person_custody_source.inc
\ir fixtures/future_person_custody_approved.inc

-- Probe mutations roll back even when the call succeeds unexpectedly.
create function pg_temp.probe(p_setup text,p_call text) returns text language plpgsql as $$
declare result text;
begin
  begin execute p_setup; execute p_call into result;
    raise exception using errcode='ZY001',message='restore synthetic probe';
  exception when sqlstate 'ZY001' then null; end;
  return result;
end $$;
create function pg_temp.detach() returns uuid language sql as $$
  select private.detach_future_person_subject_v1((select review from custody_ids));
$$;
create function pg_temp.source_snapshot() returns jsonb language sql as $$
  select jsonb_build_object('source',(select to_jsonb(x) from private.embryo_canonical_sources x
      where file_id=(select file from custody_ids)),
    'memberships',(select jsonb_agg(to_jsonb(m) order by m.sequence) from private.embryo_canonical_source_parts m
      where m.file_id=(select file from custody_ids)),
    'parts',(select jsonb_agg(to_jsonb(p) order by p.sequence) from private.embryo_canonical_parts p
      join private.embryo_canonical_source_parts m on m.part_id=p.id where m.file_id=(select file from custody_ids)),
    'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.embryo_variants v
      where source_file_id=(select file from custody_ids)));
$$;
create temporary table original_source as select pg_temp.source_snapshot() body;
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
  where has_function_privilege(role,'private.detach_future_person_subject_v1(uuid)','execute')
    or has_function_privilege(role,'private.cancel_unstarted_claim_subject_purge_v1(uuid)','execute')),0::bigint,
  'no API role can detach custody or cancel a purge directly');
select ok(private.claim_hash_matches_v1(pg_temp.h('a'),pg_temp.h('a'))
  and not private.claim_hash_matches_v1(pg_temp.h('a'),pg_temp.h('b'))
  and not private.claim_hash_matches_v1(null,pg_temp.h('a')),'fixed-width hash comparison refuses a changed or missing value');
select throws_ok($$select pg_temp.probe('update private.claim_review_decisions set documentary_attestation_ciphertext=null,
  verified_identity_hmac=null,identity_hmac_revision=null,verified_date_of_birth=null where review_id=(select review from custody_ids)',
  'select pg_temp.detach()::text')$$,'42501','claim review unavailable','an old nominal approval without human attestation cannot detach');
select throws_ok($$select pg_temp.probe('update private.claim_review_decisions set recorded_parent_link_confirmed=false
  where review_id=(select review from custody_ids)','select pg_temp.detach()::text')$$,'42501','claim review unavailable',
  'adult documents alone do not establish the recorded parent link');
select throws_ok($$select pg_temp.probe('update private.claim_review_decisions set verified_date_of_birth=current_date-interval ''17 years''
  where review_id=(select review from custody_ids)','select pg_temp.detach()::text')$$,'42501','claim review unavailable',
  'the verified document birthday enforces exact adult age');
select throws_ok($$select pg_temp.probe('delete from private.claim_review_reads where document_id=(select birth from custody_ids)',
  'select pg_temp.detach()::text')$$,'42501','claim review unavailable','a canceled or incomplete birth-record delivery refuses approval');
select throws_ok($$select pg_temp.probe('update private.claim_review_reads set assignment_revision=2 where review_id=(select review from custody_ids)',
  'select pg_temp.detach()::text')$$,'42501','claim review unavailable','receipts from another assignment cannot satisfy this decision');
select throws_ok($$select pg_temp.probe('update public.future_person_record_key_hashes set status=''revoked'',ended_at=clock_timestamp()
  where embryo_id=(select embryo from custody_ids) and status=''current''','select pg_temp.detach()::text')$$,
  '42501','claim review unavailable','a key revoked after documentary review refuses custody');
select throws_ok($$select pg_temp.probe('update public.embryos set status=''stored'' where id=(select embryo from custody_ids)',
  'select pg_temp.detach()::text')$$,'42501','claim review unavailable','a changed disposition refuses custody');
select is(pg_temp.source_snapshot(),(select body from original_source),'every refused transition preserves the full source and provider identities');
select is(pg_temp.detach(),(select claimant from custody_ids),'one positively attested approval detaches one exact claimant');
set constraints all immediate;
select ok((select s.lifecycle='claimed_unbound' and s.owner_account_id is null and s.subject_account_id is null
    and s.cohort_id is null and s.claimant_principal_id=c.claimant
    and s.earliest_claim_at=(d.verified_date_of_birth+interval '18 years') at time zone 'UTC'
  from custody_ids c join public.subjects s on s.id=c.subject join private.claim_review_decisions d on d.review_id=c.review),
  'custody has one claimant, no parent account/cohort and the reviewer-verified eighteenth birthday');
select ok((select e.status='claimed_unbound' and e.cohort_id is null and f.user_id is null
  from custody_ids c join public.embryos e on e.id=c.embryo join public.genome_files f on f.id=c.file),
  'the live embryo and canonical file no longer select the parent');
-- Deferred coverage must include the old subject after moving a relation,
-- and every approval/embryo/source edge that can invalidate custody.
select throws_ok($$select pg_temp.probe('update public.subject_principals set subject_id=(select subject_id from public.embryos
  where cohort_id=(select cohort_id from live) and sample_ordinal=2) where id=(select principal from custody_ids)',
  'select ''unexpected''::text')$$,'23514','invalid claimant custody','moving the sole principal rechecks its old claimed subject');
select throws_ok($$select pg_temp.probe('update public.future_person_claimant_principals set principal_id=(select id
  from public.subject_principals where principal_kind=''account_subject'' limit 1) where id=(select claimant from custody_ids)',
  'select ''unexpected''::text')$$,'23514','invalid claimant custody','moving the claimant bridge cannot abandon the old subject');
select throws_ok($$select pg_temp.probe('update public.future_person_claims set status=''refused'' where id=(select review from custody_ids)',
  'select ''unexpected''::text')$$,'23514','invalid claimant custody','changing approval state rechecks current custody');
select throws_ok($$select pg_temp.probe('delete from private.future_person_custody_slices where subject_id=(select subject from custody_ids)',
  'select ''unexpected''::text')$$,'23514','invalid claimant custody','deleting the durable slice cannot leave a claimed source without provenance');
select throws_ok($$select pg_temp.probe('update public.embryos set status=''claimed_bound'' where id=(select embryo from custody_ids)',
  'select ''unexpected''::text')$$,'23514',null,'changing the live embryo state cannot desynchronize claimed custody');
select is(pg_temp.source_snapshot(),(select body from original_source),'detachment preserves original source, memberships, provider receipts and genotypes byte for byte');
select ok((select expires_at is null and identity_hmac=pg_temp.h('identity') and hmac_key_revision=1
  from public.future_person_claimant_identity_hmacs where claimant_principal_id=(select claimant from custody_ids)),
  'the verified keyed identity survives contact expiry without a new custody clock');
select ok((select jsonb_array_length(agreement_slice)>0
  and not agreement_slice::text~'signing_name|signer_account|signer_principal|contact|genotype'
  from private.future_person_custody_slices where subject_id=(select subject from custody_ids)),
  'the minimum agreement slice excludes parent identity, contact and genetic fields');
select is((select count(*) from public.genome_files where user_id='7a000000-0000-0000-0000-000000000001'
  and id=(select file from custody_ids)),0::bigint,'the parent account file selector excludes this canonical source');
select throws_ok($$delete from private.embryo_canonical_source_parts where file_id=(select file from custody_ids)$$,
  '42501','embryo_source_unavailable','even a direct membership deletion cannot bypass claimed custody');
select throws_ok($$select private.plan_embryo_source_deletion_v1(array[(select file from custody_ids)],'withdrawal')$$,
  '55000','embryo_source_dependants','the parent source planner cannot delete the claimant slice');
select lives_ok($$select pg_temp.restrict('nonce-custody-parent-restrict')$$,'the parent can still restrict their remaining cohort');
select is(pg_temp.source_snapshot(),(select body from original_source),'parent restriction preserves every claimed source descriptor and genotype');
select is((select count(*) from private.embryo_canonical_sources x join public.subjects s on s.id=x.subject_id
  where s.cohort_id=(select cohort_id from live)),0::bigint,'restriction removes all remaining parent-controlled canonical sources');
select is((select count(*) from private.future_person_custody_slices where subject_id=(select subject from custody_ids)),1::bigint,
  'parent restriction leaves the durable minimum agreement slice');
select * from finish();
rollback;
