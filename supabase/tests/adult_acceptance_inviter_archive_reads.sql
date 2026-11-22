-- D-156: the hold and the reminder cover the inviter's account archive of what
-- the invited adult shares (20261122140000_adult_acceptance_inviter_archive_reads.sql;
-- owner decision of 22 November 2026, "The 72-hour hold covers an inviter's
-- reads of the invited adult's own record", docs/protocol/decisions.md).
--
-- Proves, on synthetic rows only, with the native complete archive switched
-- on inside this transaction:
--   * during the hold the inviter's archive treats the adult's export and raw
--     permissions exactly as absent: the adult's record is not among the
--     archive's records (the same records as with no grant from the adult),
--     a record listed through a family pair is excluded with the reason a
--     missing export permission gives and no raw authority, and the
--     recipient, raw and source authorities refuse as they do with no grant;
--   * a third account the adult shares with is unaffected, and the adult's
--     own archive is unaffected;
--   * once the second notice is accepted the archive includes the adult's
--     record, its permission and its raw file, with no job run;
--   * an archive requested while the export is permitted can no longer be
--     built or delivered from 30 days (its capture is no longer current) and
--     is current again, unchanged, once the reminder is accepted;
--   * the preserved account export (the native archive off) refuses an
--     account that receives grants whether or not it is held, as before;
--   * the patched bodies carry their pinned successors and privileges.
-- Time is moved only by ageing the synthetic acceptance's own rows. Everything
-- rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

-- People ---------------------------------------------------------------------------
-- A invites; B is invited and signs up after the invitation; C is a third
-- account B shares with. Each has a declared jurisdiction, as an archive needs.
insert into auth.users(id,email,email_confirmed_at,created_at)
 select ('d1570000-0000-4000-8000-00000000000'||n)::uuid,'d157-'||n||'@e2e.local',now()-interval '1 day',now()-interval '1 day'
 from unnest(array['1','2','3']) n;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('d1570000-0000-4000-8000-00000000001'||n)::uuid,('d1570000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1'
 from unnest(array['1','2','3']) n;
update public.profiles p set date_of_birth=date '1990-01-01',jurisdiction_code='GB',jurisdiction_declared_at=clock_timestamp(),
 jurisdiction_attestation_version=a.version,jurisdiction_attestation_sha256=a.body_sha256
 from public.consent_artifacts a where a.artifact_key='attestation.jurisdiction' and a.superseded_at is null
  and p.id::text like 'd1570000-%';
create function pg_temp.acct(p text) returns uuid language sql immutable as
 $$ select ('d1570000-0000-4000-8000-00000000000'||p)::uuid $$;
create function pg_temp.sess(p text) returns uuid language sql immutable as
 $$ select ('d1570000-0000-4000-8000-00000000001'||p)::uuid $$;
create function pg_temp.origin(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('kind','account','accountId',pg_temp.acct(p),'sessionId',pg_temp.sess(p)) $$;
create function pg_temp.self(p_account uuid) returns uuid language sql as
 $$ select id from public.subjects where subject_account_id=p_account and subject_class='self' $$;
create function pg_temp.principal(p_account uuid) returns uuid language sql as $$
 select sp.id from public.subject_principals sp join public.subjects s on s.id=sp.subject_id
 where sp.account_id=p_account and s.subject_class='self' and sp.principal_kind='account_subject' and sp.status='active' $$;

-- A's Path A invitation to B, opened through its mailed token and accepted by
-- an account created after it was sent.
create temporary table pa(name text primary key,subject_id uuid,invitation_id uuid);
do $$
declare r record; d record; v_subject uuid;
begin
 select * into r from public.create_adult_subject_invitation_v1(pg_temp.acct('1'),decode('00112233445566778899aabbccddeeff','hex'),
  repeat('b',64),encode(extensions.digest(convert_to('d157-idem:b','UTF8'),'sha256'),'hex'),true,
  p_quota_keys=>pg_temp.invitation_quota_keys());
 update public.mail_outbox set state='invalidated' where state in ('queued','claimed') and token_target_id is distinct from r.invitation_id;
 select * into d from public.claim_mail_outbox();
 if (select count(*) from public.activate_rights_session_v1(encode(extensions.digest(convert_to(d.delivery_token,'UTF8'),'sha256'),'hex'),
   repeat('b',64),'d157-open-baaaaaaaaaaaaaaaaaa'))<>1 then raise exception 'path a setup failed'; end if;
 update auth.users set created_at=clock_timestamp() where id=pg_temp.acct('2');
 v_subject:=public.accept_adult_subject_invitation_v1(repeat('b',64),'d157-accept-baaaaaaaaaaaaaaaa',pg_temp.acct('2'),
  pg_temp.sess('2'),jsonb_build_object('1',repeat('b',64)),decode(repeat('5a',28),'hex'));
 insert into pa values('b',v_subject,r.invitation_id);
end $$;
create function pg_temp.inv() returns uuid language sql as $$ select invitation_id from pa where name='b' $$;
create function pg_temp.age(p_by interval) returns void language sql as $$
 update public.subject_invitations set accepted_at=accepted_at-p_by,terminal_at=terminal_at-p_by where id=pg_temp.inv();
 update public.retention_rows set fixed_deadline=fixed_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv();
 update public.retention_due_phases set phase_deadline=phase_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv();
$$;
create function pg_temp.deliver(p_kind text) returns text language plpgsql as $$
declare c record; n integer;
begin
 for n in 1..50 loop
  select * into c from public.claim_invitation_terminal_mail_v1();
  if c.outbox_id is null then return 'none'; end if;
  if c.notice_kind=p_kind and exists(select 1 from public.mail_outbox m where m.id=c.outbox_id and m.target_id=pg_temp.inv()) then
   if not public.authorize_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal) then return 'refused'; end if;
   perform public.complete_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal,true,
    encode(extensions.digest(convert_to('provider:'||c.outbox_id::text,'UTF8'),'sha256'),'hex'));
   return 'sent';
  end if;
 end loop;
 return 'none';
end $$;
select is(public.adult_subject_acceptance_origin_v1(pg_temp.acct('2'),(select subject_id from pa)),'created_from_this_invitation',
 '(B) accepted A''s invitation with an account created after it (20261120120000 records the hold)');

-- B's own record: a real normalized source, and B's own upload consent -------------
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(repeat('a',64),pg_temp.acct('2'),pg_temp.sess('2'),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'),
  (repeat('b',64),pg_temp.acct('2'),pg_temp.sess('2'),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
create function pg_temp.sign_own(artifact text,statement text,nonce text) returns jsonb language sql as $$
 select to_jsonb(public.sign_own_upload_artifact_v1(pg_temp.acct('2'),pg_temp.sess('2'),pg_temp.self(pg_temp.acct('2')),artifact,
 (select version from public.consent_artifacts where artifact_key=artifact and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=artifact and superseded_at is null),
 array[statement],1,1,(select jurisdiction_revision from public.profiles where id=pg_temp.acct('2')),1,1,nonce)); $$;
select pg_temp.sign_own('disclosure.insurance-and-discrimination','understood',repeat('a',64));
select pg_temp.sign_own('consent.upload-self','own-adult-dna',repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('d1570000-0000-4000-8000-000000000020',
 'genomes','d1570000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('d1570000-0000-4000-8000-000000000040',pg_temp.acct('2'),pg_temp.self(pg_temp.acct('2')),
 'd1570000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'d1570000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('d1570000-0000-4000-8000-000000000020','d1570000-0000-4000-8000-000000000030','genomes',
 'd1570000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 pg_temp.acct('2'),pg_temp.sess('2'),'d1570000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,pg_temp.acct('2'),pg_temp.sess('2'),'d1570000-0000-4000-8000-000000000040',
 (select (receipt->>'claim')::uuid from preparation),payload); $$;
select pg_temp.prepare('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":456,"chrom":1,"pos":100001,"ref":"C","alt":"T","genotype":"C/T"}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb));

-- B shares, through the real door, the archive's two recipient purposes with A
-- (whom the hold covers) and with C (whom it does not).
create function pg_temp.b_grants(purpose text,recipient text) returns uuid language sql as $$
 select public.grant_directional_purpose_v1(pg_temp.acct('2'),pg_temp.self(pg_temp.acct('2')),
 pg_temp.principal(pg_temp.acct(recipient)),purpose,'consent.share-with-adult',1,'d157-'||recipient||'-'||purpose||'-0000000000'); $$;
select isnt(pg_temp.b_grants(purpose,recipient),null,'(hold) B grants '||purpose||' to '||recipient)
 from unnest(array['export.share-link','raw.export']) purpose cross join unnest(array['1','3']) recipient;
-- No door writes a variants-scoped consent for a person's own record, so the
-- raw branch refuses every recipient of a self record today (and with it the
-- recipient's whole native archive). This one row stands in for it, signed by
-- B's own upload signature, so the raw branch can be seen open and held.
insert into public.subject_consents(signature_id,subject_id,account_id,consent_type,scope,grant_revision)
 select cs.id,pg_temp.self(pg_temp.acct('2')),pg_temp.acct('2'),'self_source',array['variants'],1
 from public.consent_signatures cs where cs.signer_account_id=pg_temp.acct('2') and cs.target_id=pg_temp.self(pg_temp.acct('2'))
  and cs.artifact_key='consent.upload-self';

-- The native complete archive, on for this transaction only.
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- What one account's archive covers, as one line: its records with their
-- class and status, and the records it reads raw files from ('refused' when
-- the capture itself is refused).
create function pg_temp.covers(p text) returns text language plpgsql as $$
begin
 return pg_temp.covers_unchecked(p);
exception when insufficient_privilege then return 'refused';
end $$;
create function pg_temp.covers_unchecked(p text) returns text language sql as $$
 select string_agg(case x->>'subjectId' when pg_temp.self(pg_temp.acct('1'))::text then 'A'
   when pg_temp.self(pg_temp.acct('2'))::text then 'B' when pg_temp.self(pg_temp.acct('3'))::text then 'C'
   when (select subject_id::text from pa) then 'B-invited' else '?' end
  ||':'||(x->>'class')||':'||(x->>'status')||case when x->'rawAuthority'<>'null'::jsonb then ':raw' else '' end,' '
  order by case x->>'subjectId' when pg_temp.self(pg_temp.acct('1'))::text then 1 when pg_temp.self(pg_temp.acct('2'))::text then 2
   when pg_temp.self(pg_temp.acct('3'))::text then 3 else 4 end)
 from jsonb_array_elements(private.account_archive_complete_capture_v1(pg_temp.origin(p))->'permissions') x $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin
 execute p_sql into v;
 return coalesce(v,'null');
exception when insufficient_privilege then return 'not_found';
end $$;
-- The recipient, raw and source authorities the build re-asks, for A over B's record.
create function pg_temp.authorities(p text) returns text language sql as $$
 select concat_ws(' ',
  'recipient:'||pg_temp.try(format('select (private.account_archive_export_recipient_v1(%L,%L) is not null)::text',
   pg_temp.origin(p),pg_temp.self(pg_temp.acct('2')))),
  'raw:'||pg_temp.try(format('select (private.account_archive_raw_authority_v1(%L,%L) is not null)::text',
   pg_temp.origin(p),pg_temp.self(pg_temp.acct('2')))),
  'source:'||pg_temp.try(format('select (private.account_archive_raw_source_v1(%L,%L) is not null)::text',
   pg_temp.origin(p),'d1570000-0000-4000-8000-000000000040'))) $$;

-- 0. The migration -----------------------------------------------------------------
select is((select string_agg(x.label||' '||md5(pg_get_functiondef(p.oid))||' '||p.proacl::text||' '||p.provolatile::text,' | ' order by x.label)
 from (values
  ('a','private.account_archive_complete_subjects_v1(jsonb)'),
  ('b','private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb)'),
  ('c','private.account_archive_export_recipient_v1(jsonb,uuid)'),
  ('d','private.account_archive_raw_authority_v1(jsonb,uuid)')) x(label,signature)
 join pg_proc p on p.oid=x.signature::regprocedure),
 'a f63e4c494c07b5c2055a6570df1f4a13 {postgres=X/postgres} v | b 6982e98c2b441d2e7eda98eabd5a002d {postgres=X/postgres} v | '
 ||'c 8ca5bc23ad2ae076b417ef39f414dd99 {postgres=X/postgres} v | d 4100fff709c7e10d486d135b5f418a6d {postgres=X/postgres} v',
 'the four archive bodies carry their pinned successors with unchanged privileges and volatility');
select ok(not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r,
  unnest(array['private.account_archive_complete_subjects_v1(jsonb)','private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb)',
   'private.account_archive_export_recipient_v1(jsonb,uuid)','private.account_archive_raw_authority_v1(jsonb,uuid)']) f
  where has_function_privilege(r,f,'execute')),'no API role reaches any of the four, as before');

-- 1. During the hold -----------------------------------------------------------------
select is(pg_temp.covers('1'),'A:ordinary:permitted',
 '(hold) A''s archive covers A''s own record only: B''s record is not among it, as with no grant from B');
select is(pg_temp.authorities('1'),'recipient:not_found raw:not_found source:not_found',
 '(hold) the recipient, raw and source authorities refuse A as they do with no grant');
-- The same archive as if B had granted A nothing: B's two grants removed in a
-- rolled-back savepoint. The records, their dispositions, the files and every
-- member and history receipt are the same. A's own class of grants received
-- still counts B's two grants (ids, revisions, status and times; no purpose,
-- no record), as it counts every grant A holds; it is not B's data.
create function pg_temp.what_is_read(p text) returns jsonb language sql as $$
 select c->'permissions'||jsonb_build_array(c->'scopePartitions',c->'files',c->'memberCensus',c->'history')
 from (select private.account_archive_complete_capture_v1(pg_temp.origin(p)) c) x $$;
create temporary table held_read as select pg_temp.what_is_read('1') value,
 private.account_archive_complete_capture_v1(pg_temp.origin('1'))#>'{classCensus,classes}' classes;
savepoint no_grant;
set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check deferred;
create temporary table b_to_a as select g.grant_id from public.purpose_grants g join public.directional_grants d using(grant_id)
 where g.target_id=pg_temp.self(pg_temp.acct('2')) and d.recipient_account_id=pg_temp.acct('1');
delete from public.purpose_grant_nonces where grant_id in(select grant_id from b_to_a);
delete from public.directional_grants where grant_id in(select grant_id from b_to_a);
delete from public.purpose_grants where grant_id in(select grant_id from b_to_a);
select is(pg_temp.what_is_read('1'),(select value from held_read),
 '(hold) what A''s archive reads is exactly what it reads when B has granted A nothing');
select is((select string_agg(h->>'kind'||' '||(h->>'rows')||'/'||(n->>'rows'),',') from jsonb_array_elements((select classes from held_read)) h
  join jsonb_array_elements(private.account_archive_complete_capture_v1(pg_temp.origin('1'))#>'{classCensus,classes}') n
   on n->>'kind'=h->>'kind' where h is distinct from n),'directional_grants 2/0',
 '(hold) the one difference is A''s own class of grants received, which still counts B''s two grants');
rollback to no_grant;
select is((select string_agg(distinct key,',' order by key)||' '||count(distinct r.projected_id)||' '||coalesce(max(r.projected_subject::text),'none')
  from private.export_account_class_projection_v1(pg_temp.acct('1'),array[pg_temp.self(pg_temp.acct('1'))],'directional_grants') r,
  jsonb_object_keys(r.projected_row) key),
 'created_at,direction,ended_at,grant_id,grant_revision,relationship_or_pair_revision,status 2 none',
 '(hold) those two rows carry no purpose and name no record');
select is(pg_temp.try(format('select (private.account_archive_complete_subject_authority_v1(%L,%L,'
  ||'private.account_archive_legacy_capture_v1(%L))-''authority'')::text',pg_temp.origin('1'),pg_temp.self(pg_temp.acct('2')),pg_temp.origin('1'))),
 jsonb_build_object('subjectId',pg_temp.self(pg_temp.acct('2')),'class','consent-covered','status','excluded',
  'reason','export-recipient-consent-required','rawAuthority',null)::text,
 '(hold) asked about B''s record, A''s archive excludes it with the reason a missing export permission gives, and no raw authority');
select is(pg_temp.covers('3'),'B:consent-covered:permitted:raw C:ordinary:permitted',
 '(hold) C, whom B also shares with, gets B''s record with its raw file');
select is(pg_temp.authorities('3'),'recipient:true raw:true source:true','(hold) and every authority answers C');
select is(pg_temp.covers('2'),'B:ordinary:permitted B-invited:ordinary:permitted','(hold) B''s own archive is unaffected');
-- A record listed through a family pair (A's own Portrait choice makes one) is
-- excluded, exactly as one whose person gave no export permission.
savepoint pair;
update public.subjects set independent_login_at=clock_timestamp() where id=pg_temp.self(pg_temp.acct('1'));
select isnt(public.grant_directional_purpose_v1(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('1')),pg_temp.principal(pg_temp.acct('2')),
 'family.portrait','consent.share-with-adult',1,'d157-a-portrait-00000000000000'),null,'(hold, pair) A turns on Portrait with B');
select is(pg_temp.covers('1'),'A:ordinary:permitted B:consent-covered:excluded',
 '(hold, pair) B''s record, listed through the pair, is excluded and nothing raw is read');
rollback to pair;
-- With the native archive off, the preserved account export refuses an account
-- that receives grants, as it always has; it reads nothing they share.
savepoint native_off;
update private.account_archive_r2_configuration set enabled=false;
select throws_ok($$select private.export_account_owned_capture_v1(pg_temp.origin('1'),'account',pg_temp.acct('1'))$$,
 '0A000','export_partition_projection_unavailable','(hold, native off) the preserved export refuses A, as before');
rollback to native_off;

-- 2. Released by the second notice, with nothing else done -----------------------------
select pg_temp.age(interval '72 hours');
select public.run_due_adult_acceptance_notices_v1();
select is(pg_temp.covers('1'),'A:ordinary:permitted','(72 h) queued but not yet accepted: still A''s own record only');
select is(pg_temp.deliver('adult-acceptance-second-notice'),'sent','(72 h) the second notice is accepted by the provider');
select is(pg_temp.covers('1'),'A:ordinary:permitted B:consent-covered:permitted:raw',
 '(released) A''s archive covers B''s record, its export permission and its raw file, with no job run');
select is(pg_temp.authorities('1'),'recipient:true raw:true source:true','(released) every authority answers A');

-- 3. An archive requested while permitted, from 30 days until the reminder ------------
select pg_temp.age(interval '30 days'-interval '72 hours'-interval '1 minute');
create temporary table job(origin jsonb,capture jsonb,created jsonb,attempt uuid,before jsonb);
insert into job(origin,attempt) values(pg_temp.origin('1'),'d1570000-0000-4000-8000-000000000070');
update job set capture=public.export_archive_request_v1('capture',origin,'account',pg_temp.acct('1')),
 before=private.account_archive_complete_capture_v1(origin);
update job set created=public.export_archive_request_v1('create',origin,'account',pg_temp.acct('1'),
 jsonb_build_object('envelope',jsonb_build_object('routeId','api.export','origin','authenticated','principalId',capture->>'principalId',
  'targetKind','account','targetId',origin->'accountId','exportContract','account-export-v1','originBinding',capture->>'originBinding',
  'authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),'operation','create',
  'nonceHash',encode(extensions.digest(convert_to('d157-create','UTF8'),'sha256'),'hex'),
  'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000),
  'exportCookieHash',encode(extensions.digest(convert_to('d157-cookie','UTF8'),'sha256'),'hex')),repeat('c',64));
select lives_ok('set constraints all immediate','(29 d 23 h 59 m) A requests an archive while B''s export is permitted');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from job;
create function pg_temp.build() returns text language sql as $$
 select pg_temp.try(format('select public.export_archive_account_complete_v1(''context'',%L,%L,%L)->>''version''',
  (created->>'exportId')::uuid,attempt,capture->>'authorityReceipt')) from job $$;
create function pg_temp.current() returns text language sql as $$
 select pg_temp.try(format('select (private.export_archive_current_v1(%L,%L) is not null)::text',
  (created->>'exportId')::uuid,capture->>'authorityReceipt')) from job $$;
select ok((select capture->'subjectPartitions' @> jsonb_build_array(pg_temp.self(pg_temp.acct('1')),pg_temp.self(pg_temp.acct('2')))
  and jsonb_array_length(capture->'subjectPartitions')=2 from job),
 '(29 d 23 h 59 m) the request covers A''s record and B''s');
select is(pg_temp.build()||' '||pg_temp.current(),'account-complete-members-v1 true',
 '(29 d 23 h 59 m) the archive builds and is current');
select pg_temp.age(interval '1 minute');
select is(pg_temp.covers('1'),'A:ordinary:permitted','(30 d) from 30 days A''s archive covers A''s own record only again');
select is(pg_temp.authorities('1'),'recipient:not_found raw:not_found source:not_found','(30 d) and every authority refuses A');
select is(public.export_archive_request_v1('capture',pg_temp.origin('1'),'account',pg_temp.acct('1'))->'subjectPartitions',
 jsonb_build_array(pg_temp.self(pg_temp.acct('1'))),'(30 d) a new request covers A''s own record only');
select is(pg_temp.build(),'not_found','(30 d) the archive requested a minute earlier can no longer be built');
select is(pg_temp.current(),'not_found',
 '(30 d) nor delivered: readiness, delivery, every manifest page and every chunk ask this currentness and are refused');
select is(pg_temp.covers('3'),'B:consent-covered:permitted:raw C:ordinary:permitted','(30 d) C is unaffected');
select public.run_due_adult_acceptance_notices_v1();
select is(pg_temp.current(),'not_found','(30 d) the reminder queued but not yet accepted: still refused');
select is(pg_temp.deliver('adult-revocation-renotice'),'sent','(30 d) the reminder is accepted by the provider');
select is(private.account_archive_complete_capture_v1((select origin from job)),(select before from job),
 '(reminded) A''s capture is the one the archive was requested from, byte for byte');
select is(pg_temp.current()||' '||pg_temp.build(),'true account-complete-members-v1',
 '(reminded) the same archive is current and builds again, with no job run');

select * from finish();
rollback;
