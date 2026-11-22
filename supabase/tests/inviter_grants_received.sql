-- D-156: the inviter's own class of grants received leaves out the held
-- adult's grants (20261122170000_inviter_grants_and_reviewed_document_decision.sql,
-- item 1; owner decision of 22 November 2026, "The 72-hour hold covers an
-- inviter's reads of the invited adult's own record", docs/protocol/decisions.md).
--
-- Proves, on synthetic rows and on every account already in the database:
--   * while A is held as the inviter of B's Path A acceptance, the
--     directional_grants class read for A lists none of B's grants to A, and
--     every caller of the class projection answers for A exactly what it
--     answers when B has granted A nothing;
--   * for every other account in the database (B, a third account C, an
--     inviter whose invitee had an account before the invitation, and every
--     account other suites and browser runs left behind) every caller, and
--     for every account every other class, answers byte for byte what the
--     predecessor body answers: the body is swapped back to its predecessor
--     inside this transaction and every read is made again;
--   * once the second notice is accepted, every caller answers for A, too,
--     what the predecessor answers; from 30 days until the reminder is
--     accepted B's grants are left out again;
--   * the patched body carries its pinned successor and privileges.
-- The callers are the class inventory, the legacy classes, the complete
-- archive's source rows and class rows, the subject class projection and the
-- scoped class projection (account and subject). Time is moved only by
-- ageing the synthetic acceptances' own rows. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

-- People ---------------------------------------------------------------------------
-- A invites B, who signs up after the invitation (held). C is a third account
-- B shares with. D invites E, whose account predates the invitation (not
-- held for 72 hours). Each has a declared jurisdiction.
insert into auth.users(id,email,email_confirmed_at,created_at)
 select ('d1560000-0000-4000-8000-00000000000'||n)::uuid,'d156c-'||n||'@e2e.local',now()-interval '1 day',now()-interval '1 day'
 from unnest(array['1','2','3','4','5']) n;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('d1560000-0000-4000-8000-00000000001'||n)::uuid,('d1560000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1'
 from unnest(array['1','2','3','4','5']) n;
update public.profiles p set date_of_birth=date '1990-01-01',jurisdiction_code='GB',jurisdiction_declared_at=clock_timestamp(),
 jurisdiction_attestation_version=a.version,jurisdiction_attestation_sha256=a.body_sha256
 from public.consent_artifacts a where a.artifact_key='attestation.jurisdiction' and a.superseded_at is null
  and p.id::text like 'd1560000-%';
create function pg_temp.acct(p text) returns uuid language sql immutable as
 $$ select ('d1560000-0000-4000-8000-00000000000'||p)::uuid $$;
create function pg_temp.sess(p text) returns uuid language sql immutable as
 $$ select ('d1560000-0000-4000-8000-00000000001'||p)::uuid $$;
create function pg_temp.self(p_account uuid) returns uuid language sql as
 $$ select id from public.subjects where subject_account_id=p_account and subject_class='self' $$;
create function pg_temp.principal(p_account uuid) returns uuid language sql as $$
 select sp.id from public.subject_principals sp join public.subjects s on s.id=sp.subject_id
 where sp.account_id=p_account and s.subject_class='self' and sp.principal_kind='account_subject' and sp.status='active' $$;

-- Two Path A invitations, each opened through its mailed token and accepted.
create temporary table pa(name text primary key,subject_id uuid,invitation_id uuid);
create function pg_temp.invite_and_accept(p_name text,p_inviter text,p_invitee text,p_letter text,p_created_after boolean)
returns void language plpgsql as $$
declare r record; d record; v_subject uuid;
begin
 select * into r from public.create_adult_subject_invitation_v1(pg_temp.acct(p_inviter),decode('00112233445566778899aabbccddeeff','hex'),
  repeat(p_letter,64),encode(extensions.digest(convert_to('d156c-idem:'||p_letter,'UTF8'),'sha256'),'hex'),true,
  p_quota_keys=>pg_temp.invitation_quota_keys());
 update public.mail_outbox set state='invalidated' where state in ('queued','claimed') and token_target_id is distinct from r.invitation_id;
 select * into d from public.claim_mail_outbox();
 if (select count(*) from public.activate_rights_session_v1(encode(extensions.digest(convert_to(d.delivery_token,'UTF8'),'sha256'),'hex'),
   repeat(p_letter,64),'d156c-open-'||p_letter||'aaaaaaaaaaaaaaaaaa'))<>1 then raise exception 'path a setup failed for %',p_name; end if;
 if p_created_after then update auth.users set created_at=clock_timestamp() where id=pg_temp.acct(p_invitee); end if;
 v_subject:=public.accept_adult_subject_invitation_v1(repeat(p_letter,64),'d156c-accept-'||p_letter||'aaaaaaaaaaaaaaaa',
  pg_temp.acct(p_invitee),pg_temp.sess(p_invitee),jsonb_build_object('1',repeat(p_letter,64)),decode(repeat('5a',28),'hex'));
 insert into pa values(p_name,v_subject,r.invitation_id);
end $$;
select pg_temp.invite_and_accept('b','1','2','b',true);
select pg_temp.invite_and_accept('e','4','5','e',false);
create function pg_temp.inv(p_name text) returns uuid language sql as $$ select invitation_id from pa where name=p_name $$;
create function pg_temp.age(p_name text,p_by interval) returns void language sql as $$
 update public.subject_invitations set accepted_at=accepted_at-p_by,terminal_at=terminal_at-p_by where id=pg_temp.inv(p_name);
 update public.retention_rows set fixed_deadline=fixed_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv(p_name);
 update public.retention_due_phases set phase_deadline=phase_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv(p_name);
$$;
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
select is(public.adult_subject_acceptance_origin_v1(pg_temp.acct('2'),(select subject_id from pa where name='b'))||' '||
 public.adult_subject_acceptance_origin_v1(pg_temp.acct('5'),(select subject_id from pa where name='e')),
 'created_from_this_invitation existing_account','(setup) B''s account was created from A''s invitation; E''s predates D''s');

-- Grants, through the real door: B to A and to C, E to D.
create function pg_temp.grants(p_from text,p_to text,p_purpose text) returns uuid language sql as $$
 select public.grant_directional_purpose_v1(pg_temp.acct(p_from),pg_temp.self(pg_temp.acct(p_from)),
 pg_temp.principal(pg_temp.acct(p_to)),p_purpose,'consent.share-with-adult',1,'d156c-'||p_from||p_to||'-'||p_purpose||'-0000000000'); $$;
select isnt(pg_temp.grants(x.f,x.t,x.p),null,'(setup) '||x.f||' grants '||x.p||' to '||x.t)
 from (values('2','1','export.share-link'),('2','1','raw.export'),('2','3','export.share-link'),('2','3','raw.export'),
  ('5','4','export.share-link')) x(f,t,p);
create temporary table b_to_a as select g.grant_id from public.purpose_grants g join public.directional_grants d using(grant_id)
 where g.target_id=pg_temp.self(pg_temp.acct('2')) and d.recipient_account_id=pg_temp.acct('1');
select is((select count(*) from b_to_a),2::bigint,'(setup) A holds two grants from B');

-- The native complete archive, on for this transaction only, so its capture is read too.
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- Every read of the class projection's callers -------------------------------------
-- For each account: every metadata class of the projection itself, and the
-- directional_grants class through every caller, over a scope fixed here
-- (the account's own records and every record it was granted on), so the
-- reads made with and without B's grants cover the same calls. A call that
-- refuses is recorded with its error, so a refusal must match too.
create temporary table scope as select p.id account,
 coalesce((select array_agg(s.id order by s.id) from public.subjects s where s.subject_account_id=p.id or s.owner_account_id=p.id),'{}'::uuid[]) own,
 coalesce((select array_agg(distinct g.target_id) from public.directional_grants d join public.purpose_grants g using(grant_id)
  where g.target_kind='subject' and (d.recipient_account_id=p.id
   or d.recipient_principal_id in(select id from public.subject_principals where account_id=p.id))),'{}'::uuid[]) granted
 from public.profiles p;
create function pg_temp.read(p_sql text) returns text language plpgsql as $$
declare v text;
begin
 execute format('select coalesce(string_agg(t::text,E''\n'' order by t::text),'''') from (%s) t',p_sql) into v;
 return v;
exception when others then return 'error '||sqlstate||' '||sqlerrm;
end $$;
create function pg_temp.class_reads(p_only uuid default null) returns table(caller text,account uuid,result text)
language plpgsql as $$
declare x record;s uuid;k text;everything uuid[];origin jsonb;
begin
 select array_agg(id order by id) into everything from public.subjects;
 for x in select * from scope where p_only is null or scope.account=p_only order by scope.account loop
  account:=x.account;
  foreach k in array array['attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops',
   'future_person_claim_objections','future_person_claimant_principals','future_person_claims',
   'subject_control_refusal_authorities','subject_relationships','suppressions'] loop
   caller:='projection '||k;
   result:=pg_temp.read(format('select * from private.export_account_class_projection_v1(%L,%L,%L)',x.account,everything,k));
   return next;
  end loop;
  caller:='scoped account';
  result:=pg_temp.read(format('select * from private.export_scoped_class_projection_v1(''account'',%L,%L,''directional_grants'')',
   x.account,everything));return next;
  foreach s in array x.granted||x.own loop
   caller:='subject '||s;
   result:=pg_temp.read(format('select * from private.export_subject_class_projection_v1(%L,%L,''directional_grants'')',
    x.account,array[s]));return next;
   caller:='scoped subject '||s;
   result:=pg_temp.read(format('select * from private.export_scoped_class_projection_v1(''subject'',%L,%L,''directional_grants'')',
    x.account,array[s]));return next;
  end loop;
  caller:='complete source rows';
  result:=pg_temp.read(format('select * from private.account_archive_complete_source_rows_v1(%L,%L,''directional_grants'')',
   x.account,everything));return next;
  caller:='complete source rows over the legacy records';
  result:=pg_temp.read(format('select * from private.account_archive_complete_source_rows_v1(%L,%L,''directional_grants'',%L)',
   x.account,everything,x.own));return next;
  caller:='complete class rows';
  result:=pg_temp.read(format('select * from private.account_archive_complete_class_rows_v1(%L,%L,%L,''directional_grants'')',
   jsonb_build_object('kind','account','accountId',x.account,'sessionId','d1560000-0000-4000-8000-000000000099'),
   jsonb_build_object('partitions',coalesce((select jsonb_agg(jsonb_build_object('subjectId',o)) from unnest(x.own) o),'[]'::jsonb)),
   coalesce((select jsonb_agg(jsonb_build_object('subjectId',o)) from unnest(x.granted) o),'[]'::jsonb)));return next;
  -- The class inventory, the legacy classes and the complete archive's class
  -- census take a whole capture: each is read through the capture that builds it.
  origin:=jsonb_build_object('kind','account','accountId',x.account,'sessionId',coalesce((select z.id from auth.sessions z
   where z.user_id=x.account order by z.created_at desc,z.id limit 1),'d1560000-0000-4000-8000-000000000099'));
  caller:='preserved export capture (class inventory)';
  result:=pg_temp.read(format('select private.export_account_owned_capture_pre_requester_v1(%L,''account'',%L)',origin,x.account));
  return next;
  caller:='legacy capture (legacy classes)';
  result:=pg_temp.read(format('select private.account_archive_legacy_capture_v1(%L)',origin));return next;
  caller:='complete capture (class census and class rows)';
  result:=pg_temp.read(format('select private.account_archive_complete_capture_v1(%L)',origin));return next;
 end loop;
end $$;
-- The body under test, and its predecessor rebuilt from it in place (the one
-- anchor of 20261122170000 reversed), each checked by its md5.
create temporary table bodies as select pg_get_functiondef('private.export_account_class_projection_v1(uuid,uuid[],text)'::regprocedure) patched;
create function pg_temp.body(p_which text) returns text language plpgsql as $$
declare v_old constant text:=$old$   where d.recipient_account_id=p_account or d.recipient_principal_id in(select id from public.subject_principals where account_id=p_account)
   order by d.grant_id;
$old$; v_new constant text:=$new$   where (d.recipient_account_id=p_account or d.recipient_principal_id in(select id from public.subject_principals where account_id=p_account))
    -- 20261122170000 (D-156): a grant from an adult whose inviter is this
    -- account, while its acceptance hold or a due reminder stands, is not
    -- listed, exactly as with no grant.
    and not(g.target_kind='subject' and private.adult_acceptance_inviter_held_v1(p_account,g.target_id))
   order by d.grant_id;
$new$;
begin
 if p_which='predecessor' then execute replace((select patched from bodies),v_new,v_old);
 else execute (select patched from bodies); end if;
 return md5(pg_get_functiondef('private.export_account_class_projection_v1(uuid,uuid[],text)'::regprocedure));
end $$;
create temporary table reads(phase text,body text,caller text,account uuid,result text);
create function pg_temp.read_both(p_phase text) returns text language plpgsql as $$
declare v_predecessor text; v_patched text;
begin
 insert into reads select p_phase,'patched',r.* from pg_temp.class_reads() r;
 v_predecessor:=pg_temp.body('predecessor');
 insert into reads select p_phase,'predecessor',r.* from pg_temp.class_reads() r;
 v_patched:=pg_temp.body('patched');
 return v_predecessor||' '||v_patched;
end $$;
-- The accounts whose reads differ between the two bodies, and in which callers.
create function pg_temp.differs(p_phase text) returns text language sql as $$
 select coalesce(string_agg(distinct case p.account when pg_temp.acct('1') then 'A' when pg_temp.acct('2') then 'B'
  when pg_temp.acct('3') then 'C' when pg_temp.acct('4') then 'D' when pg_temp.acct('5') then 'E' else p.account::text end,','),'none')
 from reads p join reads q on q.phase=p.phase and q.caller=p.caller and q.account=p.account and q.body='predecessor'
 where p.phase=p_phase and p.body='patched' and p.result is distinct from q.result $$;
-- One account's reads in one phase and body, as one text.
create function pg_temp.reads_of(p_phase text,p_body text,p_account uuid) returns text language sql as $$
 select string_agg(caller||'='||result,E'\n' order by caller) from reads where phase=p_phase and body=p_body and account=p_account $$;

-- 0. The migration -----------------------------------------------------------------
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text||' '||p.provolatile::text||' '||p.prosecdef::text
  from pg_proc p where p.oid='private.export_account_class_projection_v1(uuid,uuid[],text)'::regprocedure),
 'f90fe19ebd711a84f020556cbb46373b {postgres=X/postgres} v true',
 'the class projection carries its pinned successor with unchanged privileges and volatility');

-- 1. During the hold -----------------------------------------------------------------
select is(pg_temp.read_both('hold'),'d729235af961ceaf364b7127a00a89cb f90fe19ebd711a84f020556cbb46373b',
 '(hold) every read is made with the patched body and again with its exact predecessor');
select ok((select count(distinct account)>=5 and count(*) filter(where body='patched')=count(*) filter(where body='predecessor')
  and count(*) filter(where caller like 'subject %')>0 and count(*) filter(where caller like 'scoped subject %')>0
 from reads where phase='hold'),'(hold) the reads cover every account in the database and every caller');
select is(pg_temp.differs('hold'),'A',
 '(hold) only A''s reads differ: for B, C, D, E and every other account every caller and every class answers as before');
select is((select string_agg(distinct regexp_replace(p.caller,'[0-9a-f-]{36}',case when p.caller like '%'||pg_temp.self(pg_temp.acct('2'))::text
   then 'B''s record' else 'another record' end),', ' order by regexp_replace(p.caller,'[0-9a-f-]{36}',case when p.caller like '%'||pg_temp.self(pg_temp.acct('2'))::text
   then 'B''s record' else 'another record' end))
 from reads p join reads q on q.phase=p.phase and q.caller=p.caller and q.account=p.account and q.body='predecessor'
 where p.phase='hold' and p.body='patched' and p.account=pg_temp.acct('1') and p.result is distinct from q.result),
 'complete capture (class census and class rows), complete source rows, complete source rows over the legacy records, '
 ||'legacy capture (legacy classes), projection directional_grants, scoped account, scoped subject B''s record, subject B''s record',
 '(hold) for A, exactly the reads of the class of grants received differ, through every caller that reads it');
select is((select count(*) from private.export_account_class_projection_v1(pg_temp.acct('1'),array[pg_temp.self(pg_temp.acct('2'))],
  'directional_grants') r where r.projected_id in(select grant_id from b_to_a)),0::bigint,
 '(hold) the class of grants received read for A lists none of B''s grants');
-- The same reads as if B had granted A nothing: B's two grants removed in a
-- rolled-back savepoint. The preserved export is the one exception, and it
-- is unchanged: it reads nothing another account shares, and refuses any
-- account that holds a live grant from another (20261122140000 left it so).
savepoint no_grant;
set constraints public.purpose_grants_pair_check, public.directional_grants_pair_check deferred;
delete from public.purpose_grant_nonces where grant_id in(select grant_id from b_to_a);
delete from public.directional_grants where grant_id in(select grant_id from b_to_a);
delete from public.purpose_grants where grant_id in(select grant_id from b_to_a);
select string_agg(caller||'='||result,E'\n' order by caller) as no_grant_reads from pg_temp.class_reads(pg_temp.acct('1'))
 where caller<>'preserved export capture (class inventory)' \gset
rollback to no_grant;
select is((select string_agg(caller||'='||result,E'\n' order by caller) from reads where phase='hold' and body='patched'
  and account=pg_temp.acct('1') and caller<>'preserved export capture (class inventory)'),:'no_grant_reads',
 '(hold) every caller answers for A exactly what it answers when B has granted A nothing, the complete and legacy captures included');
select isnt((select string_agg(caller||'='||result,E'\n' order by caller) from reads where phase='hold' and body='predecessor'
  and account=pg_temp.acct('1') and caller<>'preserved export capture (class inventory)'),:'no_grant_reads',
 '(hold) where the predecessor listed B''s grants to A');
select is((select string_agg(distinct result,' | ') from reads where phase='hold' and account=pg_temp.acct('1')
  and caller='preserved export capture (class inventory)'),'error 0A000 export_partition_projection_unavailable',
 '(hold) the preserved export, which reads nothing another account shares, refuses A as before, with either body');

-- 2. Released by the second notice -------------------------------------------------------
select pg_temp.age('b',interval '72 hours');
select public.run_due_adult_acceptance_notices_v1();
select is(pg_temp.deliver('b','adult-acceptance-second-notice'),'sent','(72 h) the second notice is accepted by the provider');
select is(pg_temp.read_both('released'),'d729235af961ceaf364b7127a00a89cb f90fe19ebd711a84f020556cbb46373b',
 '(released) every read is made again with both bodies');
select is(pg_temp.differs('released'),'none','(released) every caller answers for every account, A included, as before');
select is((select count(*) from private.export_account_class_projection_v1(pg_temp.acct('1'),array[pg_temp.self(pg_temp.acct('2'))],
  'directional_grants') r where r.projected_id in(select grant_id from b_to_a)),2::bigint,
 '(released) the class of grants received read for A lists B''s two grants again, with no job run');

-- 3. From 30 days until the reminder ------------------------------------------------------
select pg_temp.age('b',interval '30 days'-interval '72 hours');
select is((select count(*) from private.export_account_class_projection_v1(pg_temp.acct('1'),array[pg_temp.self(pg_temp.acct('2'))],
  'directional_grants') r where r.projected_id in(select grant_id from b_to_a)),0::bigint,
 '(30 d) from 30 days B''s grants are left out again');
select is((select count(*) from private.export_account_class_projection_v1(pg_temp.acct('3'),array[pg_temp.self(pg_temp.acct('2'))],
  'directional_grants') r),2::bigint,'(30 d) C still holds B''s two grants to C');
select public.run_due_adult_acceptance_notices_v1();
select is(pg_temp.deliver('b','adult-revocation-renotice'),'sent','(30 d) the reminder is accepted by the provider');
select is((select count(*) from private.export_account_class_projection_v1(pg_temp.acct('1'),array[pg_temp.self(pg_temp.acct('2'))],
  'directional_grants') r where r.projected_id in(select grant_id from b_to_a)),2::bigint,
 '(reminded) and A''s class lists them again');
select is(pg_temp.body('patched'),'f90fe19ebd711a84f020556cbb46373b','the patched body is in place at the end');

select * from finish();
rollback;
