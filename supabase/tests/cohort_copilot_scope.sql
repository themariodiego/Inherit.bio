-- The Embryo (cohort) group Copilot scope: authority, provenance, stale
-- state and revocation (20260929143000_cohort_copilot_scope.sql), over a
-- cohort published through the real worker functions. Rollback only.
begin;
select no_plan();
\ir fixtures/embryo_cohort_published.inc

create temporary table ids as select (select cohort_id from live) as cohort,
 (select id from public.subjects where subject_account_id='7a000000-0000-0000-0000-000000000001'
   and subject_class='self' and lifecycle='active' order by created_at limit 1) as a_self;

create function pg_temp.chat(account uuid,session uuid,op text,chat uuid,payload jsonb) returns jsonb language sql as $$
 select public.cohort_copilot_chat_v1(op,account,session,(select cohort from ids),chat,payload); $$;
create function pg_temp.a(op text,chat uuid default null,payload jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select pg_temp.chat('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',op,chat,payload); $$;
create function pg_temp.c(op text,chat uuid default null,payload jsonb default '{}'::jsonb) returns jsonb language sql as $$
 select pg_temp.chat('7a000000-0000-0000-0000-000000000003','7a000000-0000-4000-8000-0000000000c1',op,chat,payload); $$;
create function pg_temp.grant_analysis(account uuid,session uuid,nonce text) returns uuid language sql as $$
 select public.grant_cohort_purpose_v1(account,session,(select cohort from ids),'consent.upload-embryo',1,
  private.embryo_statement_keys_v1('consent.upload-embryo','grant'),decode('deadbeef','hex'),'GB',nonce); $$;
-- Runs p_setup and p_call, reports p_call's result and p_observe's, then
-- rolls both back so the next assertion starts from the same state.
create function pg_temp.probe(p_setup text,p_call text,p_observe text default 'select null::text')
returns text language plpgsql as $$
declare v_result text; v_observed text;
begin
  begin
    execute p_setup;
    execute p_call into v_result;
    execute p_observe into v_observed;
    raise exception using errcode='ZY001',message='restore synthetic probe';
  exception when sqlstate 'ZY001' then null;
  end;
  return coalesce(v_result,'<null>')||coalesce(' / '||v_observed,'');
end $$;

-- ---------------------------------------------------------------------------
-- Who may call
-- ---------------------------------------------------------------------------
select is(has_function_privilege('authenticated','public.cohort_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)','execute'),false,
 'no browser role can open a cohort conversation');
select is(has_function_privilege('anon','public.cohort_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)','execute'),false,
 'no anonymous caller can open a cohort conversation');
select is(has_function_privilege('service_role','private.cohort_copilot_authority_v1(uuid,uuid)','execute'),false,
 'the authority is reachable only through the dispatcher');
select is(has_function_privilege('service_role','private.cohort_copilot_prune_v1(uuid,uuid,text)','execute'),false,
 'the deletion helper is reachable only through the dispatcher and the revocation trigger');

-- ---------------------------------------------------------------------------
-- Authority: every required principal's analysis grant, a published cohort
-- ---------------------------------------------------------------------------
select is(pg_temp.a('authority'),'null'::jsonb,'with no analysis grant nothing about the cohort is readable');
select pg_temp.grant_analysis('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 'nonce-cohort-copilot-grant-a');
select is(pg_temp.a('authority'),'null'::jsonb,'one parent''s grant is not enough while the other has not granted');
select pg_temp.grant_analysis('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
 'nonce-cohort-copilot-grant-b');
create temporary table authority as select pg_temp.a('authority') as value;
select is((select value->>'role' from authority),'required_upload_principal','with both grants a parent reads the cohort');
select is((select jsonb_array_length(value->'grants') from authority),2,'the authority binds both parents'' grants');
select is((select jsonb_array_length(value->'embryos') from authority),3,'every published embryo is named once');
select is((select value->>'donorClassification' from authority),'donor-neutral','the context is classified donor-neutral');
select is((select (value->>'publicationRevision')::integer from authority),1,'the authority binds the publication');
select is(pg_temp.chat('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1','authority',null,'{}'),
 (select value from authority),'the other parent resolves the same authority');
select is(pg_temp.c('authority'),'null'::jsonb,'an account outside the cohort reads nothing about it');
select throws_ok($$select pg_temp.chat('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000c1',
 'authority',null,'{}')$$,'42501','not_found','another account''s session is refused');
select is(pg_temp.probe($$update public.purpose_grants set purpose='raw.export'
 where target_kind='cohort' and target_id=(select cohort from ids) and purpose='embryo.analysis'
  and signer_principal_id in(select id from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000002')$$,
 $$select pg_temp.a('authority')::text$$),'null',
 'a cohort grant for any other purpose is not an analysis grant');
select is(pg_temp.probe($$update public.directional_grants set status='revoked',ended_at=clock_timestamp()
 where grant_id in(select grant_id from public.purpose_grants where target_kind='cohort' and target_id=(select cohort from ids)
  and signer_principal_id in(select id from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000002'))$$,
 $$select pg_temp.a('authority')::text$$),'null',
 'a grant whose direction row is no longer current does not count');
select is(pg_temp.probe($$update public.embryo_cohorts set publication_revision=null,status='ingesting'
 where id=(select cohort from ids)$$,$$select pg_temp.a('authority')::text$$),'null',
 'an unpublished cohort is not readable');
select is(pg_temp.probe($$insert into public.attestation_contradictions(cohort_id,principal_id,contradiction_code,lifecycle_revision)
 select (select cohort from ids),principal_id,'synthetic',1 from public.embryo_participant_sets
 where cohort_id=(select cohort from ids) and set_kind='required_upload_principals' limit 1$$,
 $$select pg_temp.a('authority')::text$$),'null','an open attestation contradiction closes the cohort to Copilot');

-- ---------------------------------------------------------------------------
-- A's own local Copilot: the one recipient every cohort turn is bound to
-- ---------------------------------------------------------------------------
\ir fixtures/own_copilot_synthetic_settings.inc
update public.profiles set date_of_birth=date '1990-01-01' where id='7a000000-0000-0000-0000-000000000001';
-- A's own upload acknowledgements through the real signing function, as the
-- own Copilot settings require.
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from (values('c'),('d')) n(letter);
select public.sign_own_upload_artifact_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select a_self from ids),'disclosure.insurance-and-discrimination',1,(select body_sha256 from public.consent_artifacts
  where artifact_key='disclosure.insurance-and-discrimination' and version=1),array['understood'],1,1,1,1,1,repeat('c',64));
select public.sign_own_upload_artifact_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select a_self from ids),'consent.upload-self',1,(select body_sha256 from public.consent_artifacts
  where artifact_key='consent.upload-self' and version=1),array['own-adult-dna'],1,1,1,1,1,repeat('d',64));
select public.save_own_copilot_settings_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 pg_temp.synthetic_copilot_settings('synthetic-model','local'),null,repeat('b',64),null);
create temporary table a_presentation as select public.own_copilot_presentation_v1('7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1',(select a_self from ids)) value;
select public.grant_own_copilot_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select a_self from ids),(select value->'snapshot' from a_presentation),(select value->'artifacts' from a_presentation),
 repeat('9',64),clock_timestamp()+interval '9 minutes');
create temporary table a_provider as select public.own_copilot_authority_v1('7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1',(select a_self from ids)) value;
select is((select value->>'providerClass' from a_provider),'local','A holds a current local Copilot authority');

create function pg_temp.citation(href text) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('id','cohort:'||(select cohort from ids),'label','Your embryos','href',href)); $$;
create function pg_temp.commit(chat uuid,last_ordinal integer,nonce text,
 authority jsonb default null,citations jsonb default null,provider jsonb default null) returns jsonb language sql as $$
 select pg_temp.a('commit',chat,jsonb_build_object('message','Which embryos passed the quality check?',
  'answer','Embryo 1 passed and Embryo 3 was marginal.',
  'citations',coalesce(citations,pg_temp.citation('/embryos/compare?cohort='||(select cohort from ids))),
  'lastOrdinal',last_ordinal,'nonceHash',case when nonce is null then null else encode(extensions.digest(nonce,'sha256'),'hex') end,
  'expiresAt',case when nonce is null then null else to_jsonb(clock_timestamp()+interval '9 minutes') end,
  'provider',coalesce(provider,(select value from a_provider)),'authority',coalesce(authority,(select value from authority)))); $$;

-- ---------------------------------------------------------------------------
-- A turn: bound to the exact authority it read under
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.commit(null,0,'cohort-nonce-cloud',null,null,
 (select value from a_provider)||jsonb_build_object('providerClass','cloud'))$$,'42501','not_found',
 'a cohort turn never commits under a cloud provider');
select throws_ok($$select pg_temp.commit(null,0,'cohort-nonce-stale',(select value from authority)||'{"publicationRevision":2}')$$,
 '42501','not_found','a turn read under an authority that is not current does not commit');
select throws_ok($$select pg_temp.commit(null,0,'cohort-nonce-foreign',null,
 pg_temp.citation('/embryos/compare?cohort=7a000000-0000-4000-8000-00000000ffff'))$$,'22023','invalid_request',
 'an answer cannot cite another cohort');
select throws_ok($$select pg_temp.commit(null,0,'cohort-nonce-embryo',null,
 pg_temp.citation('/embryos/7a000000-0000-4000-8000-00000000ffff'))$$,'22023','invalid_request',
 'an answer cannot cite an embryo outside the cohort');
select throws_ok($$select pg_temp.commit(null,0,'cohort-nonce-href',null,pg_temp.citation('https://example.invalid/'))$$,
 '22023','invalid_request','an answer cannot cite anything outside the closed set');

create temporary table first_turn as select (pg_temp.commit(null,0,'cohort-nonce-first')->>'chatId')::uuid as id;
select is((select scope_kind||':'||cohort_id::text||':'||(canonical_authority->>'scope') from public.chats where id=(select id from first_turn)),
 'cohort:'||(select cohort from ids)||':cohort','the conversation is a cohort chat on exactly this cohort');
select is((select cohort_authority_fingerprint from public.chats where id=(select id from first_turn)),
 encode(extensions.digest(convert_to((select value from authority)::text,'UTF8'),'sha256'),'hex'),
 'the conversation is bound to the digest of the authority');
select is((select retrieved_subject_ids from public.chat_messages where chat_id=(select id from first_turn) and role='assistant'),
 (select array_agg(subject_id order by subject_id) from public.embryos where cohort_id=(select cohort from ids)),
 'the answer records exactly which embryos it read');
select is((select retrieved_purpose_keys from public.chat_messages where chat_id=(select id from first_turn) and role='assistant'),
 array['embryo.analysis'],'and under which purpose');
select is((select cardinality(contributor_ids) from public.chat_messages where chat_id=(select id from first_turn) and role='user'),
 2,'and whose grants');
select is((select count(*) from public.copilot_turn_dependencies where chat_id=(select id from first_turn)),9::bigint,
 'the turn depends on the publication, basis, set, donor classification, two grants and three embryos');
select is((select embryo_findings from public.chat_messages where chat_id=(select id from first_turn) and role='assistant'),
 '[]'::jsonb,'no finding is stored while no condition is registered');
select throws_ok($$select pg_temp.commit(null,0,'cohort-nonce-first')$$,'42501','not_found','the page context is single use');
select is(jsonb_array_length(pg_temp.a('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider)))->'messages'),
 2,'A reads the conversation back');
select is(jsonb_array_length(pg_temp.a('list')),1,'A lists the conversation');
select is(pg_temp.c('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider))),'null'::jsonb,
 'an account outside the cohort cannot read the conversation');
select is((select count(*) from public.chat_messages where chat_id=(select id from first_turn)),2::bigint,
 'and cannot remove it either');
select throws_ok($$select pg_temp.chat('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1','history',
 (select id from first_turn),jsonb_build_object('provider',(select value from a_provider)))$$,'42501','not_found',
 'the other parent cannot read A''s conversation');
select is((pg_temp.commit((select id from first_turn),1,null)->>'chatId')::uuid,(select id from first_turn),'A adds a second turn');
select is((select max(turn_ordinal) from public.chat_messages where chat_id=(select id from first_turn)),2::bigint,
 'the second turn follows the first');

-- ---------------------------------------------------------------------------
-- Stale state and revocation
-- ---------------------------------------------------------------------------
select is(pg_temp.probe($$update public.subjects set lifecycle_revision=lifecycle_revision+1
 where id=(select subject_id from public.embryos where cohort_id=(select cohort from ids) and sample_ordinal=0)$$,
 $$select pg_temp.a('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider)))::text$$,
 $$select count(*)::text from public.chat_messages where chat_id=(select id from first_turn)$$),'null / 0',
 'a changed embryo record ends the conversation, and its content is deleted at the next read');
select is(pg_temp.probe($$update public.embryo_cohorts set status='restricted' where id=(select cohort from ids)$$,
 $$select pg_temp.a('list')::text$$,
 $$select count(*)::text from public.chat_messages where chat_id=(select id from first_turn)$$),'null / 0',
 'a cohort that is no longer active is read by no conversation, and its content is deleted');
select is(pg_temp.probe($$update public.embryo_cohorts set status='restricted' where id=(select cohort from ids)$$,
 $$select pg_temp.c('list')::text$$,
 $$select count(*)::text from public.chat_messages where chat_id=(select id from first_turn)$$),'null / 4',
 'another account''s read deletes nothing of A''s');

update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where target_kind='cohort' and target_id=(select cohort from ids) and purpose='embryo.analysis'
  and signer_principal_id=(select principal_id from public.embryo_participant_sets where cohort_id=(select cohort from ids)
   and set_kind='required_upload_principals' and principal_id in(select id from public.subject_principals
    where account_id='7a000000-0000-0000-0000-000000000002'));
select is((select count(*) from public.chat_messages where chat_id=(select id from first_turn)),0::bigint,
 'withdrawing either parent''s analysis grant deletes the conversation in the same transaction');
select is((select count(*) from public.copilot_turn_dependencies where chat_id=(select id from first_turn)),0::bigint,
 'with every dependency row');
select is(pg_temp.a('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider))),'null'::jsonb,
 'the conversation answers 404 afterwards');
select is(pg_temp.commit((select id from first_turn),2,null),'null'::jsonb,'and takes no further turn');
select is(pg_temp.a('authority'),'null'::jsonb,'the cohort is closed to Copilot until both parents grant again');

-- ---------------------------------------------------------------------------
-- Citations
-- ---------------------------------------------------------------------------
select is(private.valid_cohort_copilot_citations_v1(pg_temp.citation('/embryos/compare?cohort=7a000000-0000-4000-8000-00000000ffff')),true,
 'the validator accepts a cohort comparison link');
select is(private.valid_cohort_copilot_citations_v1(pg_temp.citation('/family/s-7a000000-0000-4000-8000-00000000ffff')),false,
 'the validator refuses a link outside the embryo pages');
select is(private.valid_cohort_copilot_citations_v1(jsonb_build_array(jsonb_build_object('id','x','label','x',
 'href','/embryos/7a000000-0000-4000-8000-00000000ffff','extra',1))),false,'the validator refuses an unknown key');

select * from finish();
rollback;
