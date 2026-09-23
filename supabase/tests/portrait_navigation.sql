begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Frozen original implementation from 20260907142213, renamed only. Executable
-- parity covers its complete proof/receipt, not a reconstruction of expected data.
create function pg_temp.original_portrait_readiness_v1(p_account_id uuid,p_session_id uuid,p_pair_id uuid,p_counterpart_account_id uuid,p_expected text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare p public.family_pairs%rowtype; a public.subjects%rowtype; b public.subjects%rowtype;
 initial_pair jsonb; initial_accounts uuid[]; session_receipt jsonb; v_endpoints jsonb; g jsonb; grants jsonb:='[]'; strong boolean:=true;
 owner_id uuid; recipient_id uuid; v_subject_id uuid; proof jsonb; sa jsonb; sb jsonb; legacy_a jsonb; legacy_b jsonb; receipt text;
begin
 select * into p from public.family_pairs where id=p_pair_id;
 if p.id is null or p.status is distinct from 'current' then return null; end if;
 select * into a from public.subjects where id=p.subject_a_id;
 select * into b from public.subjects where id=p.subject_b_id;
 if a.subject_account_id is null or b.subject_account_id is null or a.subject_account_id=b.subject_account_id
 or p_account_id is null or p_counterpart_account_id is null
 or (case when a.subject_account_id=p_account_id then b.subject_account_id when b.subject_account_id=p_account_id then a.subject_account_id end) is distinct from p_counterpart_account_id then return null; end if;
 initial_pair:=to_jsonb(p); initial_accounts:=array[a.subject_account_id,b.subject_account_id];
 -- One transaction retains both sides through serialization. Contention refuses
 -- rather than introducing a lock-order cycle with the older grant-first revoker.
 perform 1 from auth.users where id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from public.profiles where id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from auth.sessions where id=p_session_id and user_id=p_account_id for share nowait;
 perform 1 from public.subjects where id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.subject_account_bindings where subject_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.subject_principals where account_id in(a.subject_account_id,b.subject_account_id) order by id for share nowait;
 perform 1 from public.family_pairs where id=p_pair_id for share nowait;
 perform 1 from public.purpose_grants where target_kind='subject' and target_id in(a.id,b.id) order by grant_id for share nowait;
 perform 1 from public.directional_grants where pair_id=p.id order by grant_id for share nowait;
 perform 1 from public.consent_signatures where target_kind='subject' and target_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.consent_artifacts where artifact_key in('consent.share-with-adult','consent.upload-self','disclosure.insurance-and-discrimination') order by artifact_key,version for share nowait;
 perform 1 from public.subject_consents where subject_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.genome_files where subject_id in(a.id,b.id) order by id for share nowait;
 perform 1 from public.genome_storage_objects where genome_file_id in(select id from public.genome_files where subject_id in(a.id,b.id)) order by object_id for share nowait;
 perform 1 from storage.objects where id in(select storage_object_id from public.genome_files where subject_id in(a.id,b.id)) order by id for share nowait;
 perform 1 from private.own_normalization_runs where file_id in(select id from public.genome_files where subject_id in(a.id,b.id)) order by file_id for share nowait;
 select * into p from public.family_pairs where id=p_pair_id;
 select * into a from public.subjects where id=p.subject_a_id;
 select * into b from public.subjects where id=p.subject_b_id;
 if to_jsonb(p) is distinct from initial_pair or array[a.subject_account_id,b.subject_account_id] is distinct from initial_accounts
 or p_account_id is null or p_account_id not in(a.subject_account_id,b.subject_account_id)
 or p.status is distinct from 'current' or a.portrait_acknowledged_at is null or b.portrait_acknowledged_at is null
 or a.independent_login_at is null or b.independent_login_at is null then return null; end if;
 session_receipt:=private.family_report_session_v1(p_account_id,p_session_id);
 for owner_id,recipient_id,v_subject_id in select a.subject_account_id,b.subject_account_id,a.id union all select b.subject_account_id,a.subject_account_id,b.id
 loop
  v_endpoints:=private.family_portrait_endpoints_v1(owner_id,v_subject_id,recipient_id,false);
  select jsonb_build_object('id',pg.grant_id,'revision',pg.grant_revision,'endpoints',v_endpoints,
   'strong',fs.grant_id is not null) into g
  from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join public.consent_signatures cs on cs.id=pg.signature_id
  join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  left join private.family_portrait_grant_snapshots fs on fs.grant_id=pg.grant_id
  where pg.target_kind='subject' and pg.target_id=v_subject_id and pg.purpose='family.portrait'
  and pg.signer_principal_id=(v_endpoints#>>'{owner,principalId}')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(v_endpoints#>>'{owner,subjectBindingRevision}')::bigint
  and pg.jurisdiction_revision=(v_endpoints#>>'{owner,jurisdictionRevision}')::bigint
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='subject_to_recipient' and dg.recipient_account_id=recipient_id
  and dg.recipient_principal_id=(v_endpoints#>>'{recipient,principalId}')::uuid and dg.relationship_id is null
  and dg.pair_id=p.id and dg.relationship_or_pair_revision=p.pair_revision
  and cs.signer_account_id=owner_id and cs.signer_principal_id=pg.signer_principal_id
  and cs.target_kind='subject' and cs.target_id=v_subject_id and cs.purpose=pg.purpose
  and cs.artifact_key=pg.artifact_key and cs.artifact_version=pg.artifact_version and cs.artifact_body_sha256=pg.artifact_body_sha256
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and ca.body_sha256=pg.artifact_body_sha256 and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
  and ca.superseded_at is null and ca.published_at<=clock_timestamp() and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and (fs.grant_id is null or (fs.endpoints=v_endpoints and fs.pair_id=p.id and fs.pair_revision=p.pair_revision));
  if g is null then return null; end if;
  if (g->>'strong')::boolean then perform private.family_portrait_endpoints_v1(owner_id,v_subject_id,recipient_id,true);
  else strong:=false; end if;
  grants:=grants||jsonb_build_array(g);
 end loop;
 if strong then
  sa:=private.family_portrait_prepared_source_v1(a.subject_account_id,a.id);
  sb:=private.family_portrait_prepared_source_v1(b.subject_account_id,b.id);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',sha256,'revision',upload_revision) order by id),'[]') into legacy_a
 from public.genome_files where subject_id=a.id and status='annotated' and single_logical_sample_verified_at is null
 and structural_validator_version is null and source_sha256 is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sha256',sha256,'revision',upload_revision) order by id),'[]') into legacy_b
 from public.genome_files where subject_id=b.id and status='annotated' and single_logical_sample_verified_at is null
 and structural_validator_version is null and source_sha256 is null;
 proof:=jsonb_build_object('legacyA',legacy_a,'legacyB',legacy_b,'session',session_receipt,'pair',to_jsonb(p),'grants',grants,'a',sa,'b',sb,
  'acknowledgments',jsonb_build_array(a.portrait_acknowledged_at,b.portrait_acknowledged_at),
  'independentLogins',jsonb_build_array(a.independent_login_at,b.independent_login_at));
 receipt:=encode(extensions.digest(convert_to(proof::text,'UTF8'),'sha256'),'hex');
 if p_expected is not null and p_expected is distinct from receipt then return null; end if;
 return jsonb_build_object('kind',case when strong then 'canonical' else 'legacy-only' end,'receipt',receipt,
  'a',jsonb_build_object('subjectId',a.id,'legacyFileIds',jsonb_path_query_array(legacy_a,'$[*].id'),'hasLegacySource',jsonb_array_length(legacy_a)>0,'hasPreparedSource',coalesce(sa->'source'<>'null'::jsonb,false)),
  'b',jsonb_build_object('subjectId',b.id,'legacyFileIds',jsonb_path_query_array(legacy_b,'$[*].id'),'hasLegacySource',jsonb_array_length(legacy_b)>0,'hasPreparedSource',coalesce(sb->'source'<>'null'::jsonb,false)));
exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state or invalid_text_representation then return null;
end; $$;

create function pg_temp.pid(n integer) returns uuid language sql immutable as $$
 select ('79810000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.sid(n integer) returns uuid language sql as $$
 select id from public.subjects where subject_account_id=pg_temp.pid(n) and subject_class='self'; $$;
create function pg_temp.principal(n integer) returns uuid language sql as $$
 select id from public.subject_principals where subject_id=pg_temp.sid(n) and account_id=pg_temp.pid(n)
 and principal_kind='account_subject' and status='active'; $$;
do $$ declare n integer; begin
 for n in 1..3 loop
  insert into auth.users(id,email,email_confirmed_at) values(pg_temp.pid(n),'portrait-navigation-'||n||'@e2e.local',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(pg_temp.pid(n+10),pg_temp.pid(n),now(),now(),'aal1');
  update public.profiles set date_of_birth='1990-01-01' where id=pg_temp.pid(n);
  perform public.mark_independent_login_v1(pg_temp.pid(n),pg_temp.pid(n+10));
 end loop;
end $$;
create function pg_temp.pair() returns uuid language sql as $$
 select id from public.family_pairs where subject_low_id=least(pg_temp.sid(1),pg_temp.sid(2))
 and subject_high_id=greatest(pg_temp.sid(1),pg_temp.sid(2)); $$;
create function pg_temp.presentation(n integer) returns text language sql as $$
 select public.family_portrait_grant_presentation_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.pid(3-n)); $$;
create function pg_temp.grant_portrait(n integer,nonce text) returns uuid language sql as $$
 select public.grant_family_portrait_purpose_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.principal(3-n),
 pg_temp.pid(3-n),'family.portrait',1,(select body_sha256 from public.consent_artifacts
 where artifact_key='consent.share-with-adult' and version=1),nonce,pg_temp.presentation(n)); $$;
create function pg_temp.nav(expected text default null) returns jsonb language sql as $$
 select public.family_portrait_navigation_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pair(),pg_temp.pid(2),expected); $$;
create function pg_temp.ready(expected text default null) returns jsonb language sql as $$
 select public.family_portrait_source_readiness_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pair(),pg_temp.pid(2),expected); $$;
create function pg_temp.original_ready(expected text default null) returns jsonb language sql as $$
 select pg_temp.original_portrait_readiness_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pair(),pg_temp.pid(2),expected); $$;
set local role service_role;
select ok(pg_temp.nav() is null,'no grant/pair gives no Portrait navigation authority');
select public.grant_directional_purpose_v1(pg_temp.pid(1),pg_temp.sid(1),pg_temp.principal(2),
 'family.portrait','consent.share-with-adult',1,'portrait-nav-legacy-a');
select ok(pg_temp.nav() is null,'one direction alone cannot expose a Portrait link');
select public.grant_directional_purpose_v1(pg_temp.pid(2),pg_temp.sid(2),pg_temp.principal(1),
 'family.portrait','consent.share-with-adult',1,'portrait-nav-legacy-b');
select ok(pg_temp.nav() is null,'mutual grants without acknowledgments cannot expose a link');
select public.acknowledge_portrait_v1(pg_temp.pid(1),pg_temp.sid(1));
select public.acknowledge_portrait_v1(pg_temp.pid(2),pg_temp.sid(2));
select ok(pg_temp.nav() is not null,'existing eligible legacy authority has navigation before any upload');
select is(pg_temp.ready(),pg_temp.original_ready(),'legacy readiness response and receipt remain exactly the original');
select is(pg_temp.ready()->>'kind','legacy-only','navigation never upgrades historical grants to canonical authority');
create temporary table grants as select 1 n,pg_temp.grant_portrait(1,'portrait-nav-current-a') grant_id;
select is(pg_temp.ready(),pg_temp.original_ready(),'one reaffirmed direction preserves exact original readiness');
insert into grants values(2,pg_temp.grant_portrait(2,'portrait-nav-current-b'));
create temporary table capture as select pg_temp.nav() navigation,pg_temp.ready() readiness;
select is((select count(*) from public.genome_files where subject_id in(pg_temp.sid(1),pg_temp.sid(2))),0::bigint,
 'positive navigation fixture has no genome files');
select is((select count(*) from public.subject_consents where subject_id in(pg_temp.sid(1),pg_temp.sid(2))),0::bigint,
 'positive navigation does not require an upload or source-store consent');
select is((select count(*) from public.portrait_results where family_pair_id=pg_temp.pair()),0::bigint,
 'navigation creates and requires no Portrait result');
select is((select navigation from capture),jsonb_build_object('pairId',pg_temp.pair(),'subjectAId',
 (select subject_a_id from public.family_pairs where id=pg_temp.pair()),'subjectBId',
 (select subject_b_id from public.family_pairs where id=pg_temp.pair()),'counterpartAccountId',pg_temp.pid(2),
 'receipt',(select navigation->>'receipt' from capture)),'navigation has only its exact five metadata fields');
select ok((select navigation->>'receipt' from capture)~'^[0-9a-f]{64}$','navigation receipt is a SHA256 digest');
select is(pg_temp.nav((select navigation->>'receipt' from capture)),(select navigation from capture),
 'stable expected receipt returns identical navigation');
select is(pg_temp.ready(),pg_temp.original_ready(),'canonical no-file readiness proof remains byte-equivalent JSON');
select is(pg_temp.ready((select readiness->>'receipt' from capture)),pg_temp.original_ready((select readiness->>'receipt' from capture)),
 'captured source receipt is accepted by both old and factored readiness');
select is(pg_temp.ready()->>'kind','canonical','explicitly reaffirmed grant kind remains canonical');
select is(pg_temp.ready()#>>'{a,hasPreparedSource}','false','navigation does not invent a first prepared source');
select is(pg_temp.ready()#>>'{b,hasPreparedSource}','false','navigation does not invent a second prepared source');
select ok(pg_temp.nav(repeat('0',64)) is null,'wrong expected receipt refuses');
select ok(public.family_portrait_navigation_v1(pg_temp.pid(3),pg_temp.pid(13),pg_temp.pair(),pg_temp.pid(1)) is null,
 'unrelated account cannot navigate the pair');
select ok(public.family_portrait_navigation_v1(pg_temp.pid(1),pg_temp.pid(12),pg_temp.pair(),pg_temp.pid(2)) is null,
 'another account session cannot authorize the viewer');
select ok(public.family_portrait_navigation_v1(pg_temp.pid(1),null,pg_temp.pair(),pg_temp.pid(2)) is null,
 'missing session refuses');
select ok(public.family_portrait_navigation_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pair(),pg_temp.pid(3)) is null,
 'wrong counterpart expectation refuses');
select ok(public.family_portrait_navigation_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pid(999),pg_temp.pid(2)) is null,
 'wrong pair refuses');
select ok(public.family_portrait_navigation_v1(pg_temp.pid(2),pg_temp.pid(12),pg_temp.pair(),pg_temp.pid(1),
 (select navigation->>'receipt' from capture)) is null,'receipt cannot be transferred between pair participants');

savepoint expired_grant;
update public.purpose_grants set granted_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where grant_id=(select grant_id from grants where n=2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'expired opposite grant invalidates captured navigation');
select ok(pg_temp.nav() is null,'expired opposite grant also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'expired opposite grant preserves readiness refusal parity');
rollback to expired_grant;

savepoint wrong_purpose;
update public.purpose_grants set purpose='ancestry' where grant_id=(select grant_id from grants where n=2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'unrelated purpose invalidates captured navigation');
select ok(pg_temp.nav() is null,'unrelated purpose also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'unrelated purpose preserves readiness refusal parity');
rollback to wrong_purpose;

savepoint wrong_signer;
update public.purpose_grants set signer_principal_id=pg_temp.principal(3) where grant_id=(select grant_id from grants where n=2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'wrong signer principal invalidates captured navigation');
select ok(pg_temp.nav() is null,'wrong signer principal also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'wrong signer principal preserves readiness refusal parity');
rollback to wrong_signer;

savepoint wrong_signature;
update public.purpose_grants set signature_id=(select signature_id from public.purpose_grants where grant_id=(select grant_id from grants where n=1)) where grant_id=(select grant_id from grants where n=2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'wrong bound signature invalidates captured navigation');
select ok(pg_temp.nav() is null,'wrong bound signature also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'wrong bound signature preserves readiness refusal parity');
rollback to wrong_signature;

savepoint wrong_artifact_digest;
update public.purpose_grants set artifact_body_sha256=repeat('0',64) where grant_id=(select grant_id from grants where n=2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'artifact digest mismatch invalidates captured navigation');
select ok(pg_temp.nav() is null,'artifact digest mismatch also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'artifact digest mismatch preserves readiness refusal parity');
rollback to wrong_artifact_digest;

savepoint wrong_recipient;
update public.directional_grants set recipient_principal_id=pg_temp.principal(3) where grant_id=(select grant_id from grants where n=2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'wrong recipient principal invalidates captured navigation');
select ok(pg_temp.nav() is null,'wrong recipient principal also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'wrong recipient principal preserves readiness refusal parity');
rollback to wrong_recipient;

savepoint stale_pair;
update public.family_pairs set pair_revision=pair_revision+1 where id=pg_temp.pair();
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'same-ID pair revision drift invalidates captured navigation');
select ok(pg_temp.nav() is null,'same-ID pair revision drift also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'same-ID pair revision drift preserves readiness refusal parity');
rollback to stale_pair;

savepoint stale_endpoint;
update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id=pg_temp.pid(2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'same-ID counterpart binding drift invalidates captured navigation');
select ok(pg_temp.nav() is null,'same-ID counterpart binding drift also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'same-ID counterpart binding drift preserves readiness refusal parity');
rollback to stale_endpoint;

savepoint stale_principal;
update public.subject_principals set principal_revision=principal_revision+1 where account_id=pg_temp.pid(2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'same-ID counterpart principal drift invalidates captured navigation');
select ok(pg_temp.nav() is null,'same-ID counterpart principal drift also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'same-ID counterpart principal drift preserves readiness refusal parity');
rollback to stale_principal;

savepoint stale_jurisdiction;
update public.profiles set jurisdiction_revision=jurisdiction_revision+1 where id=pg_temp.pid(2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'counterpart jurisdiction revision drift invalidates captured navigation');
select ok(pg_temp.nav() is null,'counterpart jurisdiction revision drift also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'counterpart jurisdiction revision drift preserves readiness refusal parity');
rollback to stale_jurisdiction;

savepoint no_acknowledgment;
update public.subjects set portrait_acknowledged_at=null where id=pg_temp.sid(2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'missing opposite acknowledgment invalidates captured navigation');
select ok(pg_temp.nav() is null,'missing opposite acknowledgment also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'missing opposite acknowledgment preserves readiness refusal parity');
rollback to no_acknowledgment;

savepoint no_independent_login;
update public.subjects set independent_login_at=null where id=pg_temp.sid(2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'missing opposite independent login invalidates captured navigation');
select ok(pg_temp.nav() is null,'missing opposite independent login also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'missing opposite independent login preserves readiness refusal parity');
rollback to no_independent_login;

savepoint inactive_subject;
update public.subjects set lifecycle='restricted' where id=pg_temp.sid(2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'inactive counterpart lifecycle invalidates captured navigation');
select ok(pg_temp.nav() is null,'inactive counterpart lifecycle also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'inactive counterpart lifecycle preserves readiness refusal parity');
rollback to inactive_subject;

savepoint account_deletion;
update public.profiles set deletion_requested_at=clock_timestamp() where id=pg_temp.pid(2);
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'counterpart deletion request invalidates captured navigation');
select ok(pg_temp.nav() is null,'counterpart deletion request also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'counterpart deletion request preserves readiness refusal parity');
rollback to account_deletion;

savepoint sharing_pause;
select public.pause_family_sharing_v1(pg_temp.pid(1),pg_temp.pid(2));
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'current sharing pause invalidates captured navigation');
select ok(pg_temp.nav() is null,'current sharing pause also refuses a fresh capture');
select is(pg_temp.ready(),pg_temp.original_ready(),'current sharing pause preserves readiness refusal parity');
rollback to sharing_pause;

savepoint session_expiry;
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=pg_temp.pid(11);
set local role service_role;
select ok(pg_temp.nav() is null,'expired viewer session refuses');
select is(pg_temp.ready(),pg_temp.original_ready(),'expired session preserves readiness refusal parity');
rollback to session_expiry;
savepoint session_revision;
reset role;
update auth.sessions set refresh_token_counter=coalesce(refresh_token_counter,0)+1 where id=pg_temp.pid(11);
set local role service_role;
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'session refresh invalidates the captured receipt');
select ok(pg_temp.nav() is not null,'current refreshed session can capture fresh authority');
select is(pg_temp.ready(),pg_temp.original_ready(),'session refresh preserves readiness proof parity');
rollback to session_revision;
savepoint revoke_regrant;
select public.revoke_directional_purpose_v1(pg_temp.pid(2),(select grant_id from grants where n=2));
select ok(pg_temp.nav() is null,'real opposite grant withdrawal denies immediately');
select pg_temp.grant_portrait(2,'portrait-nav-regrant-b');
select ok(pg_temp.nav() is not null,'fresh explicit regrant can capture fresh authority');
select ok(pg_temp.nav((select navigation->>'receipt' from capture)) is null,'regrant cannot revive an old navigation receipt');
select is(pg_temp.ready(),pg_temp.original_ready(),'real revoke/regrant preserves readiness proof parity');
rollback to revoke_regrant;

savepoint legacy_source;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status)
values(pg_temp.pid(101),pg_temp.pid(1),pg_temp.sid(1),'portrait-navigation-legacy','Synthetic legacy source','vcf',1,8,repeat('c',64),'annotated');
select is(pg_temp.nav((select navigation->>'receipt' from capture)),(select navigation from capture),
 'source membership does not alter metadata-only navigation authority');
select is(pg_temp.ready(),pg_temp.original_ready(),'legacy source selection preserves the exact original readiness receipt');
select ok(pg_temp.ready((select readiness->>'receipt' from capture)) is null,'source readiness still rejects source membership drift');
rollback to legacy_source;


-- Exercise the original source reader as well as no-file authority. This uses
-- the same real consent/normalization transitions as the unchanged readiness
-- suite, over rollback-only synthetic object metadata.
savepoint prepared_sources;
reset role;
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads)
values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
do $$ declare n integer; artifact text; nonce text; claim uuid; begin
 for n in 1..2 loop
  foreach artifact in array array['disclosure.insurance-and-discrimination','consent.upload-self'] loop
   nonce:=encode(extensions.digest(n::text||artifact,'sha256'),'hex');
   insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
   values(nonce,pg_temp.pid(n),pg_temp.pid(n+10),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
   perform public.sign_own_upload_artifact_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),artifact,1,
    (select body_sha256 from public.consent_artifacts where artifact_key=artifact and version=1),
    case when artifact='consent.upload-self' then array['own-adult-dna'] else array['understood'] end,1,1,1,1,1,nonce);
  end loop;
  insert into storage.objects(id,bucket_id,name,metadata) values(pg_temp.pid(n+20),'genomes',pg_temp.pid(n+30)::text,'{"size":8}');
  insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
   upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
  values(pg_temp.pid(n+40),pg_temp.pid(n),pg_temp.sid(n),pg_temp.pid(n+30)::text,'Synthetic source','vcf',1,8,repeat('a',64),'uploaded',1,
   'single-logical-sample-v1',clock_timestamp(),repeat('b',64),pg_temp.pid(n+20));
  insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
  values(pg_temp.pid(n+20),pg_temp.pid(n+30)::text,'genomes',pg_temp.pid(n+40),repeat('a',64),8,1,'current');
  claim:=(public.own_upload_normalization_v1('begin',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40))->>'claim')::uuid;
  perform public.own_upload_normalization_v1('stage',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),claim,
   '{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
  perform public.own_upload_normalization_v1('complete',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),claim,
   jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
 end loop;
end $$;
set local role service_role;
select is(pg_temp.nav((select navigation->>'receipt' from capture)),(select navigation from capture),
 'real normalization/source creation does not alter navigation metadata receipt');
select is(pg_temp.ready(),pg_temp.original_ready(),'both prepared sources preserve the exact original full readiness proof');
select is(pg_temp.ready()#>>'{a,hasPreparedSource}','true','real normalized source is ready on the first side');
select is(pg_temp.ready()#>>'{b,hasPreparedSource}','true','real normalized source is ready on the second side');
create temporary table prepared_capture as select pg_temp.ready() readiness;
savepoint own_store_withdrawal;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where account_id=pg_temp.pid(2) and consent_type='upload_class';
select is(pg_temp.nav((select navigation->>'receipt' from capture)),(select navigation from capture),
 'own source-store withdrawal does not revoke separately granted Portrait navigation');
select ok(pg_temp.ready() is null,'source readiness still refuses withdrawn source-store consent');
select is(pg_temp.ready(),pg_temp.original_ready(),'source-store withdrawal preserves original refusal parity');
rollback to own_store_withdrawal;
update public.genome_files set status='failed' where id=pg_temp.pid(41);
select is(pg_temp.nav((select navigation->>'receipt' from capture)),(select navigation from capture),
 'failed source does not hide still-authorized Portrait navigation');
select is(pg_temp.ready(),pg_temp.original_ready(),'source failure preserves original readiness refusal/proof behavior');
select ok(pg_temp.ready((select readiness->>'receipt' from prepared_capture)) is null,
 'source failure still invalidates captured source readiness');
rollback to prepared_sources;

select ok(has_function_privilege('service_role','public.family_portrait_navigation_v1(uuid,uuid,uuid,uuid,text)','EXECUTE'),
 'navigation is available to the trusted server role');
select ok(not has_function_privilege(role_name,'public.family_portrait_navigation_v1(uuid,uuid,uuid,uuid,text)','EXECUTE'),
 role_name||' cannot invoke account-parameter navigation') from unnest(array['anon','authenticated','inherit_upload_only']) role_name;
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid='public.family_portrait_navigation_v1(uuid,uuid,uuid,uuid,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),
 'PUBLIC has no navigation execute privilege');
select ok(not has_function_privilege(role_name,'private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)','EXECUTE'),
 role_name||' cannot invoke private authority directly') from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role_name;
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid='private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),
 'PUBLIC cannot invoke the private metadata helper');
select * from finish();
rollback;
