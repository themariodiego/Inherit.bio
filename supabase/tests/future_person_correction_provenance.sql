begin;
set local search_path=public,extensions;
select no_plan();
-- currentProvenance of the named correction review, as the owner decided on
-- 2026-10-22 (20261016212000_future_person_correction_provenance.sql).
-- Synthetic data only; everything rolls back.
select ok(not has_function_privilege(r,'private.correction_review_provenance_v1(uuid,text)','execute'),
 'the provenance reader stays unexposed to '||r)
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
\ir fixtures/future_person_deletion_authority.inc
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table fp_source as select x.subject_id subject,x.source_sha256 source,e.id embryo
 from private.future_person_custody_slices x join public.embryos e on e.subject_id=x.subject_id
 where x.subject_id=(select subject from custody_ids);
select is((select count(*) from fp_source),1::bigint,'the fixture holds one claimed subject with its canonical source');
create function pg_temp.prov(p_field text) returns jsonb language sql as $$
 select private.correction_review_provenance_v1((select subject from fp_source),p_field);
$$;
create temporary table fp_before as select f field,pg_temp.prov(f) value
 from unnest(array['display-label','disposition-record','identity-match-profile','report-provenance','variant-call-source'])f;
-- Results bound to the canonical source, and results bound to another one.
insert into public.report_artifacts(subject_id,report_kind,report_revision,source_binding_fingerprint,artifact)
 select subject,'synthetic-correction-provenance',n,source,'{}'::jsonb from fp_source,generate_series(1,2)n;
insert into public.report_artifacts(subject_id,report_kind,report_revision,source_binding_fingerprint,artifact)
 select subject,'synthetic-correction-provenance',3,repeat('0',64),'{}'::jsonb from fp_source;
insert into public.embryo_scores(embryo_id,condition_id,condition_name,finding,evidence_label,coverage_state,
 source_binding_fingerprint,computation_revision)
 select embryo,'synthetic-correction-provenance','Synthetic condition','{"kind":"synthetic"}','clinical','covered',source,1 from fp_source;
insert into public.embryo_scores(embryo_id,condition_id,condition_name,finding,evidence_label,coverage_state,
 source_binding_fingerprint,computation_revision)
 select embryo,'synthetic-correction-provenance','Synthetic condition','{"kind":"synthetic"}','clinical','covered',repeat('1',64),2
 from fp_source;
select is((pg_temp.prov(f)->>'affectedResultCount')::bigint,
 (select count(*) from public.report_artifacts where subject_id=(select subject from fp_source) and source_binding_fingerprint=(select source from fp_source))
 +(select count(*) from public.embryo_scores where embryo_id=(select embryo from fp_source) and source_binding_fingerprint=(select source from fp_source)),
 f||' counts only the results bound to the canonical source')
 from unnest(array['report-provenance','variant-call-source'])f;
select is((pg_temp.prov('variant-call-source')->>'affectedResultCount')::bigint
 -(select (value->>'affectedResultCount')::bigint from fp_before where field='variant-call-source'),3::bigint,
 'the two reports and the score on the canonical source are added, the two on another source are not');
select is((pg_temp.prov(f)->>'affectedResultCount')::bigint,0::bigint,f||' affects no result')
 from unnest(array['display-label','disposition-record','identity-match-profile'])f;
select is(pg_temp.prov(f)->>'sourceKind',k,f||' has its fixed source kind')
 from (values('display-label','neutral-display-label'),('disposition-record','disposition-event'),
  ('identity-match-profile','identity-profile'),('report-provenance','report-result'),
  ('variant-call-source','imported-variant-source'))v(f,k);
select is(array(select jsonb_object_keys(pg_temp.prov('display-label')) order by 1),
 array['affectedResultCount','analysisStopped','fieldVersion','provenanceRevision','sourceDigest','sourceKind'],
 'the database hands over an unkeyed digest, never a published reference');
select ok(pg_temp.prov(field)->>'sourceDigest' ~ '^[0-9a-f]{64}$' and pg_temp.prov(field)->>'sourceDigest'=value->>'sourceDigest',
 field||' keeps one stable digest of its current source row') from fp_before;
select is((select count(distinct pg_temp.prov(field)->>'sourceDigest') from fp_before),5::bigint,
 'each field of the subject has its own digest');
select is((pg_temp.prov(field)->>'fieldVersion')::int,1,field||' starts at field version 1') from fp_before;
select is((pg_temp.prov(field)->>'provenanceRevision')::int,1,field||' starts at provenance revision 1') from fp_before;
select is((pg_temp.prov('display-label')->>'analysisStopped')::boolean,false,'analysis is running');
update public.subjects set analysis_stopped_at=clock_timestamp() where id=(select subject from fp_source);
select is((pg_temp.prov('display-label')->>'analysisStopped')::boolean,true,'a stopped analysis is reported');
select throws_ok($$select pg_temp.prov('correctedValue')$$,'42501','not_found','an unregistered field refuses');
select throws_ok($$select private.correction_review_provenance_v1(gen_random_uuid(),'display-label')$$,
 '42501','not_found','an unknown subject refuses');
select finish();
rollback;
