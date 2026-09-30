begin;
select no_plan();
\ir fixtures/embryo_ingest_completed.inc

-- Retire every other split job inside this transaction so the claim is ours.
update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

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
  return v_result||coalesce(' / '||v_observed,'');
end $$;
create function pg_temp.token() returns text language sql as $$
  select encode(extensions.digest('synthetic-withdrawal-claim','sha256'),'hex');
$$;
create function pg_temp.passed(p_count integer) returns jsonb language sql as $$
  select jsonb_build_object('outcome','passed','qc',jsonb_build_object('sites_expected',8,'sites_called',8,
    'call_rate',1,'autosomal_het_rate',0.25,'mean_depth',null,'qc_verdict','pass','qc_reasons','[]'::jsonb),
    'failureReason',null,'variantCount',p_count);
$$;
create function pg_temp.failed() returns jsonb language sql as $$
  select jsonb_build_object('outcome','qc_fail_no_source','qc',jsonb_build_object('sites_expected',8,'sites_called',4,
    'call_rate',0.5,'autosomal_het_rate',0.25,'mean_depth',null,'qc_verdict','fail',
    'qc_reasons',jsonb_build_array('embryo_call_rate')),'failureReason','embryo_call_rate','variantCount',0);
$$;
create function pg_temp.pass(p_ordinal integer,p_rows jsonb) returns text language plpgsql as $$
begin
  perform public.stage_embryo_split_variants_v1((select id from job),1,pg_temp.token(),p_ordinal,0,p_rows);
  perform pg_temp.land_parts(p_ordinal,pg_temp.token());
  return public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),p_ordinal,
    pg_temp.passed(jsonb_array_length(p_rows)))->>'outcome';
end $$;
create function pg_temp.fail(p_ordinal integer) returns text language sql as $$
  select public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),p_ordinal,pg_temp.failed())->>'outcome';
$$;
create function pg_temp.publish() returns jsonb language sql as $$
  select public.publish_embryo_split_v1((select id from job),1,pg_temp.token());
$$;
-- Claim mail until this cohort's rights notice comes up, as the worker would.
create function pg_temp.claim_notice() returns table (outbox_id uuid, attempt smallint, token text)
language plpgsql as $$
declare r record; i integer;
begin
  for i in 1..30 loop
    select * into r from public.claim_mail_outbox();
    if r.outbox_id is null then return; end if;
    if r.template_id = 'embryo-upload-notice' then
      return query select r.outbox_id, r.attempt_ordinal, r.delivery_token; return;
    end if;
  end loop;
end $$;
create function pg_temp.hash(p text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p,'UTF8'),'sha256'),'hex');
$$;
create function pg_temp.activate(p_token text,p_session text,p_nonce text) returns text language sql as $$
  select coalesce((select purpose||':'||target_kind||':'||(target_id=(select cohort_id from live))::text
    from public.activate_rights_session_v1(pg_temp.hash(p_token),pg_temp.hash(p_session),p_nonce)),'none');
$$;

create temporary table co_parent as select sp.id from public.subject_principals sp
  where sp.account_id='7a000000-0000-0000-0000-000000000002'
    and sp.id = any (private.embryo_cohort_set_v1((select cohort_id from live),'notice_recipients'));

-- ---------------------------------------------------------------------------
-- Grants and registration
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('service_role','private.restrict_embryo_cohort_core_v1(uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','private.restrict_embryo_cohort_core_v1(uuid,uuid,text)','execute'),
  'no role may run the restriction core directly');
select ok(has_function_privilege('service_role','public.restrict_embryo_cohort_v1(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.restrict_embryo_cohort_v1(uuid,uuid,uuid,text)','execute'),
  'the account door keeps its signature and grants');
select ok(has_function_privilege('service_role','public.respond_embryo_parent_withdrawal_v1(text,text,text)','execute')
  and has_function_privilege('service_role','public.embryo_parent_withdrawal_view_v1(text)','execute')
  and not has_function_privilege('authenticated','public.respond_embryo_parent_withdrawal_v1(text,text,text)','execute')
  and not has_function_privilege('anon','public.embryo_parent_withdrawal_view_v1(text)','execute'),
  'only the server reaches the view and the action doors');
select is((select count(*) from unnest(array['anon','authenticated','service_role']) r
  where has_table_privilege(r,'private.embryo_withdrawal_credentials','select')
    or has_table_privilege(r,'private.embryo_withdrawal_credentials','insert')),0::bigint,
  'no API role reads or writes a credential binding');
select is((select target_id from public.purge_target_stores where store_name='private.embryo_withdrawal_credentials'),
  'mail-token-and-rights-delivery-state','credential bindings are purged with the other rights delivery state');
select is((select matrix_purpose||':'||target_kind from private.rights_session_purposes
  where session_purpose='embryo-parent-withdrawal'),'embryo-parent-withdrawal:cohort',
  'the purpose now has an issuer, bound to the whole cohort');

-- ---------------------------------------------------------------------------
-- Publication queues the notice, with a credential for a disposition authority
-- ---------------------------------------------------------------------------
create temporary table claim as select public.claim_embryo_split_job_v1(pg_temp.token(),'synthetic-worker') as body;
select is(pg_temp.pass(0,'[[1,1000,"A","G","A/G"],[2,2000,"C",null,"C/C"]]'),'passed','embryo 1 passes');
select is(pg_temp.fail(1),'qc_fail_no_source','embryo 2 fails QC');
select is(pg_temp.pass(2,'[[22,9000,"C","T","C/T"]]'),'passed','embryo 3 passes');

create temporary table published as select pg_temp.publish() as body;
select is((select body->>'status' from published),'published','the cohort publishes');
create temporary table notice as select m.* from public.mail_outbox m
  where m.template_id='embryo-upload-notice' and m.target_id=(select cohort_id from live);
select is((select count(*) from notice),1::bigint,'exactly one upload-time rights notice is queued');
select is((select recipient_principal_id from notice),(select id from co_parent),
  'it goes to the co-parent, never to the parent who uploaded');
select is((select purpose||':'||target_kind||':'||token_purpose||':'||(token_target_id=target_id)::text from notice),
  'upload-time-rights-notice:cohort:embryo-parent-withdrawal:true','it carries a withdrawal credential for the whole cohort');
select is((select template_payload from notice), jsonb_build_object('embryoCount',3,'uploaderName','Owner',
    'uploadedBy','genetic-parent',
    'uploadDateIso',to_char((c.uploaded_at at time zone 'UTC')::date,'YYYY-MM-DD'),
    'uploadDateWords',to_char((c.uploaded_at at time zone 'UTC')::date,'FMDD FMMonth YYYY'),
    'retentionDays',(c.retention_expires_at at time zone 'UTC')::date-(c.uploaded_at at time zone 'UTC')::date)
  ) from public.embryo_cohorts c where c.id=(select cohort_id from live);
select ok((select (template_payload->>'retentionDays')::integer between 730 and 731 from notice),
  'the retention maximum is the 24-month deadline, in days');
select ok((select expires_at=least(c.uploaded_at+interval '30 days',c.retention_expires_at) from notice,
  public.embryo_cohorts c where c.id=(select cohort_id from live)),'the notice and its link expire in 30 days');
select is((select count(*) from public.token_candidates tc join notice n on n.id=tc.outbox_id
  where tc.purpose='embryo-parent-withdrawal' and tc.state='pending'),1::bigint,'one pending credential, no token yet');
select ok((select b.principal_id=(select id from co_parent) and b.cohort_id=c.id and b.basis_revision=c.basis_revision
    and b.participant_set_revision=c.participant_set_revision and b.lifecycle_revision=c.lifecycle_revision
    and b.publication_revision=1
  from private.embryo_withdrawal_credentials b join public.embryo_cohorts c on c.id=b.cohort_id
  where c.id=(select cohort_id from live)),'the credential is bound to that parent and the exact current revisions');
select throws_ok($$update private.embryo_withdrawal_credentials set publication_revision=2$$,'55000',
  'embryo withdrawal credential immutable','a credential binding never changes');
select ok(private.embryo_withdrawal_current_v1((select tc.id from public.token_candidates tc join notice n on n.id=tc.outbox_id)),
  'the credential is current');
-- The same step for a notice recipient who may not decide: the notice, and no link.
select is(pg_temp.probe($$delete from public.mail_outbox where id=(select id from notice);
    update public.embryo_participant_sets set revoked_at=clock_timestamp()
    where cohort_id=(select cohort_id from live) and set_kind='disposition_authorities'
      and principal_id=(select id from co_parent)$$,
  $$select private.enqueue_embryo_upload_notices_v1((select cohort_id from live),(select id from live),clock_timestamp())::text$$,
  $$select (select count(*) from public.mail_outbox where template_id='embryo-upload-notice'
      and target_id=(select cohort_id from live) and token_purpose is null)::text||':'||
    (select count(*) from private.embryo_withdrawal_credentials where cohort_id=(select cohort_id from live))::text$$),
  '1 / 1:0','a notice recipient who may not decide gets the notice with no credential');

-- A later change to any bound revision makes it unusable.
select is(pg_temp.probe($$update public.embryo_cohorts set participant_set_revision=participant_set_revision+1
    where id=(select cohort_id from live)$$,
  $$select private.embryo_withdrawal_current_v1((select tc.id from public.token_candidates tc join notice n on n.id=tc.outbox_id))::text$$),
  'false','a new participant set revision retires the credential');
select is(pg_temp.probe($$update public.embryo_participant_sets set revoked_at=clock_timestamp()
    where cohort_id=(select cohort_id from live) and set_kind='disposition_authorities'
      and principal_id=(select id from co_parent)$$,
  $$select private.embryo_withdrawal_current_v1((select tc.id from public.token_candidates tc join notice n on n.id=tc.outbox_id))::text$$),
  'false','a parent who can no longer decide cannot use it');

-- ---------------------------------------------------------------------------
-- The mail worker mints the link only for a current credential
-- ---------------------------------------------------------------------------
select is(pg_temp.probe($$update public.embryo_cohorts set participant_set_revision=participant_set_revision+1
    where id=(select cohort_id from live)$$,
  $$select coalesce((select 'claimed' from pg_temp.claim_notice()),'none')$$,
  $$select state||':'||last_outcome_code from public.mail_outbox where id=(select id from notice)$$),
  'none / invalidated:embryo_withdrawal_authority_stale','a stale credential''s notice is invalidated, and no token is made');
create temporary table sent as select * from pg_temp.claim_notice();
select is((select outbox_id from sent),(select id from notice),'the worker claims the notice');
select ok((select token ~ '^[A-Za-z0-9_-]{43}$' from sent),'with a fresh raw token for the link');
select is((select th.status||':'||tc.state from public.token_hashes th join public.token_candidates tc on tc.id=th.candidate_id
  where tc.outbox_id=(select id from notice) and th.token_hash=pg_temp.hash((select token from sent))),'current:issued',
  'only its hash is kept, and the credential is issued');
select ok(private.authorize_mail_submission_v1((select outbox_id from sent),(select attempt from sent)),
  'the pre-submit check passes');
select is(pg_temp.probe($$update public.embryo_cohorts set participant_set_revision=participant_set_revision+1
    where id=(select cohort_id from live)$$,
  $$select private.authorize_mail_submission_v1((select outbox_id from sent),(select attempt from sent))::text$$),
  'false','the pre-submit check refuses a credential that went stale after the claim');

-- ---------------------------------------------------------------------------
-- Activation
-- ---------------------------------------------------------------------------
select is(pg_temp.probe($$update public.embryo_cohorts set participant_set_revision=participant_set_revision+1
    where id=(select cohort_id from live)$$,
  $$select pg_temp.activate((select token from sent),'synthetic-session-secret-probe','withdrawal-form-nonce-probe-0001')$$),
  'none','a stale credential opens nothing');
select is(pg_temp.activate('A'||repeat('b',42),'synthetic-session-secret-other','withdrawal-form-nonce-other-0001'),'none',
  'an unknown token opens nothing');
select is(pg_temp.activate((select token from sent),'synthetic-session-secret-0001','withdrawal-form-nonce-0000000001'),
  'embryo-parent-withdrawal:cohort:true','the link opens a session on the whole cohort');
select ok((select rs.principal_id=(select id from co_parent) and rs.status='active'
    and rs.expires_at<=clock_timestamp()+interval '24 hours' and rs.authority_revision=c.participant_set_revision
  from public.rights_sessions rs, public.embryo_cohorts c
  where rs.session_hash=pg_temp.hash('synthetic-session-secret-0001') and c.id=(select cohort_id from live)),
  'for that parent, for at most a day');
select is((select status from public.token_hashes where token_hash=pg_temp.hash((select token from sent))),'consumed',
  'the token is spent');
select is(pg_temp.activate((select token from sent),'synthetic-session-secret-0002','withdrawal-form-nonce-0000000002'),'none',
  'a spent token opens nothing');
select is((select count(*) from public.legal_audit_log where event_code='rights.session.activated'
  and coded_context->>'purpose'='embryo-parent-withdrawal'),1::bigint,'one coded audit event records it');

-- ---------------------------------------------------------------------------
-- The read-only view
-- ---------------------------------------------------------------------------
select is(public.embryo_parent_withdrawal_view_v1(pg_temp.hash('synthetic-session-secret-0001')),
  (select jsonb_build_object('version','embryo-parent-withdrawal-view-v1',
    'addedOn',to_char((c.uploaded_at at time zone 'UTC')::date,'YYYY-MM-DD'),'embryoCount',3,
    'statuses',jsonb_build_array('qc_pass','qc_fail','qc_pass'),'purposes','[]'::jsonb,
    'retentionMaximumDays',(c.retention_expires_at at time zone 'UTC')::date-(c.uploaded_at at time zone 'UTC')::date,
    'allowedActionIds',jsonb_build_array('delete','refuse'))
   from public.embryo_cohorts c where c.id=(select cohort_id from live)),
  'the view holds the closed facts only: date, count, statuses, purposes, retention and actions');
select is(public.embryo_parent_withdrawal_view_v1(pg_temp.hash('synthetic-session-secret-9999')),null::jsonb,
  'another cookie sees nothing');
select is(pg_temp.probe($$update public.embryo_cohorts set participant_set_revision=participant_set_revision+1
    where id=(select cohort_id from live)$$,
  $$select coalesce(public.embryo_parent_withdrawal_view_v1(pg_temp.hash('synthetic-session-secret-0001'))::text,'none')$$),
  'none','a session whose credential went stale sees nothing');

-- ---------------------------------------------------------------------------
-- The actions
-- ---------------------------------------------------------------------------
create function pg_temp.respond(p_action text,p_nonce text) returns text language sql as $$
  select public.respond_embryo_parent_withdrawal_v1(pg_temp.hash('synthetic-session-secret-0001'),p_action,p_nonce);
$$;
select is(pg_temp.respond('export','withdrawal-op-nonce-00000000001'),'unavailable','export is not offered here');
select is(pg_temp.respond('confirm','withdrawal-op-nonce-00000000002'),'unavailable','nor is confirm');
select is(pg_temp.probe($$delete from private.rights_purpose_matrix where purpose='embryo-parent-withdrawal' and action='delete'$$,
  $$select pg_temp.respond('delete','withdrawal-op-nonce-00000000003')$$,
  $$select status from public.embryo_cohorts where id=(select cohort_id from live)$$),
  'unavailable / active','an action the matrix does not permit is refused, and nothing changes');
select is(pg_temp.probe($$update public.embryo_cohorts set lifecycle_revision=lifecycle_revision+1
    where id=(select cohort_id from live)$$,
  $$select pg_temp.respond('delete','withdrawal-op-nonce-00000000004')$$,
  $$select status from public.embryo_cohorts where id=(select cohort_id from live)$$),
  'unavailable / active','a stale credential withdraws nothing');
-- A nonce is spent even by an attempt that did nothing, and never answers twice.
select throws_ok($$select pg_temp.probe($p$create temporary table held_matrix as select * from private.rights_purpose_matrix
      where purpose='embryo-parent-withdrawal' and action='delete';
    delete from private.rights_purpose_matrix where purpose='embryo-parent-withdrawal' and action='delete';
    select pg_temp.respond('delete','withdrawal-op-nonce-0000000000r');
    insert into private.rights_purpose_matrix select * from held_matrix$p$,
  $p$select pg_temp.respond('delete','withdrawal-op-nonce-0000000000r')$p$)$$,'23505',
  'operation nonce already used','a form nonce answers once');
select is(pg_temp.probe('select 1',$$select pg_temp.respond('refuse','withdrawal-op-nonce-00000000005')$$,
  $$select status||':'||(select status from public.rights_sessions where session_hash=pg_temp.hash('synthetic-session-secret-0001'))
    from public.embryo_cohorts where id=(select cohort_id from live)$$),
  'refused / restricted:consumed','refusing restricts the cohort and spends the session');

select is(pg_temp.probe('select 1',$$select pg_temp.respond('refuse','withdrawal-op-nonce-0000000000s')$$,
  $$select coded_context->>'reason' from public.legal_audit_log
    where event_code='embryo.source.deletion-planned' order by seq desc limit 1$$),
  'refused / withdrawal','a rights refusal plans canonical deletion with the withdrawal reason');
create temporary table withdrawing_sources as
  select file_id from private.embryo_canonical_sources where cohort_id=(select cohort_id from live);
select is((select count(*) from withdrawing_sources),2::bigint,'both passing embryos have sources before withdrawal');
create temporary table before_mail as select count(*) n from public.mail_outbox where template_id='cohort-restriction-notice';
select is(pg_temp.respond('delete','withdrawal-op-nonce-00000000006'),'deleted','deleting takes effect');
select is((select status||':'||lifecycle_revision from public.embryo_cohorts where id=(select cohort_id from live)),
  'restricted:2','the cohort is restricted, one lifecycle revision later');
select is((select array_agg(distinct lifecycle) from public.subjects where cohort_id=(select cohort_id from live)),
  array['restricted'],'every embryo subject is restricted');
select is((select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id
  where e.cohort_id=(select cohort_id from live))+(select count(*) from public.embryo_qc q join public.embryos e
  on e.id=q.embryo_id where e.cohort_id=(select cohort_id from live)),0::bigint,'every derived row is deleted at once');
select is((select count(*) from public.future_person_record_key_hashes h join public.embryos e on e.id=h.embryo_id
  where e.cohort_id=(select cohort_id from live) and h.status='current'),0::bigint,'every Record Key is revoked');
select is((select count(*) from public.mail_outbox where template_id='cohort-restriction-notice')-(select n from before_mail),
  2::bigint,'every notice recipient is told');
select is((select route_id from public.legal_audit_log where event_code='embryo.cohort.restricted' order by seq desc limit 1),
  'api.withdraw','the audit event names the rights route');
select is((select count(*) from private.embryo_canonical_sources where file_id in (select file_id from withdrawing_sources))
  +(select count(*) from private.embryo_canonical_source_parts where file_id in (select file_id from withdrawing_sources))
  +(select count(*) from public.genome_files where id in (select file_id from withdrawing_sources))
  +(select count(*) from public.user_variants where file_id in (select file_id from withdrawing_sources)),0::bigint,
  'withdrawal deletes every canonical source, membership, descriptor and genotype atomically');
select is(private.embryo_ingest_attempt_residue_v1(array(select file_id from withdrawing_sources),'{}'),
  '{"registered":{},"unregistered":{},"unverifiable":0}'::jsonb,'no store still names either withdrawn file');
select is((select count(*) from private.embryo_canonical_parts where session_id=(select id from live)),4::bigint,
  'provider identities stay registered until exact disposal is acknowledged');
select is((select coded_context->>'reason' from public.legal_audit_log where event_code='embryo.source.deletion-planned'
    order by seq desc limit 1),'withdrawal','the actual delete records withdrawal rather than account restriction');
select is((select status from public.rights_sessions where session_hash=pg_temp.hash('synthetic-session-secret-0001')),
  'consumed','the session is spent');
select is(pg_temp.respond('delete','withdrawal-op-nonce-00000000007'),'unavailable','a spent session does nothing more');
select is(public.embryo_parent_withdrawal_view_v1(pg_temp.hash('synthetic-session-secret-0001')),null::jsonb,
  'and shows nothing');

-- ---------------------------------------------------------------------------
-- The restriction core itself
-- ---------------------------------------------------------------------------
select throws_ok($$select private.restrict_embryo_cohort_core_v1((select cohort_id from live),(select id from co_parent),'api.other')$$,
  '22023','invalid restriction route','the core serves only its two routes');
select throws_ok($$select private.restrict_embryo_cohort_core_v1((select cohort_id from live),gen_random_uuid(),'api.withdraw')$$,
  '42501','not a disposition authority','the core refuses anyone who may not decide');
select throws_ok($$select private.restrict_embryo_cohort_core_v1((select cohort_id from live),(select id from co_parent),'api.withdraw')$$,
  '55000','already restricted','and a cohort already restricted');

select * from finish();
rollback;
