begin;
select no_plan();
-- Explicitly synthetic historical paired chats. Real directional grant,
-- paired writer, revoke, pause/resume and stop RPCs; no fabricated grant rows.
insert into auth.users(id,email,raw_user_meta_data) values
 ('7f850000-0000-4000-8000-000000000001','turn-alpha@example.invalid','{}'),
 ('7f850000-0000-4000-8000-000000000002','turn-beta@example.invalid','{}'),
 ('7f850000-0000-4000-8000-000000000003','turn-gamma@example.invalid','{}');
create temporary table actors as select u.id account_id,s.id subject_id,p.id principal_id,
 case right(u.id::text,1) when '1' then 'a' when '2' then 'b' else 'c' end label
 from auth.users u join public.subjects s on s.subject_account_id=u.id and s.subject_class='self'
 join public.subject_principals p on p.account_id=u.id and p.subject_id=s.id
 and p.principal_kind='account_subject' and p.status='active'
 where u.id in('7f850000-0000-4000-8000-000000000001','7f850000-0000-4000-8000-000000000002','7f850000-0000-4000-8000-000000000003');
grant select on actors to service_role;
create temporary table grants(label text,id uuid);
grant all on grants to service_role;
set local role service_role;
insert into grants values
 ('poly',public.grant_directional_purpose_v1((select account_id from actors where label='b'),
 (select subject_id from actors where label='b'),(select principal_id from actors where label='a'),
 'reports.polygenic','consent.share-with-adult',1,'turn-closure-poly-000000000000')),
 ('mono',public.grant_directional_purpose_v1((select account_id from actors where label='b'),
 (select subject_id from actors where label='b'),(select principal_id from actors where label='a'),
 'reports.monogenic','consent.share-with-adult',1,'turn-closure-mono-000000000000')),
 ('other-recipient',public.grant_directional_purpose_v1((select account_id from actors where label='b'),
 (select subject_id from actors where label='b'),(select principal_id from actors where label='c'),
 'reports.polygenic','consent.share-with-adult',1,'turn-closure-other-00000000000'));
reset role;

create temporary table conversations(label text,id uuid,owner_label text);
insert into conversations select label,gen_random_uuid(),owner_label from(values
 ('affected','a'),('other-purpose','a'),('other-recipient','c'),('history','a'),('dependency','a'),('subject-dependency','a')) v(label,owner_label);
insert into public.chats(id,user_id,title,scope_kind,subject_id,lifecycle_revision,
 provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint,legacy_unverified)
 select c.id,a.account_id,'Synthetic closure fixture','self',a.subject_id,1,'local',1,1,repeat('a',64),false
 from conversations c join actors a on a.label=c.owner_label;
create temporary table turns(label text,chat_id uuid,id uuid);
-- The supported historical writer creates both roles at one positive ordinal.
insert into turns select 'prefix',c.id,private.persist_chat_turn_pair_v1(c.id,a.account_id,'"own question"','"own answer"')
 from conversations c join actors a on a.label=c.owner_label where c.label='affected';
insert into turns select c.label,c.id,private.persist_chat_turn_pair_v1(c.id,a.account_id,'"question"','"answer"')
 from conversations c join actors a on a.label=c.owner_label;
insert into turns select 'dependent-later',c.id,private.persist_chat_turn_pair_v1(c.id,a.account_id,'"follow-up"','"dependent answer"')
 from conversations c join actors a on a.label=c.owner_label where c.label='affected';
-- Turn IDs are scoped by chat. A matching ID in another recipient's chat must
-- not be removed by a global turn-ID-only DELETE.
update public.chat_messages set turn_id=(select id from turns where label='affected')
 where chat_id=(select id from conversations where label='other-recipient');
update turns set id=(select id from turns where label='affected') where label='other-recipient';
update public.chat_messages m set retrieved_subject_ids=array[(select subject_id from actors where label='b')],
 retrieved_purpose_keys=array[case when t.label='other-purpose' then 'reports.monogenic' else 'reports.polygenic' end]
 from turns t where m.chat_id=t.chat_id and m.turn_id=t.id and m.role='user'
 and t.label in('affected','other-purpose','other-recipient');
insert into public.copilot_context_history(chat_id,turn_id,scope_revision,authorization_fingerprint,retrieved_subject_ids,retrieved_purpose_keys,context_revision)
 select chat_id,id,1,repeat('a',64),array[(select subject_id from actors where label='b')],array['reports.polygenic'],1
 from turns where label='history';
insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
 select t.chat_id,t.id,'grant',g.id,pg.grant_revision,repeat('a',64)
 from turns t cross join grants g join public.purpose_grants pg on pg.grant_id=g.id
 where t.label='dependency' and g.label='poly';
insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
 select t.chat_id,t.id,'grant',g.id,pg.grant_revision+1,repeat('a',64)
 from turns t cross join grants g join public.purpose_grants pg on pg.grant_id=g.id
 where t.label='other-purpose' and g.label='poly';
insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
 select chat_id,id,'subject',(select subject_id from actors where label='b'),1,repeat('b',64)
 from turns where label='subject-dependency';
-- Selected suffix metadata must disappear with the messages even when the
-- metadata itself names an independent source (it belongs to a dependent turn).
insert into public.copilot_context_history(chat_id,turn_id,scope_revision,authorization_fingerprint,context_revision)
 select chat_id,id,1,repeat('a',64),1 from turns where label in('prefix','dependent-later');
insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
 select chat_id,id,'subject',(select subject_id from actors where label='a'),1,repeat('a',64)
 from turns where label in('prefix','dependent-later');

-- Preserve raw source metadata and variants. This is an unprocessed synthetic
-- legacy source, not an invented successful normalization or report result.
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status)
 select '7f850000-0000-4000-8000-000000000020',account_id,subject_id,
 '7f850000-0000-4000-8000-000000000021','Synthetic retained source','vcf',1,8,repeat('c',64),'uploaded'
 from actors where label='b';
insert into public.user_variants(user_id,file_id,subject_id,chrom,pos,genotype)
 select account_id,'7f850000-0000-4000-8000-000000000020',subject_id,1,100,'A/C' from actors where label='b';
create temporary table preserved_source as select to_jsonb(f) snapshot from public.genome_files f where id='7f850000-0000-4000-8000-000000000020';
create temporary table preserved_variant as select to_jsonb(v) snapshot from public.user_variants v where file_id='7f850000-0000-4000-8000-000000000020';
grant select on conversations,turns,preserved_source,preserved_variant to service_role;
create function pg_temp.messages(p_label text) returns bigint language sql as $$
 select count(*) from public.chat_messages m join conversations c on c.id=m.chat_id where c.label=p_label;
$$;

select is(pg_temp.messages('affected'),6::bigint,'three actual paired turns precede withdrawal');
select is(has_function_privilege('anon','private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)','execute'),false,'anon has no internal purge privilege');
select is(has_function_privilege('authenticated','private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)','execute'),false,'browser has no internal purge privilege');
select is(has_function_privilege('inherit_upload_only','private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)','execute'),false,'upload role has no internal purge privilege');
set local role service_role;
select lives_ok($$select public.revoke_directional_purpose_v1((select account_id from actors where label='b'),(select id from grants where label='poly'))$$,
 'actual service-role withdrawal succeeds');
reset role;
select is(pg_temp.messages('affected'),2::bigint,'both affected roles and both dependent later roles are deleted');
select is((select count(*) from public.chat_messages m join turns t on t.chat_id=m.chat_id and t.id=m.turn_id where t.label='prefix'),2::bigint,'earlier independent pair survives');
select is(pg_temp.messages('other-purpose'),2::bigint,'independent other-purpose conversation and mismatched grant revision survive');
select is(pg_temp.messages('other-recipient'),2::bigint,'the same source, purpose and turn ID for another recipient survive');
select is(pg_temp.messages('history'),0::bigint,'exact context-history attribution selects the whole pair');
select is(pg_temp.messages('dependency'),0::bigint,'exact recorded grant revision selects an otherwise unannotated pair');
select is(pg_temp.messages('subject-dependency'),2::bigint,'subject-only dependency cannot invent a purpose during one-layer revoke');
select is((select count(*) from public.copilot_context_history h join turns t on t.chat_id=h.chat_id and t.id=h.turn_id where t.label in('history','dependent-later')),0::bigint,'selected history metadata has zero residual');
select is((select count(*) from public.copilot_turn_dependencies d join turns t on t.chat_id=d.chat_id and t.id=d.turn_id where t.label in('dependency','dependent-later')),0::bigint,'selected dependency metadata has zero residual');
select is((select count(*) from public.copilot_context_history h join turns t on t.chat_id=h.chat_id and t.id=h.turn_id where t.label='prefix'),1::bigint,'independent prefix history survives');
select is((select count(*) from public.copilot_turn_dependencies d join turns t on t.chat_id=d.chat_id and t.id=d.turn_id where t.label='prefix'),1::bigint,'independent prefix dependency survives');

create temporary table before_pause as select jsonb_agg(to_jsonb(m) order by m.id) rows from public.chat_messages m join conversations c on c.id=m.chat_id;
set local role service_role;
select lives_ok($$select public.pause_family_sharing_v1((select account_id from actors where label='a'),(select account_id from actors where label='b'))$$,'global reversible pause succeeds');
reset role;
select is((select jsonb_agg(to_jsonb(m) order by m.id) from public.chat_messages m join conversations c on c.id=m.chat_id),(select rows from before_pause),'global pause deletes no conversation rows');
set local role service_role;
select lives_ok($$select public.resume_family_sharing_v1((select account_id from actors where label='b'),(select account_id from actors where label='a'))$$,'either contributor can resume still-current grants');
select lives_ok($$select * from public.stop_family_sharing_v1((select account_id from actors where label='a'),(select account_id from actors where label='b'))$$,'actual destructive stop succeeds');
reset role;
select is(pg_temp.messages('other-purpose'),0::bigint,'stop deletes both remaining other-layer roles between the stopped accounts');
select is(pg_temp.messages('subject-dependency'),0::bigint,'whole-sharing stop resolves an exact recorded subject dependency');
select is(pg_temp.messages('affected'),2::bigint,'stop preserves earlier own-only messages');
select is(pg_temp.messages('other-recipient'),2::bigint,'stop preserves the independent recipient conversation');
select is((select to_jsonb(f) from public.genome_files f where id='7f850000-0000-4000-8000-000000000020'),(select snapshot from preserved_source),'source metadata is unchanged');
select is((select to_jsonb(v) from public.user_variants v where file_id='7f850000-0000-4000-8000-000000000020'),(select snapshot from preserved_variant),'raw genotype row is unchanged');
select is((select count(*) from public.chats c join conversations t on t.id=c.id),6::bigint,'no parent chat cascades or unrelated conversation deletions');
select ok(exists(select 1 from public.worker_jobs w where user_id in(select account_id from actors)
 and computation_revision='family-revoke-purge-v1' and status='queued'),'generic verification jobs remain honestly queued, not falsely marked complete');

-- The seed's pair-dependency arm also reaches a self chat owned by the OTHER
-- pair contributor. It has no family_pair_id and is not the revoked grant's
-- recipient, so both original parent-lock predicates exclude it.
create temporary table closure_sessions as select gen_random_uuid() id,account_id user_id
 from actors where label in('a','b');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select id,user_id,clock_timestamp(),clock_timestamp(),'aal1' from closure_sessions;
grant select on closure_sessions to service_role;
set local role service_role;
select public.mark_independent_login_v1(a.account_id,s.id)
 from actors a join closure_sessions s on s.user_id=a.account_id where a.label in('a','b');
insert into grants values('portrait',public.grant_directional_purpose_v1(
 (select account_id from actors where label='b'),(select subject_id from actors where label='b'),
 (select principal_id from actors where label='a'),'family.portrait','consent.share-with-adult',1,
 'turn-closure-portrait-00000000000'));
reset role;
create temporary table exact_pair as select dg.pair_id id from public.directional_grants dg
 where grant_id=(select id from grants where label='portrait');
insert into conversations values('outside-parent',gen_random_uuid(),'b');
insert into public.chats(id,user_id,title,scope_kind,subject_id,lifecycle_revision,
 provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint,legacy_unverified)
 select c.id,a.account_id,'Synthetic outside-parent fixture','self',a.subject_id,1,'local',1,1,repeat('a',64),false
 from conversations c join actors a on a.label=c.owner_label where c.label='outside-parent';
insert into turns select 'outside-prefix',c.id,private.persist_chat_turn_pair_v1(c.id,a.account_id,'"own question"','"own answer"')
 from conversations c join actors a on a.label=c.owner_label where c.label='outside-parent';
insert into turns select 'outside-pair',c.id,private.persist_chat_turn_pair_v1(c.id,a.account_id,'"pair question"','"pair answer"')
 from conversations c join actors a on a.label=c.owner_label where c.label='outside-parent';
insert into turns select 'outside-suffix',c.id,private.persist_chat_turn_pair_v1(c.id,a.account_id,'"follow-up"','"dependent answer"')
 from conversations c join actors a on a.label=c.owner_label where c.label='outside-parent';
insert into public.copilot_turn_dependencies(chat_id,turn_id,dependency_kind,dependency_id,dependency_revision,source_binding_fingerprint)
 select t.chat_id,t.id,'pair',p.id,fp.pair_revision,repeat('a',64)
 from turns t cross join exact_pair p join public.family_pairs fp on fp.id=p.id where t.label='outside-pair';
select ok((select c.family_pair_id is null and c.user_id<>(select account_id from actors where label='a')
 from public.chats c join conversations x on x.id=c.id where x.label='outside-parent'),
 'pair-dependent self chat is outside both old parent-lock predicates');
set local role service_role;
select lives_ok($$select public.revoke_directional_purpose_v1((select account_id from actors where label='b'),(select id from grants where label='portrait'))$$,
 'actual Portrait withdrawal purges its outside-parent recorded dependency');
reset role;
select is(pg_temp.messages('outside-parent'),2::bigint,'outside-parent affected pair and later suffix are removed, prefix survives');
select is((select count(*) from public.copilot_turn_dependencies d join conversations c on c.id=d.chat_id where c.label='outside-parent'),0::bigint,
 'outside-parent pair dependency has zero residual');
select is(pg_temp.messages('other-recipient'),2::bigint,'an unrelated recipient conversation remains unchanged by pair withdrawal');
select * from finish();
rollback;
