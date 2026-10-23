begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- api.export and api.subject-export (20261023110000_export_completeness.sql),
-- owner decision of 23 October 2026 ("Export completeness: family
-- conversations, cohorts, empty classes"), option A: a parent's export
-- carries the parent's own cohort records and no embryo results.
--
--   * Only the account's own cohort material leaves: its own signatures and
--     attestations and its own roles, proposals and confirmations, through
--     the redacted graph rows. The other parent's and any donor's
--     signatures, principal ids, account ids and records never appear.
--   * Embryo results (embryos, quality, scores, variants, figures, report
--     artifacts) are left out; the class inventory counts none of them.
--   * The one-record export of the self record carries the same cohort rows;
--     an adult record carries none.
--   * No cohort role refuses either export, and the jointResults reason no
--     longer fires for one.
--
-- The cohort, its participants, signatures and embryos come from the real
-- doors (embryo_ingest_completed.inc). The donor attribution, disposition
-- proposal and confirmation have no reachable writer in this fixture, so
-- they and the adult record are planted synthetic owner-only rows.
-- Everything rolls back.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/embryo_ingest_completed.inc
reset role;

-- A owns the cohort, B is the other parent, C is a stranger.
create temporary table ec(label text primary key,account uuid,session uuid,subject uuid,principal uuid,parent uuid);
insert into ec(label,account,session) values
 ('a','7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1'),
 ('b','7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1'),
 ('c','7a000000-0000-0000-0000-000000000003','7a000000-0000-4000-8000-0000000000c1');
update ec set subject=s.id from public.subjects s where s.subject_account_id=ec.account and s.subject_class='self';
update ec set principal=p.id from public.subject_principals p where p.subject_id=ec.subject and p.account_id=ec.account and p.principal_kind='account_subject';
update ec set parent=p.id from public.subject_principals p where p.account_id=ec.account and p.principal_kind='genetic_parent';
create function pg_temp.v(which text,col text) returns uuid language sql stable as $$
 select case col when 'account' then account when 'session' then session when 'subject' then subject when 'parent' then parent else principal end
 from ec where label=which;
$$;
create function pg_temp.cohort() returns uuid language sql stable as $$
 select id from public.embryo_cohorts where owner_account_id=pg_temp.v('a','account');
$$;
select ok((select count(*)=3 and bool_and(subject is not null and principal is not null) from ec)
 and pg_temp.v('a','parent') is not null and pg_temp.v('b','parent') is not null,'three real accounts; both parents hold their genetic-parent principals');
select is((select count(*) from public.embryo_participant_sets where cohort_id=pg_temp.cohort()),8::bigint,'the real cohort names both parents in four sets');
select is((select count(*) from public.subjects where owner_account_id=pg_temp.v('a','account') and subject_class='embryo'),3::bigint,
 'the owner holds three embryo records');
select public.mark_independent_login_v1(account,session) from ec;

-- Planted: a donor attribution naming the other parent with their own
-- signature, and the other parent's disposition proposal with the owner's
-- confirmation of it.
insert into public.embryo_donor_attributions(id,cohort_id,donor_slot,donor_principal_id,signature_id,classification,attribution_revision)
 values('7ec00000-0000-4000-8000-000000000001',pg_temp.cohort(),'parent_b',pg_temp.v('b','parent'),
  (select id from public.consent_signatures where signer_account_id=pg_temp.v('b','account') and artifact_key='consent.upload-embryo'),'identified_consented',1);
insert into public.embryo_disposition_proposals(id,embryo_id,proposer_principal_id,disposition,basis_revision,authority_set_revision,status,expires_at)
 values('7ec00000-0000-4000-8000-000000000002',(select id from public.embryos where cohort_id=pg_temp.cohort() order by id limit 1),
  pg_temp.v('b','parent'),'stored',1,1,'pending',clock_timestamp()+interval '1 day');
insert into public.embryo_disposition_confirmations(proposal_id,confirmer_principal_id,authority_revision)
 values('7ec00000-0000-4000-8000-000000000002',pg_temp.v('a','parent'),1);

-- What must never leave an export of A: B's account, record, principals and
-- signatures and attestations, and the embryo records.
create temporary table foreign_ids as
 select 'b-'||k as label,v::text as value from ec,lateral (values ('account',account),('subject',subject),('principal',principal),('parent',parent)) x(k,v) where label='b'
 union all select 'b-signature',id::text from public.consent_signatures where signer_account_id='7a000000-0000-0000-0000-000000000002'
 union all select 'b-attestation',t.id::text from public.attestations t join public.subject_principals p on p.id=t.principal_id where p.account_id='7a000000-0000-0000-0000-000000000002'
 union all select 'embryo-record',id::text from public.subjects where owner_account_id='7a000000-0000-0000-0000-000000000001' and subject_class='embryo';
create temporary table own_ids as
 select 'a-'||k as label,v::text as value from ec,lateral (values ('account',account),('principal',principal),('parent',parent)) x(k,v) where label='a';
create function pg_temp.graph_rows(which text,kind text,p_subject uuid default null) returns setof jsonb language sql as $$
 select x.projected_row from (select pg_temp.v(which,'account') a) s,
  lateral (select * from private.export_account_graph_projection_v1(s.a,array[pg_temp.v(which,'subject')],kind)
   where p_subject is null union all
   select * from private.export_subject_graph_projection_v1(s.a,array[p_subject],kind) where p_subject is not null) x;
$$;
create function pg_temp.cohort_rows(which text,p_subject uuid default null) returns setof jsonb language sql as $$
 select r from unnest(array['embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations']) k,pg_temp.graph_rows(which,k,p_subject) r;
$$;
create function pg_temp.leaks(rows jsonb[],ids text) returns text[] language sql as $$
 select coalesce(array_agg(distinct f.label order by f.label),'{}') from unnest(rows) r,
  (select * from foreign_ids where ids in('foreign','all') union all select * from own_ids where ids in('own','all')) f
 where r::text like '%'||f.value||'%';
$$;
create function pg_temp.history(which text,kind text,p_subject uuid default null) returns setof jsonb language sql as $$
 select x.projected_row from private.export_scoped_history_projection_v1(case when p_subject is null then 'account' else 'subject' end,
  pg_temp.v(which,'account'),array[coalesce(p_subject,pg_temp.v(which,'subject'))],kind) x;
$$;

create temporary table sx(label text primary key,origin jsonb,target_kind text,subject uuid,capture jsonb,created jsonb,attempt uuid);
insert into sx(label,origin,target_kind,subject,attempt) select l,jsonb_build_object('kind','account','accountId',account,'sessionId',session),t,
 case t when 'account' then account else subject end,a::uuid from ec,(values ('a-account','account','7ec00000-0000-4000-8000-000000000201'),
  ('a-subject','subject','7ec00000-0000-4000-8000-000000000202'),('b-account','account','7ec00000-0000-4000-8000-000000000203')) x(l,t,a)
 where ec.label=left(x.l,1);
grant select,update on sx to service_role;grant select on ec,foreign_ids,own_ids to service_role;
create function pg_temp.envelope(which text,op text,nonce text) returns jsonb language sql as $$
 select jsonb_build_object('routeId',case when target_kind='account' then 'api.export' else 'api.subject-export' end,
  'origin','authenticated','principalId',capture->>'principalId','targetKind',target_kind,'targetId',subject,
  'exportContract',case when target_kind='account' then 'account-export-v1' else 'subject-export-v1' end,
  'originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt','csrfBinding',repeat('c',64),
  'operation',op,'nonceHash',nonce,'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
  'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000) from sx where label=which;
$$;
create function pg_temp.request(which text,op text,payload jsonb default null,csrf text default null) returns jsonb language sql as $$
 select case when target_kind='subject' then public.subject_export_request_v1(op,origin,subject,payload,csrf)
  else public.export_archive_request_v1(op,origin,'account',subject,payload,csrf) end from sx where label=which;
$$;
create function pg_temp.graph_door(which text,kind text) returns jsonb language sql as $$
 select public.export_archive_account_graph_rows_v2((created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',kind,null) from sx where label=which;
$$;
create function pg_temp.inventory(which text,path text[]) returns jsonb language sql as $$
 select private.export_account_owned_capture_v1(origin,target_kind,subject)#>path from sx where label=which;
$$;

-- 1. The whole-account export of the owner no longer refuses.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$update sx set capture=pg_temp.request(label,'capture') where label in('a-account','a-subject','b-account')$$,
 'the owner''s whole account, the owner''s own record and the other parent''s whole account are all captured');
select is((select capture->'subjectPartitions' from sx where label='a-account'),jsonb_build_array(pg_temp.v('a','subject')),
 'the owner''s embryo records are not partitions of the export: only the owner''s own record is');
reset role;
select is((select jsonb_object_agg(x->>'kind',(x->>'rows')::bigint) from jsonb_array_elements(pg_temp.inventory('a-account','{readableGraph,inventory}'))x),
 '{"embryo_cohorts":1,"embryo_basis_bindings":1,"embryo_participant_sets":8,"embryo_donor_attributions":1,"embryo_disposition_proposals":1,"embryo_disposition_confirmations":1,"family_pairs":0}'::jsonb,
 'the owner''s cohort, its basis, both parents'' roles, the donor attribution, the proposal and the confirmation are routed');
select is((select jsonb_object_agg(x->>'kind',jsonb_build_array(x->>'mode',(x->>'rows')::bigint)) from jsonb_array_elements(pg_temp.inventory('a-account','{classInventory}'))x
 where x->>'kind' in('embryos','embryo_qc','embryo_scores','embryo_variants','embryo_figures','report_artifacts')),
 '{"embryos":["claimed-bound",0],"embryo_qc":["claimed-bound",0],"embryo_scores":["claimed-bound",0],"embryo_variants":["claimed-bound",0],"embryo_figures":["claimed-bound",0],"report_artifacts":["claimed-bound",0]}'::jsonb,
 'no embryo result is counted: the three embryos and their results are left out');
select is((select count(*) from public.embryos where cohort_id=pg_temp.cohort()),3::bigint,'while the three embryos exist');
select ok(not(pg_temp.inventory('a-account','{}') ? 'familyConversations'),'the whole-account capture binds no family conversation turns');

-- 2. Only the owner's own cohort material leaves.
select is(pg_temp.leaks(array(select pg_temp.cohort_rows('a')),'all'),'{}'::text[],
 'no cohort row names the other parent, a donor, a signature, an embryo record or any principal or account, the owner''s included');
select is((select jsonb_agg(r->'participant_is_requester' order by r->>'set_kind',(r->'participant_is_requester')::text)
 from pg_temp.graph_rows('a','embryo_participant_sets') r),'[false,true,false,true,false,true,false,true]'::jsonb,
 'each of the four sets shows the owner''s own role and the other parent''s only as "not the requester"');
select is((select r-'created_at'-'id' from pg_temp.graph_rows('a','embryo_donor_attributions') r),
 jsonb_build_object('cohort_id',pg_temp.cohort(),'donor_slot','parent_b','donor_is_requester',false,'signature_recorded',true,
  'classification','identified_consented','attribution_revision',1,'revoked_at',null),
 'a donor attribution naming the other parent shows only that it is not the requester and that a signature exists');
select is((select r->'proposer_is_requester' from pg_temp.graph_rows('a','embryo_disposition_proposals') r),'false'::jsonb,
 'the other parent''s proposal leaves without its proposer');
select is((select r->'confirmer_is_requester' from pg_temp.graph_rows('a','embryo_disposition_confirmations') r),'true'::jsonb,
 'the owner''s own confirmation is marked as theirs');
select is((select coalesce(array_agg(r->>'id' order by r->>'id'),'{}') from pg_temp.history('a','signatures') r),
 (select array_agg(id::text order by id::text) from public.consent_signatures where signer_account_id=pg_temp.v('a','account')),
 'the owner''s signatures are exactly the owner''s own');
select is(pg_temp.leaks(array(select pg_temp.history('a',k) from unnest(array['signatures','attestations']) k),'foreign'),'{}'::text[],
 'the other parent''s signature rows and attestations never appear');
select is(pg_temp.leaks(array(select pg_temp.cohort_rows('b')),'all'),'{}'::text[],
 'the other parent''s export names neither parent, in the same way');
select is((select count(*) from pg_temp.graph_rows('b','embryo_participant_sets') r where (r->>'participant_is_requester')::boolean),4::bigint,
 'and marks the other parent''s own four roles as theirs');

-- 3. The owner's self record carries the same cohort rows; an adult record none.
select is(array(select r::text from pg_temp.cohort_rows('a',pg_temp.v('a','subject')) r order by 1),
 array(select r::text from pg_temp.cohort_rows('a') r order by 1),'the self record''s export carries exactly the whole account''s cohort rows');
select is((select jsonb_agg(x order by x->>'kind') from jsonb_array_elements(pg_temp.inventory('a-subject','{readableGraph,inventory}'))x where x->>'kind'<>'family_pairs'),
 (select jsonb_agg(x order by x->>'kind') from jsonb_array_elements(pg_temp.inventory('a-account','{readableGraph,inventory}'))x where x->>'kind'<>'family_pairs'),
 'with the same counts, partitions and membership digests');
select is((select coalesce(array_agg(r->>'id' order by r->>'id'),'{}') from pg_temp.history('a','signatures',pg_temp.v('a','subject')) r),
 (select array_agg(id::text order by id::text) from public.consent_signatures where signer_account_id=pg_temp.v('a','account')),
 'the self record carries the owner''s own cohort signatures');
select is((select coalesce(array_agg(r->>'id' order by r->>'id'),'{}') from pg_temp.history('a','attestations',pg_temp.v('a','subject')) r),
 (select array_agg(id::text order by id::text) from public.attestations where principal_id in(pg_temp.v('a','principal'),pg_temp.v('a','parent'))),
 'and the owner''s own cohort attestations');
select is(pg_temp.leaks(array(select pg_temp.history('a',k,pg_temp.v('a','subject')) from unnest(array['signatures','attestations']) k),'foreign'),'{}'::text[],
 'never the other parent''s');
savepoint adult_record;
-- Planted: an adult record whose person is the owner, held by C.
insert into public.subjects(id,owner_account_id,subject_account_id,subject_class,upload_class,display_label,lifecycle)
 values('7ec00000-0000-4000-8000-0000000000e1',pg_temp.v('c','account'),pg_temp.v('a','account'),'other_adult','adult','Planted adult record','active');
select is((select count(*) from pg_temp.cohort_rows('a','7ec00000-0000-4000-8000-0000000000e1')),0::bigint,'an adult record of the owner carries no cohort row');
select is((select count(*) from unnest(array['signatures','attestations']) k,pg_temp.history('a',k,'7ec00000-0000-4000-8000-0000000000e1') r
 where r->>'target_kind'<>'subject'),0::bigint,'nor any cohort signature or attestation');
rollback to adult_record;

-- 4. No cohort role refuses, and the jointResults reason no longer fires for one.
select ok(not private.export_subject_joint_results_v1(pg_temp.v('a','subject')),'the owner''s record has no joint result');
savepoint record_role;
insert into public.embryo_participant_sets(cohort_id,set_kind,principal_id,set_revision,membership_revision)
 values(pg_temp.cohort(),'notice_recipients',pg_temp.v('a','principal'),1,1);
select ok(private.export_subject_cohort_role_v1(pg_temp.v('a','subject')),'planted: the owner''s own record principal holds a role in the live cohort');
select ok(not private.export_subject_joint_results_v1(pg_temp.v('a','subject')),'the jointResults reason no longer fires for a cohort role');
set local role service_role;
select lives_ok($$select pg_temp.request('a-subject','capture')$$,'and the record is captured');
reset role;
rollback to record_role;
savepoint bound_elsewhere;
-- A claimed record bound to another account still refuses the whole account, as before.
update public.subjects set lifecycle='purged' where id=(select id from public.subjects where owner_account_id=pg_temp.v('a','account') and subject_class='embryo' order by id limit 1);
insert into public.subjects(id,owner_account_id,subject_account_id,subject_class,upload_class,display_label,lifecycle)
 values('7ec00000-0000-4000-8000-0000000000e2',pg_temp.v('a','account'),null,'other_adult','adult','Planted held record','active');
set local role service_role;
select throws_ok($$select pg_temp.request('a-account','capture')$$,'0A000','export_partition_projection_unavailable',
 'planted: a record the owner holds for another person still refuses the whole account');
reset role;
rollback to bound_elsewhere;

-- 5. The real jobs page the rows without either parent's identifiers.
set local role service_role;
update sx set created=pg_temp.request(label,'create',jsonb_build_object('envelope',pg_temp.envelope(label,'create',md5(label)||md5(label)),
 'exportCookieHash',md5(label||'cookie')||md5(label||'cookie')),repeat('c',64)) where label in('a-account','a-subject');
select lives_ok('set constraints all immediate','the genuine requests flush every deferred creation invariant');
set constraints all deferred;
select lives_ok($$select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from sx where label in('a-account','a-subject')$$,
 'the durable worker begins both attempts');
select is((select jsonb_agg(distinct r->>'subjectId') from sx,unnest(array['embryo_cohorts','embryo_participant_sets','embryo_donor_attributions',
 'embryo_disposition_proposals','embryo_disposition_confirmations']) k,jsonb_array_elements(pg_temp.graph_door(label,k)->'rows') r where label='a-subject'),
 jsonb_build_array(pg_temp.v('a','subject')),'every cohort row of the record''s job is filed under the record');
select ok((select bool_and(not exists(select 1 from foreign_ids f where r->>'rowText' like '%'||f.value||'%')) from sx,
 unnest(array['embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions','embryo_disposition_proposals',
  'embryo_disposition_confirmations']) k,jsonb_array_elements(pg_temp.graph_door(label,k)->'rows') r where label in('a-account','a-subject')),
 'no paged row text names the other parent, a signature or an embryo record');
savepoint mid_job;
reset role;
insert into public.embryo_participant_sets(cohort_id,set_kind,principal_id,set_revision,membership_revision)
 values(pg_temp.cohort(),'attribution_principals',pg_temp.v('a','parent'),1,1);
set local role service_role;
select throws_ok($$select pg_temp.graph_door('a-subject','embryo_participant_sets')$$,'42501',null,'a cohort change after the request fails the job');
rollback to mid_job;
reset role;
select is((select count(*) from public.embryo_participant_sets where cohort_id=pg_temp.cohort()),8::bigint,'the planted change was undone with its savepoint');

select * from finish();
rollback;
