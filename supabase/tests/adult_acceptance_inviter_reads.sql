-- D-156: the 72-hour hold and the 30-day reminder cover an inviter's reads of
-- the invited adult's own record (20261122110000_adult_acceptance_inviter_reads.sql;
-- owner decision of 22 November 2026, "The 72-hour hold covers an inviter's
-- reads of the invited adult's own record", docs/protocol/decisions.md).
--
-- Proves, on synthetic rows only:
--   * during the hold the inviter reads nothing the new adult shares with
--     them: the shared reports and their confirmation, ancestry, Health
--     picture, Portrait, the Family group Copilot and the one-record Copilot
--     each answer exactly as they answer with no grant, and the Family graph's
--     door names the record; nothing says why;
--   * the adult's own use of their record is not held (their own saved report,
--     their own view of the pair in Health picture and Portrait, what the
--     inviter shares with them), and a third account they share with reads
--     normally, as does the inviter for anyone else's record;
--   * at 71 hours 59 minutes, at 72 hours with the second notice unsent and
--     with it queued but not accepted, the hold stands; once the provider has
--     accepted it every reader opens with nothing else done; a notice that
--     ends unsent never releases;
--   * from 30 days until the reminder is accepted the inviter reads nothing
--     again, their earlier Copilot conversation about the adult is unreadable
--     and unlisted with nothing deleted, and every read resumes once the
--     reminder is accepted, with no job run;
--   * an existing account is never held by the 72-hour hold (only by the
--     reminder from 30 days, which the decision gives every acceptance); an
--     acceptance recorded before 20261120120000 keeps the creation-time rule;
--   * a Path B record is unchanged, and its uploader is never this case;
--   * the patched bodies carry their pinned successors and privileges.
-- Time is moved only by ageing each synthetic acceptance's own rows. Everything
-- rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

-- Path B, for the case it must not change: 0b5e…01 uploads, 0b5e…04 confirms.
\ir fixtures/path_b_source_setup.inc

-- People ---------------------------------------------------------------------------
-- A invites; B is invited and signs up after the invitation; C is a third
-- account B shares with; E is invited with an account that already existed;
-- F is invited, signs up after, and its second notice never goes.
insert into auth.users(id,email,email_confirmed_at,created_at)
 select ('d1560000-0000-4000-8000-00000000000'||n)::uuid,'d156-'||n||'@e2e.local',now()-interval '1 day',now()-interval '1 day'
 from unnest(array['1','2','3','4','5']) n;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('d1560000-0000-4000-8000-00000000001'||n)::uuid,('d1560000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1'
 from unnest(array['1','2','3','4','5']) n;
update public.profiles set date_of_birth=date '1990-01-01' where id::text like 'd1560000-%';
create function pg_temp.acct(p text) returns uuid language sql immutable as
 $$ select ('d1560000-0000-4000-8000-00000000000'||p)::uuid $$;
create function pg_temp.sess(p text) returns uuid language sql immutable as
 $$ select ('d1560000-0000-4000-8000-00000000001'||p)::uuid $$;
create function pg_temp.self(p_account uuid) returns uuid language sql as
 $$ select id from public.subjects where subject_account_id=p_account and subject_class='self' $$;
-- The account principal on that account's own record: the Family recipient.
create function pg_temp.principal(p_account uuid) returns uuid language sql as $$
 select sp.id from public.subject_principals sp join public.subjects s on s.id=sp.subject_id
 where sp.account_id=p_account and s.subject_class='self' and sp.principal_kind='account_subject' and sp.status='active' $$;

-- A's Path A invitations, each opened through its mailed token and accepted.
create temporary table pa(name text primary key,subject_id uuid,invitation_id uuid);
create function pg_temp.invite_and_accept(p_name text,p_letter text,p_account text,p_new boolean) returns uuid
language plpgsql as $$
declare r record; d record; v_subject uuid;
begin
 select * into r from public.create_adult_subject_invitation_v1(pg_temp.acct('1'),decode('00112233445566778899aabbccddeeff','hex'),
  repeat(p_letter,64),encode(extensions.digest(convert_to('d156-idem:'||p_name,'UTF8'),'sha256'),'hex'),true,
  p_quota_keys=>pg_temp.invitation_quota_keys());
 update public.mail_outbox set state='invalidated' where state in ('queued','claimed') and token_target_id is distinct from r.invitation_id;
 select * into d from public.claim_mail_outbox();
 if (select count(*) from public.activate_rights_session_v1(encode(extensions.digest(convert_to(d.delivery_token,'UTF8'),'sha256'),'hex'),
   repeat(p_letter,64),'d156-open-'||p_name||'aaaaaaaaaaaaaaa'))<>1 then raise exception 'path a setup failed for %',p_name; end if;
 -- An account that signs up after the invitation was sent.
 if p_new then update auth.users set created_at=clock_timestamp() where id=pg_temp.acct(p_account); end if;
 v_subject:=public.accept_adult_subject_invitation_v1(repeat(p_letter,64),'d156-accept-'||p_name||'aaaaaaaaaaaaa',pg_temp.acct(p_account),
  pg_temp.sess(p_account),jsonb_build_object('1',repeat(p_letter,64)),decode(repeat('5a',28),'hex'));
 insert into pa values(p_name,v_subject,r.invitation_id);
 return v_subject;
end $$;
create function pg_temp.inv(p_name text) returns uuid language sql as $$ select invitation_id from pa where name=p_name $$;
-- Time passing for one acceptance: its acceptance and its fixed deadlines move back together.
create function pg_temp.age(p_name text,p_by interval) returns void language sql as $$
 update public.subject_invitations set accepted_at=accepted_at-p_by,terminal_at=terminal_at-p_by where id=pg_temp.inv(p_name);
 update public.retention_rows set fixed_deadline=fixed_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv(p_name);
 update public.retention_due_phases set phase_deadline=phase_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv(p_name);
$$;
create function pg_temp.notices(p_name text,p_kind text) returns bigint language sql as $$
 select count(*) from private.invitation_terminal_notices where invitation_id=pg_temp.inv(p_name) and notice_kind=p_kind $$;
-- The terminal mail worker, as src/lib/embryos/invitation-terminal-mail.ts drives it.
create function pg_temp.deliver(p_name text,p_kind text) returns text language plpgsql as $$
declare c record; n integer;
begin
 for n in 1..50 loop
  select * into c from public.claim_invitation_terminal_mail_v1();
  if c.outbox_id is null then return 'none'; end if;
  if c.notice_kind=p_kind and exists(select 1 from public.mail_outbox m where m.id=c.outbox_id and m.target_id=pg_temp.inv(p_name)) then
   if not public.authorize_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal) then return 'refused'; end if;
   perform public.complete_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal,true,
    encode(extensions.digest(convert_to('provider:'||c.outbox_id::text,'UTF8'),'sha256'),'hex'));
   return 'sent';
  end if;
 end loop;
 return 'none';
end $$;
create function pg_temp.held(p_reader uuid,p_subject uuid) returns boolean language sql as
 $$ select private.adult_acceptance_inviter_held_v1(p_reader,p_subject) $$;

select isnt(pg_temp.invite_and_accept('b','b','2',true),null,'(B) an adult who signs up after A''s invitation accepts it');
select isnt(pg_temp.invite_and_accept('e','e','4',false),null,'(E) an adult whose account predates A''s invitation accepts it');
select isnt(pg_temp.invite_and_accept('f','f','5',true),null,'(F) another adult who signs up after A''s invitation accepts it');
select is(public.adult_subject_acceptance_origin_v1(pg_temp.acct('2'),(select subject_id from pa where name='b'))||' '||
 public.adult_subject_acceptance_origin_v1(pg_temp.acct('4'),(select subject_id from pa where name='e')),
 'created_from_this_invitation existing_account','each acceptance recorded its origin (20261120120000)');

-- B's own record: a real prepared source and both own report layers ---------------------
update public.subjects set independent_login_at=clock_timestamp(),portrait_acknowledged_at=clock_timestamp()
 where id in (pg_temp.self(pg_temp.acct('1')),pg_temp.self(pg_temp.acct('2')));
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),pg_temp.acct(who),pg_temp.sess(who),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from (values('a','2'),('b','2'),('c','1'),('d','1')) n(letter,who);
create function pg_temp.sign_own(who text,artifact text,statement text,nonce text) returns jsonb language sql as $$
 select to_jsonb(public.sign_own_upload_artifact_v1(pg_temp.acct(who),pg_temp.sess(who),pg_temp.self(pg_temp.acct(who)),artifact,1,
 (select body_sha256 from public.consent_artifacts where artifact_key=artifact and version=1),array[statement],1,1,1,1,1,nonce)); $$;
select pg_temp.sign_own('2','disclosure.insurance-and-discrimination','understood',repeat('a',64));
select pg_temp.sign_own('2','consent.upload-self','own-adult-dna',repeat('b',64));
select pg_temp.sign_own('1','disclosure.insurance-and-discrimination','understood',repeat('c',64));
select pg_temp.sign_own('1','consent.upload-self','own-adult-dna',repeat('d',64));
insert into storage.objects(id,bucket_id,name,metadata) values('d1560000-0000-4000-8000-000000000020',
 'genomes','d1560000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('d1560000-0000-4000-8000-000000000040',pg_temp.acct('2'),pg_temp.self(pg_temp.acct('2')),
 'd1560000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'d1560000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('d1560000-0000-4000-8000-000000000020','d1560000-0000-4000-8000-000000000030','genomes',
 'd1560000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 pg_temp.acct('2'),pg_temp.sess('2'),'d1560000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,pg_temp.acct('2'),pg_temp.sess('2'),'d1560000-0000-4000-8000-000000000040',
 (select (receipt->>'claim')::uuid from preparation),payload); $$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('d156-poly-fixture','basic-traits','Fixture estimate','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('D156-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
select public.grant_own_report_purpose_v1(pg_temp.acct('2'),pg_temp.sess('2'),pg_temp.self(pg_temp.acct('2')),
 public.own_report_context_v1(pg_temp.acct('2'),pg_temp.sess('2'),pg_temp.self(pg_temp.acct('2'))),'reports.polygenic',
 (select version from public.consent_artifacts where artifact_key='consent.own-polygenic' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.own-polygenic' and superseded_at is null),
 repeat('e',64),clock_timestamp()+interval '9 minutes');
create function pg_temp.generate() returns jsonb language plpgsql as $$
declare claim jsonb; t public.report_templates%rowtype;
begin
 select * into t from public.report_templates where slug='d156-poly-fixture';
 claim:=public.own_report_generation_with_mail_v1('begin',pg_temp.acct('2'),pg_temp.sess('2'),
  'd1560000-0000-4000-8000-000000000040','reports.polygenic');
 return public.own_report_generation_with_mail_v1('complete',pg_temp.acct('2'),pg_temp.sess('2'),
  'd1560000-0000-4000-8000-000000000040','reports.polygenic',(claim->>'claim')::uuid,
  jsonb_build_object('reports',jsonb_build_array(jsonb_build_object('slug',t.slug,'covered',true,'conflictingRsids','[]'::jsonb,
   'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved","strandFlipped":false}}]'::jsonb,
   'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,
    'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,
    'estimate_kind',t.estimate_kind)))),
  'prs','[{"pgs_id":"D156-FIXTURE","raw_score":0,"coverage":1,"matched":1}]'::jsonb,
  'readyMail',jsonb_build_object('contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),
   'dashboardUrl','https://example.invalid/genome/me/reports')));
end $$;
select is(pg_temp.generate()->>'status','complete',
 '(hold) B''s own analysis of their own record runs during the hold, through the real wrapper');

-- A's own local Copilot: the model recipient of A's conversations.
\ir fixtures/own_copilot_synthetic_settings.inc
select public.save_own_copilot_settings_v1(pg_temp.acct('1'),pg_temp.sess('1'),
 pg_temp.synthetic_copilot_settings('synthetic-model','local'),null,repeat('b',64),null);
create temporary table a_presentation as select public.own_copilot_presentation_v1(pg_temp.acct('1'),pg_temp.sess('1'),
 pg_temp.self(pg_temp.acct('1'))) value;
select public.grant_own_copilot_v1(pg_temp.acct('1'),pg_temp.sess('1'),pg_temp.self(pg_temp.acct('1')),
 (select value->'snapshot' from a_presentation),(select value->'artifacts' from a_presentation),
 repeat('9',64),clock_timestamp()+interval '9 minutes');
create temporary table a_provider as select public.own_copilot_authority_v1(pg_temp.acct('1'),pg_temp.sess('1'),
 pg_temp.self(pg_temp.acct('1'))) value;

-- What B shares, through the real doors, within the hold -----------------------------
create function pg_temp.grants(who text,purpose text,recipient text,nonce text) returns uuid language sql as $$
 select public.grant_directional_purpose_v1(pg_temp.acct(who),pg_temp.self(pg_temp.acct(who)),
 pg_temp.principal(pg_temp.acct(recipient)),purpose,'consent.share-with-adult',1,nonce); $$;
create function pg_temp.b_shares(recipient text,nonce text) returns uuid language sql as $$
 select public.grant_family_report_purpose_v1(pg_temp.acct('2'),pg_temp.sess('2'),pg_temp.self(pg_temp.acct('2')),
 pg_temp.principal(pg_temp.acct(recipient)),pg_temp.acct(recipient),'reports.polygenic',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,
 public.family_report_grant_presentation_v1(pg_temp.acct('2'),pg_temp.sess('2'),pg_temp.self(pg_temp.acct('2')),pg_temp.acct(recipient))); $$;
select isnt(pg_temp.b_shares('1','d156-share-a-estimate-0000000000'),null,'(hold) B shares the estimate layer with A from B''s own account');
select isnt(pg_temp.grants('2','copilot.local','1','d156-share-a-copilot-00000000000'),null,'(hold) B lets A''s Copilot read it');
select isnt(pg_temp.grants('2','family.heritability','1','d156-share-a-heritability-000000'),null,'(hold) B turns on Health picture with A');
select isnt(pg_temp.grants('2','ancestry','1','d156-share-a-ancestry-0000000000'),null,'(hold) B shares ancestry with A');
select isnt(pg_temp.grants('2','family.portrait','1','d156-share-a-portrait-0000000000'),null,'(hold) B turns on Portrait with A');
select isnt(pg_temp.grants('1','family.heritability','2','d156-share-b-heritability-000000'),null,'A turns on Health picture with B');
select isnt(pg_temp.grants('1','family.portrait','2','d156-share-b-portrait-0000000000'),null,'A turns on Portrait with B');
select isnt(pg_temp.b_shares('3','d156-share-c-estimate-0000000000'),null,'(hold) B shares the estimate layer with C too');
select isnt(pg_temp.grants('2','copilot.local','3','d156-share-c-copilot-00000000000'),null,'(hold) and Copilot');
select isnt(pg_temp.grants('2','family.heritability','3','d156-share-c-heritability-000000'),null,'(hold) and Health picture');
select isnt(pg_temp.grants('4','reports.polygenic','1','d156-share-e-estimate-0000000000'),null,'E shares an estimate permission with A');
select isnt(pg_temp.grants('3','reports.polygenic','1','d156-share-ca-estimate-000000000'),null,'C shares an estimate permission with A');
create temporary table pair as select id from public.family_pairs
 where pg_temp.self(pg_temp.acct('1')) in (subject_a_id,subject_b_id) and pg_temp.self(pg_temp.acct('2')) in (subject_a_id,subject_b_id);
select is((select status from public.family_pairs where id=(select id from pair)),'current','A and B''s Portrait pair is current');

-- Every reader, for one viewer, as one line. 'no' is exactly what each answers
-- with no grant: the recipient's not_found, a null pair, an empty group, the
-- one-record scope's permission-missing.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin
 execute p_sql into v;
 return coalesce(v,'no');
exception when insufficient_privilege then return 'no';
end $$;
create function pg_temp.reads(p_viewer text,p_counterpart text) returns text language sql as $$
 select concat_ws(' ',
  'reports:'||pg_temp.try(format('select jsonb_array_length(public.family_shared_report_results_v1(%L,%L,%L,''reports.polygenic'')->''sources'')::text',
   pg_temp.acct(p_viewer),pg_temp.sess(p_viewer),pg_temp.self(pg_temp.acct(p_counterpart)))),
  'ancestry:'||pg_temp.try(format('select (private.family_ancestry_recipient_v1(%L,%L,%L,''ancestry'') is not null)::text',
   pg_temp.acct(p_viewer),pg_temp.sess(p_viewer),pg_temp.self(pg_temp.acct(p_counterpart)))),
  'health:'||pg_temp.try(format('select (private.health_picture_context_v1(%L,%L,%L,jsonb_build_array(jsonb_build_object(''subjectId'',%L,''accountId'',%L))) is not null)::text',
   pg_temp.acct(p_viewer),pg_temp.sess(p_viewer),pg_temp.self(pg_temp.acct(p_viewer)),pg_temp.self(pg_temp.acct(p_counterpart)),pg_temp.acct(p_counterpart))),
  'portrait:'||pg_temp.try(format('select nullif((private.family_portrait_authority_v1(%L,%L,%L,%L) is not null)::text,''false'')',
   pg_temp.acct(p_viewer),pg_temp.sess(p_viewer),(select id from pair),pg_temp.acct(p_counterpart))),
  'group:'||pg_temp.try(format('select nullif((select count(*) from jsonb_array_elements(public.family_copilot_scope_v1(%L,%L)) m where m->>''subjectId''=%L),0)::text',
   pg_temp.acct(p_viewer),pg_temp.sess(p_viewer),pg_temp.self(pg_temp.acct(p_counterpart)))),
  'subject:'||pg_temp.try(format('select nullif(public.subject_copilot_scope_v1(%L,%L,%L)->>''state'',''permission-missing'')',
   pg_temp.acct(p_viewer),pg_temp.sess(p_viewer),pg_temp.self(pg_temp.acct(p_counterpart)))),
  'graph:'||case when pg_temp.self(pg_temp.acct(p_counterpart))=any(public.adult_acceptance_inviter_held_subjects_v1(pg_temp.acct(p_viewer),
   array[pg_temp.self(pg_temp.acct(p_counterpart))])) then 'no' else 'yes' end)
$$;
create function pg_temp.c_reads() returns text language sql as $$
 select concat_ws(' ',
  'reports:'||pg_temp.try(format('select jsonb_array_length(public.family_shared_report_results_v1(%L,%L,%L,''reports.polygenic'')->''sources'')::text',
   pg_temp.acct('3'),pg_temp.sess('3'),pg_temp.self(pg_temp.acct('2')))),
  'group:'||pg_temp.try(format('select nullif((select count(*) from jsonb_array_elements(public.family_copilot_scope_v1(%L,%L)) m where m->>''subjectId''=%L),0)::text',
   pg_temp.acct('3'),pg_temp.sess('3'),pg_temp.self(pg_temp.acct('2')))),
  'subject:'||pg_temp.try(format('select nullif(public.subject_copilot_scope_v1(%L,%L,%L)->>''state'',''permission-missing'')',
   pg_temp.acct('3'),pg_temp.sess('3'),pg_temp.self(pg_temp.acct('2')))),
  'graph:'||case when pg_temp.self(pg_temp.acct('2'))=any(public.adult_acceptance_inviter_held_subjects_v1(pg_temp.acct('3'),
   array[pg_temp.self(pg_temp.acct('2'))])) then 'no' else 'yes' end)
$$;
create function pg_temp.nothing() returns text language sql immutable as
 $$ select 'reports:no ancestry:no health:no portrait:no group:no subject:no graph:no' $$;
create function pg_temp.everything() returns text language sql immutable as
 $$ select 'reports:1 ancestry:true health:true portrait:true group:1 subject:ready graph:yes' $$;
create function pg_temp.third() returns text language sql immutable as
 $$ select 'reports:1 group:1 subject:ready graph:yes' $$;
-- The confirmation the Family pages make last, against receipts captured earlier.
create function pg_temp.confirm(p_expected jsonb) returns boolean language sql as $$
 select public.confirm_family_shared_report_results_v1(pg_temp.acct('1'),pg_temp.sess('1'),pg_temp.self(pg_temp.acct('2')),'content',p_expected) $$;

-- 0. The migration -----------------------------------------------------------------
select is((select string_agg(x.label||' '||md5(pg_get_functiondef(p.oid))||' '||p.proacl::text||' '||p.provolatile::text,' | ' order by x.label)
 from (values
  ('a','private.family_report_recipient_v1(uuid,uuid,uuid,text)'),
  ('b','private.family_ancestry_recipient_v1(uuid,uuid,uuid,text)'),
  ('c','private.health_picture_direction_v1(uuid,uuid,uuid,uuid,text)'),
  ('d','private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)'),
  ('e','private.family_copilot_turn_state_v1(uuid,uuid,uuid)')) x(label,signature)
 join pg_proc p on p.oid=x.signature::regprocedure),
 'a 5e36eec0ee7f83911fd0966730081145 {postgres=X/postgres} v | b 9ba008dab0144ba55a6ac57fb68f7172 {postgres=X/postgres} v | '
 ||'c d496bc699608053982ded60110a64628 {postgres=X/postgres} v | d 437d6400ed4b83a6cb1da08be2195abf {postgres=X/postgres} v | '
 ||'e 3ed921e9d872a5c557389a126a1af7ff {postgres=X/postgres} s',
 'the five readers carry their pinned successors with unchanged privileges and volatility');
select is((select string_agg(p.oid::regprocedure::text||' '||p.proacl::text||' '||p.provolatile::text||' '||p.prosecdef::text||' '||
  array_to_string(p.proconfig,','),' | ' order by p.oid::regprocedure::text)
 from pg_proc p where p.oid in (to_regprocedure('private.adult_acceptance_inviter_held_v1(uuid,uuid)'),
  to_regprocedure('public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[])'))),
 'adult_acceptance_inviter_held_subjects_v1(uuid,uuid[]) {postgres=X/postgres,service_role=X/postgres} s true search_path="" | '
 ||'private.adult_acceptance_inviter_held_v1(uuid,uuid) {postgres=X/postgres} s true search_path=""',
 'the question is owner-only; the graph''s door is service-only; both stable definers with an empty search path');
select ok(not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) r
  where has_function_privilege(r,'public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[])','execute')
   or has_function_privilege(r,'private.adult_acceptance_inviter_held_v1(uuid,uuid)','execute'))
 and not has_function_privilege('service_role','private.adult_acceptance_inviter_held_v1(uuid,uuid)','execute'),
 'no API role reaches the question, and no role but the service role reaches the door');
select throws_ok($$select public.adult_acceptance_inviter_held_subjects_v1(null,array[gen_random_uuid()])$$,'22023','invalid_request',
 'the door refuses a missing account');
select throws_ok($$select public.adult_acceptance_inviter_held_subjects_v1(gen_random_uuid(),array(select gen_random_uuid() from generate_series(1,1001)))$$,
 '22023','invalid_request','the door is bounded');
select is(public.adult_acceptance_inviter_held_subjects_v1(pg_temp.acct('1'),
  array[pg_temp.self(pg_temp.acct('2')),null,pg_temp.self(pg_temp.acct('2')),pg_temp.self(pg_temp.acct('4')),pg_temp.self(pg_temp.acct('3'))]),
 array[pg_temp.self(pg_temp.acct('2'))],'the door names each held record once, and only those');

-- 1. During the hold -----------------------------------------------------------------
select is(pg_temp.reads('1','2'),pg_temp.nothing(),
 '(hold) A, who invited B, reads nothing B shares: every reader answers as with no grant');
select is(pg_temp.c_reads(),pg_temp.third(),'(hold) C, whom B also shares with, reads normally: the decision holds the inviter');
select ok(pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('2'))) and not pg_temp.held(pg_temp.acct('3'),pg_temp.self(pg_temp.acct('2')))
 and not pg_temp.held(pg_temp.acct('2'),pg_temp.self(pg_temp.acct('2'))) and not pg_temp.held(pg_temp.acct('2'),pg_temp.self(pg_temp.acct('1')))
 and not pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('3'))) and not pg_temp.held(null,pg_temp.self(pg_temp.acct('2')))
 and not pg_temp.held(pg_temp.acct('1'),(select subject_id from pa where name='b')),
 '(hold) the question holds A for B''s own record only: not C, not B, not B reading A, not A reading C, not B''s invited record');
select isnt(public.own_captured_report_v1(pg_temp.acct('2'),pg_temp.sess('2'),pg_temp.self(pg_temp.acct('2')),
  'd1560000-0000-4000-8000-000000000040','d156-poly-fixture',null),null,'(hold) B reads their own saved report');
select is(pg_temp.try(format('select (private.health_picture_context_v1(%L,%L,%L,jsonb_build_array(jsonb_build_object(''subjectId'',%L,''accountId'',%L))) is not null)::text',
  pg_temp.acct('2'),pg_temp.sess('2'),pg_temp.self(pg_temp.acct('2')),pg_temp.self(pg_temp.acct('1')),pg_temp.acct('1'))),'true',
 '(hold) B''s own Health picture beside A opens: B''s own use of their record is not held');
select is(private.family_portrait_authority_v1(pg_temp.acct('2'),pg_temp.sess('2'),(select id from pair),pg_temp.acct('1')) is not null,true,
 '(hold) B''s own view of the Portrait pair with A opens');
select isnt(private.health_picture_direction_v1(pg_temp.acct('2'),pg_temp.sess('2'),pg_temp.acct('2'),pg_temp.self(pg_temp.acct('1')),'family.heritability'),
 null,'(hold) what A shares with B, B reads');
create function pg_temp.reads_report(p_viewer uuid,p_session uuid,p_subject uuid) returns text language sql as $$
 select pg_temp.try(format('select (private.family_report_recipient_v1(%L,%L,%L,''reports.polygenic'') is not null)::text',
  p_viewer,p_session,p_subject)) $$;
select is(pg_temp.reads_report(pg_temp.acct('1'),pg_temp.sess('1'),pg_temp.self(pg_temp.acct('3'))),'true',
 '(hold) A reads what C shares: the hold is about B''s record alone');
select is(pg_temp.reads_report(pg_temp.acct('1'),pg_temp.sess('1'),pg_temp.self(pg_temp.acct('4'))),'true',
 '(existing) A reads what E shares: an account that predates the invitation has no 72-hour hold');
select ok(not pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('4'))),'(existing) E''s record is not held for A');

-- 2. The hold ends only with the second notice ----------------------------------------
select pg_temp.age('b',interval '71 hours 59 minutes');
select is(pg_temp.reads('1','2'),pg_temp.nothing(),'(71 h 59 m) A still reads nothing B shares');
select pg_temp.age('b',interval '1 minute');
select is(pg_temp.notices('b','adult-acceptance-second-notice'),0::bigint,'(72 h) the second notice is not yet queued');
select is(pg_temp.reads('1','2'),pg_temp.nothing(),'(72 h) with the second notice unsent, A still reads nothing');
select public.run_due_adult_acceptance_notices_v1();
select is(pg_temp.notices('b','adult-acceptance-second-notice'),1::bigint,'(72 h) the retention job queues it once');
select is(pg_temp.reads('1','2'),pg_temp.nothing(),'(72 h) queued but not accepted by the provider, A still reads nothing');
select is(pg_temp.deliver('b','adult-acceptance-second-notice'),'sent','(72 h) the worker sends it and the provider accepts it');
select is(pg_temp.reads('1','2'),pg_temp.everything(),
 '(released) A reads what B shares through every reader, with no job run and nothing else changed');
select is(pg_temp.c_reads(),pg_temp.third(),'(released) C still reads normally');

-- A's conversation about B, begun once the hold has ended.
create function pg_temp.chat(op text,chat uuid,payload jsonb) returns jsonb language sql as $$
 select public.subject_copilot_chat_v1(op,pg_temp.acct('1'),pg_temp.sess('1'),case when chat is null then pg_temp.self(pg_temp.acct('2')) end,chat,payload); $$;
create temporary table authority as select public.subject_copilot_scope_v1(pg_temp.acct('1'),pg_temp.sess('1'),pg_temp.self(pg_temp.acct('2')))->'authority' value;
create temporary table conversation as select (pg_temp.chat('commit',null,jsonb_build_object('message','What did B share?',
 'answer','B shared one estimate report.','citations',jsonb_build_array(jsonb_build_object('id','person:s-'||pg_temp.self(pg_temp.acct('2')),
  'label','Shared by B','href','/family/s-'||pg_temp.self(pg_temp.acct('2')))),
 'lastOrdinal',0,'nonceHash',encode(extensions.digest('d156-nonce-1','sha256'),'hex'),'expiresAt',to_jsonb(clock_timestamp()+interval '9 minutes'),
 'provider',(select value from a_provider),'authority',(select value from authority),
 'used',jsonb_build_array(jsonb_build_object('authority',(select value from authority),'purposes',jsonb_build_array('reports.polygenic'),
  'files',jsonb_build_array(jsonb_build_object('fileId','d1560000-0000-4000-8000-000000000040','purpose','reports.polygenic'))))))->>'chatId')::uuid id;
create function pg_temp.history() returns jsonb language sql as $$
 select pg_temp.chat('history',(select id from conversation),jsonb_build_object('provider',(select value from a_provider))) $$;
create function pg_temp.messages() returns bigint language sql as $$
 select count(*) from public.chat_messages where chat_id=(select id from conversation) $$;
select is(jsonb_array_length(pg_temp.history()->'messages'),2,'(released) A asks Copilot about B and reads the answer back');

-- 3. From 30 days until the reminder is accepted ---------------------------------------
select pg_temp.age('b',interval '30 days'-interval '72 hours'-interval '1 minute');
select is(pg_temp.reads('1','2'),pg_temp.everything(),'(29 d 23 h 59 m) A still reads what B shares');
-- The receipts a Family page captures, confirmed as its last step.
create temporary table expected as select jsonb_build_array(jsonb_build_object('purpose','reports.polygenic','afterFile',null,
 'receipt',public.family_shared_report_results_v1(pg_temp.acct('1'),pg_temp.sess('1'),pg_temp.self(pg_temp.acct('2')),
  'reports.polygenic')->>'pageReceipt')) value;
select is(pg_temp.confirm((select value from expected)),true,'(29 d 23 h 59 m) a captured read confirms');
select pg_temp.age('b',interval '1 minute');
select is(pg_temp.reads('1','2'),pg_temp.nothing(),'(30 d) from 30 days A reads nothing B shares');
select is(pg_temp.confirm((select value from expected)),false,
 '(30 d) a read captured a minute earlier no longer confirms: the page shows nothing');
select is(pg_temp.history(),'null'::jsonb,'(30 d) A''s conversation about B is unreadable, as during a pause');
select is(pg_temp.chat('list',null,'{}'::jsonb),'[]'::jsonb,'(30 d) and is not listed');
select is(pg_temp.messages(),2::bigint,'(30 d) nothing is deleted');
select is(pg_temp.c_reads(),pg_temp.third(),'(30 d) C still reads normally');
select public.run_due_adult_acceptance_notices_v1();
select is(pg_temp.notices('b','adult-revocation-renotice'),1::bigint,'(30 d) the reminder is queued once');
select is(pg_temp.reads('1','2'),pg_temp.nothing(),'(30 d) queued but not accepted, A still reads nothing');
select is(pg_temp.deliver('b','adult-revocation-renotice'),'sent','(30 d) the worker sends the reminder and the provider accepts it');
select is(pg_temp.reads('1','2'),pg_temp.everything(),'(reminded) A reads what B shares again, with no job run');
select is(pg_temp.confirm((select value from expected)),true,'(reminded) and the same captured read confirms again');
select is(jsonb_array_length(pg_temp.history()->'messages'),2,'(reminded) and the same conversation reads again, whole');
select public.run_due_adult_acceptance_notices_v1();
select pg_temp.age('b',interval '60 days');
select is(pg_temp.reads('1','2'),pg_temp.everything(),'(90 d) the retention job closing the clocks changes nothing, and there is no later boundary');

-- 4. A second notice that never goes never releases -------------------------------------
select ok(pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('5'))),'(F) held from acceptance');
select pg_temp.age('f',interval '72 hours');
select public.run_due_adult_acceptance_notices_v1();
select is(pg_temp.notices('f','adult-acceptance-second-notice'),1::bigint,'(F) its second notice is queued');
update private.invitation_terminal_notices set expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 days'
 where invitation_id=pg_temp.inv('f');
update public.mail_outbox set expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '2 days'
 where target_id=pg_temp.inv('f');
select ok(public.expire_invitation_terminal_notices_v1()>=1,'(F) it expires unsent');
select pg_temp.age('f',interval '10 days');
select ok(pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('5'))),'(F) ten days later A is still held: never released without the notice');
select is(public.adult_acceptance_inviter_held_subjects_v1(pg_temp.acct('1'),array[pg_temp.self(pg_temp.acct('5'))]),
 array[pg_temp.self(pg_temp.acct('5'))],'(F) and the graph''s door still names the record');

-- 5. An existing account: no 72-hour hold, the reminder from 30 days -------------------
select pg_temp.age('e',interval '72 hours');
select ok(not pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('4'))),'(existing) at 72 hours, with no notice of any kind, E is not held');
select pg_temp.age('e',interval '30 days'-interval '72 hours'-interval '1 minute');
select ok(not pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('4'))),'(existing) nor at 29 days 23 hours 59 minutes');
select pg_temp.age('e',interval '1 minute');
select ok(pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('4'))),
 '(existing) from 30 days A is held until the reminder is accepted, as for every account acceptance');
select throws_ok(format('select private.family_report_recipient_v1(%L,%L,%L,''reports.polygenic'')',pg_temp.acct('1'),pg_temp.sess('1'),
 pg_temp.self(pg_temp.acct('4'))),'42501','not_found','(existing) and reads nothing E shares');
select public.run_due_adult_acceptance_notices_v1();
select is(pg_temp.deliver('e','adult-revocation-renotice'),'sent','(existing) the reminder is sent');
select ok(not pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('4'))),'(existing) and A reads E again');

-- 6. An acceptance recorded before 20261120120000 keeps the creation-time rule ----------
delete from public.retention_due_phases where target_kind='invitation' and target_id in (pg_temp.inv('e'),pg_temp.inv('f'));
delete from public.retention_rows where target_kind='invitation' and target_id in (pg_temp.inv('e'),pg_temp.inv('f'));
select ok(pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('5'))),
 '(unrecorded) an account created after its invitation stays held, never released');
update public.subject_invitations set accepted_at=clock_timestamp()-interval '1 day' where id=pg_temp.inv('e');
select ok(not pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('4'))),
 '(unrecorded) an older account is not held within 30 days');
update public.subject_invitations set accepted_at=clock_timestamp()-interval '30 days' where id=pg_temp.inv('e');
select ok(pg_temp.held(pg_temp.acct('1'),pg_temp.self(pg_temp.acct('4'))),
 '(unrecorded) and from 30 days, with no reminder recorded, it is held');

-- 7. Path B is unchanged ------------------------------------------------------------------
select pg_temp.requested('pb','7',repeat('7',64));
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('4');
select is(pg_temp.account_confirms('7','d156-sign-77777777777777777777','4',repeat('7',64)),'accepted',
 '(Path B) a person whose account was created after the request accepts');
select is((private.other_adult_mitigation_v1(pg_temp.sid('pb'),pg_temp.a('1'),'route-read-before-fetch')->>'decision')||':'||
 (private.other_adult_mitigation_v1(pg_temp.sid('pb'),pg_temp.a('1'),'route-read-before-fetch')->>'gate'),
 'deny:adult.acceptance-hold-72h','(Path B) the uploader is held from the record as 20261120120000 decides, unchanged');
select isnt(public.grant_directional_purpose_v1(pg_temp.a('4'),pg_temp.self(pg_temp.a('4')),pg_temp.principal(pg_temp.a('1')),
 'reports.polygenic','consent.share-with-adult',1,'d156-share-pb-estimate-00000000'),null,'(Path B) the person shares their own record with the uploader');
select ok(not pg_temp.held(pg_temp.a('1'),pg_temp.self(pg_temp.a('4'))),
 '(Path B) the uploader is not the inviter this decision holds: a Path B record keeps its draft');
select is(pg_temp.reads_report(pg_temp.a('1'),pg_temp.s('1'),pg_temp.self(pg_temp.a('4'))),'true',
 '(Path B) and reads what the person shares from their own record, as before');

select * from finish();
rollback;
