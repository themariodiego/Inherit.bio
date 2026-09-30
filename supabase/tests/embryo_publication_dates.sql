begin;
select no_plan();
\ir fixtures/embryo_ingest_completed.inc

-- The completed-embryo fixture configures embryo capacity only. The own-file
-- allowance reader also needs an explicit, complete deployment capacity.
-- These synthetic limits exist only inside this rollback-only transaction.
insert into private.upload_authorization_config (
  singleton, auth_issuer, maximum_array_bytes, maximum_vcf_bytes,
  maximum_account_bytes, maximum_active_uploads
) values (true, 'http://127.0.0.1:54321/auth/v1', 52428800, 25165824,
  134217728, 2)
on conflict (singleton) do update
  set maximum_array_bytes=excluded.maximum_array_bytes,
    maximum_vcf_bytes=excluded.maximum_vcf_bytes,
    maximum_account_bytes=excluded.maximum_account_bytes,
    maximum_active_uploads=excluded.maximum_active_uploads;

-- Retire every other split job inside this transaction so the claim is ours.
update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
  claim_expires_at=null,claimed_by=null
  where kind='split_cohort_vcf' and id<>(select id from job) and status in ('queued','running');
update private.embryo_split_config set enabled=true;

create function pg_temp.token() returns text language sql as $$
  select encode(extensions.digest('synthetic-dates-claim','sha256'),'hex');
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
create function pg_temp.publish() returns jsonb language sql as $$
  select public.publish_embryo_split_v1((select id from job),1,pg_temp.token());
$$;
create function pg_temp.reserved() returns bigint language sql as $$
  select (private.own_upload_limits_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1')
    ->>'reservedBytes')::bigint;
$$;
create function pg_temp.visible() returns text language sql as $$
  select concat_ws(':',
    (select string_agg(distinct e.status||'/'||e.closing_date_state||'/'||e.date_revision,',')
      from public.embryos e where e.cohort_id=(select cohort_id from live)),
    (select count(*) from public.retention_rows r join public.subjects x on x.id=r.target_id
      where x.cohort_id=(select cohort_id from live) and r.retention_id='embryo.stored-or-unknown-24mo'),
    (select count(*) from public.mail_outbox where template_id='record-key-addendum'));
$$;

-- Embryo 1 passes, embryo 2 fails QC, embryo 3 passes. Embryo 3's card
-- carries a provisional date from a finalization 40 days earlier; the other
-- two were finalized today, so their printed date will not move.
create temporary table claim as select public.claim_embryo_split_job_v1(pg_temp.token(),'synthetic-worker') as body;
select is((select (body->>'attempt')::integer from claim),1,'the fixture job is claimed');
select is(pg_temp.pass(0,'[[1,1000,"A","G","A/G"],[2,2000,"C",null,"C/C"]]'),'passed','embryo 1 passes');
select is(public.finish_embryo_split_ordinal_v1((select id from job),1,pg_temp.token(),1,pg_temp.failed())->>'outcome',
  'qc_fail_no_source','embryo 2 fails QC');
select is(pg_temp.pass(2,'[[22,9000,"C","T","C/T"]]'),'passed','embryo 3 passes');
update public.embryos set closing_date=closing_date-40,retention_expires_at=retention_expires_at-interval '40 days'
  where cohort_id=(select cohort_id from live) and sample_ordinal=2;

-- ---------------------------------------------------------------------------
-- Before publication every date is the provisional one, and no row exists
-- ---------------------------------------------------------------------------
select is(pg_temp.visible(),'pending/provisional_until_terminal_ordinal_resolution/1:0:0',
  'before publication every card date is provisional, with no retention row and no addendum');
create temporary table before_mail as select count(*) n from public.mail_outbox;
create temporary table provisional as select sample_ordinal,closing_date from public.embryos
  where cohort_id=(select cohort_id from live);
create temporary table recipients as select unnest(private.embryo_cohort_set_v1((select cohort_id from live),
  'record_key_recipients')) as principal_id;
select is((select count(*) from recipients),2::bigint,'the cohort has two Record Key recipients');
create temporary table allowance_before as select pg_temp.reserved() as n;

-- A required addendum that cannot be written rolls the whole commit back.
-- Everything the probe did is undone whether or not publication refused.
create function pg_temp.probe_contact() returns text language plpgsql as $$
declare v text;
begin
  begin
    update public.encrypted_contact_references set status='rotated'
      where principal_id=(select principal_id from recipients order by principal_id limit 1) and status='current';
    begin
      perform pg_temp.publish();
      v:='published';
    exception when sqlstate '55000' then
      get stacked diagnostics v = message_text;
    end;
    v:=v||' / '||pg_temp.visible();
    raise exception using errcode='ZY001',message='restore synthetic probe';
  exception when sqlstate 'ZY001' then null;
  end;
  return v;
end $$;
select is(pg_temp.probe_contact(),
  'record key addendum unavailable / pending/provisional_until_terminal_ordinal_resolution/1:0:0',
  'a Record Key recipient without a live contact stops the whole publication, which leaves nothing behind');

-- ---------------------------------------------------------------------------
-- The terminal transaction
-- ---------------------------------------------------------------------------
create temporary table published as select pg_temp.publish() as body;
select is((select body->>'status' from published),'published','the cohort publishes');
create temporary table commit_time as select q.computed_at as t from public.embryo_qc q join public.embryos e
  on e.id=q.embryo_id where e.cohort_id=(select cohort_id from live) limit 1;
select ok((select t from commit_time)=(select uploaded_at from public.embryo_cohorts where id=(select cohort_id from live)),
  'the commit time is the actual upload time');

select is((select array_agg(format('%s:%s:%s:%s',e.sample_ordinal,e.status,e.closing_date_state,e.date_revision)
    order by e.sample_ordinal) from public.embryos e where e.cohort_id=(select cohort_id from live)),
  array['0:qc_pass:definitive_stored_or_unknown:2','1:qc_fail:definitive_stored_or_unknown:2',
    '2:qc_pass:definitive_stored_or_unknown:2'],
  'every ordinal, source or not, gets its authoritative date and one new date revision');
select ok((select bool_and(e.retention_expires_at=(select t from commit_time)+interval '24 months'
    and e.closing_date=((select t from commit_time)+interval '24 months')::date)
  from public.embryos e where e.cohort_id=(select cohort_id from live)),
  'each deadline is 24 months from this commit, never the provisional one and never a sibling''s');
select ok((select retention_expires_at=(select t from commit_time)+interval '24 months' from public.embryo_cohorts
  where id=(select cohort_id from live)),'the cohort deadline follows');

-- One stored-or-unknown row per embryo subject, with its three phases.
create temporary table rows as select r.*,e.sample_ordinal from public.retention_rows r
  join public.embryos e on e.subject_id=r.target_id
  where e.cohort_id=(select cohort_id from live) and r.retention_id='embryo.stored-or-unknown-24mo';
select is((select array_agg(format('%s:%s:%s:%s',sample_ordinal,target_kind,retention_revision,state) order by sample_ordinal)
  from rows),array['0:subject:2:scheduled','1:subject:2:scheduled','2:subject:2:scheduled'],
  'one scheduled retention row on each embryo subject');
select ok((select bool_and(r.fixed_deadline=e.retention_expires_at and r.disposition_revision=e.disposition_revision)
  from rows r join public.embryos e on e.subject_id=r.target_id),'each row carries its embryo''s own deadline');
select is((select array_agg(format('%s:%s:%s:%s',r.sample_ordinal,p.phase_id,p.phase_kind,
    (p.phase_deadline=r.fixed_deadline-case p.phase_id when 'stored-expiry-notice-30d' then interval '30 days' else interval '0' end))
    order by r.sample_ordinal,p.phase_id) from rows r join public.retention_due_phases p on p.retention_row_id=r.id
    where p.status='pending'),
  array['0:stored-expiry-deny:deny:t','0:stored-expiry-notice-30d:notice-enqueue:t','0:stored-expiry-purge:purge:t',
    '1:stored-expiry-deny:deny:t','1:stored-expiry-notice-30d:notice-enqueue:t','1:stored-expiry-purge:purge:t',
    '2:stored-expiry-deny:deny:t','2:stored-expiry-notice-30d:notice-enqueue:t','2:stored-expiry-purge:purge:t'],
  'each row has the registered notice 30 days before, then deny and purge at the deadline');
select is((select array_agg(distinct format('%s:%s:%s',r.sample_ordinal,p.immutable_envelope->>'branch',
    p.immutable_envelope->>'renewable')) from rows r join public.retention_due_phases p on p.retention_row_id=r.id),
  array['0:source:true','1:no-source:false','2:source:true'],
  'the envelope names each ordinal''s own branch; the no-source branch cannot be renewed');
select ok((select bool_and((p.immutable_envelope->>'anchor')::timestamptz=(select t from commit_time)
    and (p.immutable_envelope->>'publicationRevision')::integer=1)
  from rows r join public.retention_due_phases p on p.retention_row_id=r.id),
  'every anchor is this commit and the publication revision, borrowed from no sibling');
select is((select count(*) from public.purge_manifests m join rows r on r.id=m.retention_row_id
  where m.phase_id='stored-expiry-purge' and m.manifest_class='complete-retention' and m.state='frozen'),3::bigint,
  'each purge phase has its frozen complete-retention manifest');

-- Addenda: none for embryo 1 (its date did not move), the no-source notice
-- for embryo 2, the date change for embryo 3; each to both recipients.
create temporary table addenda as select m.* from public.mail_outbox m
  where m.template_id='record-key-addendum' and m.target_kind='embryo'
    and m.target_id in (select id from public.embryos where cohort_id=(select cohort_id from live));
select is((select count(*) from public.mail_outbox)-(select n from before_mail),4::bigint,
  'publication queues exactly four notices, all addenda');
select is((select array_agg(format('%s:%s',template_payload->>'displayLabel',template_payload->>'kind')
    order by template_payload->>'displayLabel',recipient_principal_id) from addenda),
  array['Embryo 2:no-source','Embryo 2:no-source','Embryo 3:date-changed','Embryo 3:date-changed'],
  'the failed embryo always gets its no-source notice; a source only when its printed date moved');
select is((select array_agg(distinct x.principal_id order by x.principal_id) from (select recipient_principal_id principal_id
  from addenda) x),(select array_agg(principal_id order by principal_id) from recipients),
  'every notice goes to a current Record Key recipient, and every recipient is told');
select ok((select bool_and(template_payload->>'closingDateIso'=to_char((select t from commit_time)+interval '24 months','YYYY-MM-DD')
    and template_payload->>'closingDateWords'=to_char(((select t from commit_time)+interval '24 months')::date,'FMDD FMMonth YYYY')
    and (select array_agg(k order by k) from jsonb_object_keys(template_payload) k)
      =array['closingDateIso','closingDateWords','displayLabel','kind'])
  from addenda),'each notice carries the new date in words and ISO, and nothing else');
select ok((select bool_and(token_purpose is null and token_target_id is null and state='queued'
    and expires_at=(select t from commit_time)+interval '30 days') from addenda),
  'no notice carries a key, a token or a link, and each expires in 30 days');
select is((select count(distinct idempotency_key) from addenda),4::bigint,'each notice has its own idempotency key');
select is((select count(*) from public.mail_outbox where template_id='embryo-upload-notice'),0::bigint,
  'no upload-time rights notice is queued yet (see the report)');

-- ---------------------------------------------------------------------------
-- The owner's own upload allowance and the source-facts read
-- ---------------------------------------------------------------------------
select ok((select sum(size_bytes)>0 from public.genome_files f join public.subjects x on x.id=f.subject_id
  where x.cohort_id=(select cohort_id from live)),'the published embryo sources have a size');
select is(pg_temp.reserved(),(select n from allowance_before),
  'a published embryo source leaves the parent''s own upload allowance unchanged');
insert into public.genome_files(user_id,bucket_path,original_name,file_type,tier,size_bytes,status,subject_id)
  select '7a000000-0000-0000-0000-000000000001',gen_random_uuid()::text,'synthetic-self.txt','array_23andme',1,100,'stored',
    (select id from public.subjects where owner_account_id='7a000000-0000-0000-0000-000000000001' and subject_class='self');
select is(pg_temp.reserved(),(select n+100 from allowance_before),'the owner''s own file still counts, byte for byte');
select ok((select prosrc like '%private.own_upload_account_bytes_v1(p_account_id)%'
    and prosrc not like '%sum(size_bytes)%' from pg_proc where oid='private.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text)'::regprocedure)
  and (select prosrc like '%private.own_upload_account_bytes_v1(p_account_id)%'
    and prosrc not like '%sum(size_bytes)%' from pg_proc where oid='private.own_upload_limits_v1(uuid,uuid)'::regprocedure),
  'issuance and the disclosure share the one account total');
select is((select array_agg(format('%s:%s:%s',e.sample_ordinal,f.structural_validator_version,x.cohort_id=(select cohort_id from live))
    order by e.sample_ordinal) from public.embryos e join public.subjects x on x.id=e.subject_id
    join public.genome_files f on f.subject_id=e.subject_id and f.source_publication_state='published'
    where e.cohort_id=(select cohort_id from live)),
  array['0:embryo-ordinal-fragment-v1:t','2:embryo-ordinal-fragment-v1:t'],
  'the source-facts read finds one published canonical source on each passing embryo''s own subject in the cohort');

-- ---------------------------------------------------------------------------
-- A later disposition leaves the stored class
-- ---------------------------------------------------------------------------
update public.embryos set status='donated' where cohort_id=(select cohort_id from live) and sample_ordinal=0;
update public.embryos set status='stored' where cohort_id=(select cohort_id from live) and sample_ordinal=2;
select is((select array_agg(format('%s:%s',r.sample_ordinal,x.state) order by r.sample_ordinal) from rows r
  join public.retention_rows x on x.id=r.id),array['0:superseded','1:scheduled','2:scheduled'],
  'donation supersedes the stored row; recording ''stored'' keeps it');
select is((select array_agg(distinct p.status||'/'||coalesce(p.terminal_outcome_code,'-')) from public.retention_due_phases p
  join rows r on r.id=p.retention_row_id where r.sample_ordinal=0),array['cancelled/disposition_superseded'],
  'every open phase of the superseded row is cancelled, so its purge never runs');
select is((select array_agg(m.state order by r.sample_ordinal) from public.purge_manifests m join rows r on r.id=m.retention_row_id),
  array['cancelled','frozen','frozen'],'its purge manifest is cancelled; the others stand');

select * from finish();
rollback;
