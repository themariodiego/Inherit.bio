begin;
select no_plan();
-- Actual v2 draft → publication → transfer → optional profile → reviewer /
-- documentary completion. All Auth/document/provider metadata is synthetic;
-- no browser-issued Auth, human documentary or provider delivery credit.
\ir fixtures/verified_account_keyless_documents.inc
create temporary table account_contact as select contact.* from public.encrypted_contact_references contact
 join public.subject_principals principal on principal.id=contact.principal_id
 where principal.account_id='7a000000-0000-0000-0000-000000000001' and principal.principal_kind='account_subject'
  and contact.status='current';
select is((select count(*) from account_contact),1::bigint,'v2 actually produces exactly one self-account contact');
select ok((select c.account_mail_contact_revision=p.mail_contact_revision and c.authority_revision=sp.principal_revision
 from account_contact c join public.subject_principals sp on sp.id=c.principal_id join public.profiles p on p.id=sp.account_id),
 'the produced contact binds independent current mail and principal revisions');
select ok((select bool_and(contact.account_mail_contact_revision is null) from public.encrypted_contact_references contact
 join public.subject_principals sp on sp.id=contact.principal_id where sp.principal_kind<>'account_subject'),
 'distinct genetic-parent and legacy contacts receive no inferred account authority');
create temporary table contact_snapshot as select jsonb_build_object('contact',(select to_jsonb(c) from account_contact c),
 'indexes',(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.contact_hmac_indexes h
  where h.contact_reference_id=(select id from account_contact))) body;
create function pg_temp.account_draft(p_nonce text,p_session uuid default '7a000000-0000-4000-8000-0000000000a1',
 p_email text default 'embryo-owner@example.invalid',p_count integer default 3,p_set jsonb default jsonb_build_object('1',repeat('a',64)))
returns jsonb language sql as $$
 select to_jsonb(d) from public.create_embryo_cohort_draft_v2('7a000000-0000-0000-0000-000000000001',p_session,
  'own_embryos','true_two_parent',p_count,extensions.gen_random_bytes(64),null,
  array[repeat('bb',64)],null,p_nonce,true,p_set,jsonb_build_array(jsonb_build_object('1',repeat('b',64))),p_email) d;
$$;
set local role service_role;
select lives_ok($$select pg_temp.account_draft('account-v2-reuse-0001')$$,'actual service v2 reuses exact current account authority');
select throws_ok($$select pg_temp.account_draft('account-v2-foreign-session','7a000000-0000-4000-8000-0000000000b1')$$,
 '42501','recent_reauthentication_required','foreign actual session cannot produce own contact');
select throws_ok($$select pg_temp.account_draft('account-v2-email-mismatch',p_email=>'stranger@example.invalid')$$,
 '42501','verified account contact unavailable','server email must match the current verified Auth row');
select throws_ok($$select pg_temp.account_draft('account-v2-bad-count-0001',p_count=>0)$$,
 '22023','invalid draft request','original canonical draft refusal remains exact');
select throws_ok($$select pg_temp.account_draft('account-v2-reuse-0001')$$,
 '23505','operation nonce already used','the actual v1 nonce is neither replaced nor consumed twice');
select throws_ok($$update public.encrypted_contact_references set account_mail_contact_revision=account_mail_contact_revision+1
 where principal_id in(select id from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000001' and principal_kind='account_subject')$$,
 '42501','verified account contact revision server only','direct API service cannot overwrite the proved mail revision');
reset role;
select is(jsonb_build_object('contact',(select to_jsonb(c) from public.encrypted_contact_references c where id=(select id from account_contact)),
 'indexes',(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.contact_hmac_indexes h where h.contact_reference_id=(select id from account_contact))),
 (select body from contact_snapshot),'reuse and refused requests preserve contact/index rows byte-exact without renewing deadlines');
-- Real API roles attempt to move an already-proved row, not just its new field.
-- Each probe rolls back every preparation/mutation and verifies the actual role.
create function pg_temp.contact_mutation_probe(p_role text,p_case text) returns jsonb language plpgsql as $$
declare contact_id uuid; query text; observed jsonb;
begin
 select id into strict contact_id from account_contact;
 query:=case p_case
  when 'id' then 'update public.encrypted_contact_references set id=gen_random_uuid()'
  when 'principal' then 'update public.encrypted_contact_references set principal_id=(select sp.id from public.subject_principals sp join public.subjects s on s.id=sp.subject_id where sp.account_id=''7a000000-0000-0000-0000-000000000002'' and sp.principal_kind=''account_subject'' and s.subject_class=''self'')'
  when 'hmac' then 'update public.encrypted_contact_references set contact_hmac=repeat(''d'',64)'
  when 'ciphertext' then 'update public.encrypted_contact_references set contact_ciphertext=decode(repeat(''cd'',64),''hex'')'
  when 'authority' then 'update public.encrypted_contact_references set authority_revision=authority_revision+1'
  when 'key' then 'update public.encrypted_contact_references set key_revision=key_revision+1'
  when 'proof' then 'update public.encrypted_contact_references set account_mail_contact_revision=account_mail_contact_revision+1'
  when 'created' then 'update public.encrypted_contact_references set created_at=created_at+interval ''1 second'''
  when 'ended' then 'update public.encrypted_contact_references set ended_at=clock_timestamp()'
  when 'insert' then 'insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,account_mail_contact_revision,status) select principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,account_mail_contact_revision,status from public.encrypted_contact_references'
  when 'rotated-resurrection' then 'update public.encrypted_contact_references set status=''current'',ended_at=null'
  when 'shredded-resurrection' then 'update public.encrypted_contact_references set status=''current'',ended_at=null,contact_ciphertext=decode(repeat(''cd'',64),''hex'')'
  else null end;
 if query is null or p_role not in('anon','authenticated','service_role','inherit_upload_only') then raise exception 'invalid probe';end if;
 query:=query||format(' where id=%L::uuid',contact_id);
 begin
  if p_case='rotated-resurrection' then update public.encrypted_contact_references set status='rotated',ended_at=clock_timestamp() where id=contact_id;
  elsif p_case='shredded-resurrection' then update public.encrypted_contact_references set status='shredded',contact_ciphertext=null,ended_at=clock_timestamp() where id=contact_id;end if;
  execute format('set local role %I',p_role);
  begin execute query;observed:=jsonb_build_object('role',current_user,'code','accepted','message','accepted');
  exception when insufficient_privilege then observed:=jsonb_build_object('role',current_user,'code',sqlstate,'message',sqlerrm);end;
  raise exception using errcode='P0002',message='probe rollback';
 exception when no_data_found then null;end;
 return observed;
end $$;
select is(pg_temp.contact_mutation_probe(role,mutation)-'message',jsonb_build_object('role',role,'code','42501'),role||' refuses proven contact '||mutation)
 from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 cross join unnest(array['id','principal','hmac','ciphertext','authority','key','proof','created','ended','insert','rotated-resurrection','shredded-resurrection']) mutation;
select is(pg_temp.contact_mutation_probe('service_role',mutation),jsonb_build_object('role','service_role','code','42501',
 'message','verified account contact revision server only'),'actual service reaches the exact proven tuple guard for '||mutation)
 from unnest(array['id','principal','hmac','ciphertext','authority','key','proof','created','ended','insert','rotated-resurrection','shredded-resurrection']) mutation;
create function pg_temp.contact_index_mutation_probe(p_case text) returns jsonb language plpgsql as $$
declare contact_id uuid; revision bigint; query text; observed jsonb;
begin
 select c.id,min(h.hmac_key_revision) into strict contact_id,revision from account_contact c
  join public.contact_hmac_indexes h on h.contact_reference_id=c.id group by c.id;
 query:=case p_case
  when 'contact' then 'update public.contact_hmac_indexes set contact_reference_id=(select c.id from public.encrypted_contact_references c join public.subject_principals sp on sp.id=c.principal_id where sp.principal_kind=''genetic_parent'' order by c.id limit 1)'
  when 'hmac' then 'update public.contact_hmac_indexes set contact_hmac=repeat(''d'',64)'
  when 'key' then 'update public.contact_hmac_indexes set hmac_key_revision=hmac_key_revision+1'
  when 'extend' then 'update public.contact_hmac_indexes set expires_at=expires_at+interval ''1 second'''
  when 'shorten' then 'update public.contact_hmac_indexes set expires_at=expires_at-interval ''1 second'''
  when 'resurrect' then 'update public.contact_hmac_indexes set status=''current'''
  else null end;
 if query is null then raise exception 'invalid probe';end if;
 query:=query||format(' where contact_reference_id=%L::uuid and hmac_key_revision=%s',contact_id,revision);
 begin
  if p_case='resurrect' then update public.contact_hmac_indexes set status='revoked' where contact_reference_id=contact_id;end if;
  set local role service_role;
  begin execute query;observed:=jsonb_build_object('role',current_user,'code','accepted','message','accepted');
  exception when insufficient_privilege then observed:=jsonb_build_object('role',current_user,'code',sqlstate,'message',sqlerrm);end;
  raise exception using errcode='P0002',message='probe rollback';
 exception when no_data_found then null;end;
 return observed;
end $$;
select is(pg_temp.contact_index_mutation_probe(mutation),jsonb_build_object('role','service_role','code','42501',
 'message','verified account contact index immutable'),'actual service cannot change proven index '||mutation)
 from unnest(array['contact','hmac','key','extend','shorten','resurrect']) mutation;
create function pg_temp.contact_terminal_cleanup_probe() returns boolean language plpgsql as $$
declare contact_id uuid; observed boolean;
begin
 select id into strict contact_id from account_contact;
 begin
  set local role service_role;
  update public.encrypted_contact_references set status='rotated',ended_at=clock_timestamp() where id=contact_id;
  update public.contact_hmac_indexes set status='revoked' where contact_reference_id=contact_id;
  update public.encrypted_contact_references set status='shredded',contact_ciphertext=null,ended_at=clock_timestamp() where id=contact_id;
  delete from public.contact_hmac_indexes where contact_reference_id=contact_id;
  delete from public.encrypted_contact_references where id=contact_id;
  observed:=current_user='service_role' and not exists(select 1 from public.encrypted_contact_references where id=contact_id);
  raise exception using errcode='P0002',message='probe rollback';
 exception when no_data_found then null;end;
 return observed;
end $$;
select ok(pg_temp.contact_terminal_cleanup_probe(),'ordinary service rotation, exact NULL shred and child-first purge remain compatible');
select is(jsonb_build_object('contact',(select to_jsonb(c) from public.encrypted_contact_references c where id=(select id from account_contact)),
 'indexes',(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.contact_hmac_indexes h where h.contact_reference_id=(select id from account_contact))),
 (select body from contact_snapshot),'every refused move and terminal cleanup probe rolls back the full proven contact/index tuple');
-- Each planted invalid authority runs in a rollback-only subtransaction.
create function pg_temp.refuse_changed_contact(p_case text) returns boolean language plpgsql as $$
declare result boolean; expired_index public.contact_hmac_indexes;
begin
 begin
  if p_case='unconfirmed' then update auth.users set email_confirmed_at=null where id='7a000000-0000-0000-0000-000000000001';
  elsif p_case='null-email' then update auth.users set email=null where id='7a000000-0000-0000-0000-000000000001';
  elsif p_case='deleted' then update auth.users set deleted_at=clock_timestamp() where id='7a000000-0000-0000-0000-000000000001';
  elsif p_case='expired' then update auth.sessions set not_after=clock_timestamp() where id='7a000000-0000-4000-8000-0000000000a1';
  elsif p_case='expired-index' then
   select * into strict expired_index from public.contact_hmac_indexes
    where contact_reference_id=(select id from account_contact) order by hmac_key_revision limit 1;
   delete from public.contact_hmac_indexes where contact_reference_id=expired_index.contact_reference_id
    and hmac_key_revision=expired_index.hmac_key_revision;
   insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
    values(expired_index.contact_reference_id,expired_index.contact_hmac,expired_index.hmac_key_revision,'current',statement_timestamp());
  elsif p_case='stale' then update public.profiles set mail_contact_revision=mail_contact_revision+1 where id='7a000000-0000-0000-0000-000000000001';
  elsif p_case='legacy' then
   update public.encrypted_contact_references set status='rotated',ended_at=clock_timestamp() where id=(select id from account_contact);
   insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,status)
    select principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,'current' from account_contact;
  elsif p_case='duplicate' then insert into public.encrypted_contact_references(principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,account_mail_contact_revision)
   select principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision,account_mail_contact_revision from account_contact;
  elsif p_case='hold' then update public.profiles set deletion_requested_at=clock_timestamp() where id='7a000000-0000-0000-0000-000000000001';
  else raise exception 'unknown fixture case';end if;
  begin perform pg_temp.account_draft('v2-invalid-'||p_case||'-000001');result:=false;
  exception when insufficient_privilege then result:=true;end;
  raise exception using errcode='P0002',message=case when result then 'refused' else 'accepted' end;
 exception when no_data_found then result:=sqlerrm='refused';end;
 return result;
end $$;
select ok(pg_temp.refuse_changed_contact(mode),'v2 refuses exact planted '||mode||' authority without promotion')
 from unnest(array['unconfirmed','deleted','expired','stale','legacy','duplicate','hold']) mode;
select ok(pg_temp.refuse_changed_contact('expired-index'),
 'v2 refuses a still-current held index at its exact elapsed deadline without renewal');
select ok(pg_temp.refuse_changed_contact('null-email'),
 'v2 refuses a NULL Auth email despite a retained confirmation timestamp; SQL unknown cannot admit proof');
-- Genuine current reviewer API. Unlike the old notice fixture, no account
-- contact is manually inserted: the canonical v2 publication produced it.
set local role authenticated;
create temporary table produced_notice as select public.prepare_keyless_owner_notice_v1(
 (select review from keyless_ids),1,pg_temp.keyless_hash('v2-owner-notice-decision'),extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),
 ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,true,
 jsonb_build_object('1',repeat('a',64)),jsonb_build_object('1',repeat('b',64)),pg_temp.keyless_lookup()#>>'{scope,comparisonReceiptDigest}',
 extensions.gen_random_bytes(128),extensions.gen_random_bytes(72),gen_random_uuid(),extensions.gen_random_bytes(128),jsonb_build_object('1',repeat('c',64))) body;
select is((select body->>'state' from produced_notice),'approved_pending_owner_notice','actual v2 contact enables the real authenticated notice transaction');
reset role;
select ok(private.keyless_owner_notice_current_v1((select review from keyless_ids)),'the current immutable notice binds the newly produced contact');
-- Actual selected report generation, not a fabricated readiness envelope.
\ir fixtures/verified_account_ready_mail.inc
select is(jsonb_build_object('contact',(select to_jsonb(c) from public.encrypted_contact_references c where id=(select id from account_contact)),
 'indexes',(select jsonb_agg(to_jsonb(h) order by h.hmac_key_revision) from public.contact_hmac_indexes h where h.contact_reference_id=(select id from account_contact))),
 (select body from contact_snapshot),'genuine report readiness reuses the proved contact and preserves every original index deadline');
create temporary table preserved_notice as select to_jsonb(n) body from public.future_person_claim_notices n where claim_id=(select review from keyless_ids);
create temporary table preserved_parent_contacts as select jsonb_agg(to_jsonb(c) order by c.id) body from public.encrypted_contact_references c
 join public.subject_principals sp on sp.id=c.principal_id where sp.principal_kind='genetic_parent';
update auth.users set email='new-verified-owner@example.invalid' where id='7a000000-0000-0000-0000-000000000001';
select ok((select status='rotated' and ended_at is not null from public.encrypted_contact_references where id=(select id from account_contact)),
 'actual Auth email transition rotates only the proven old self-account contact');
select ok(not exists(select 1 from public.contact_hmac_indexes where contact_reference_id=(select id from account_contact) and status='current'),
 'actual Auth transition revokes every exact old account contact index');
select is((select m.state from public.mail_outbox m join public.future_person_claim_notices n on n.outbox_id=m.id
 where n.claim_id=(select review from keyless_ids)),'invalidated',
 'email transition invalidates exact owner notice even after the readiness predecessor already rotates its shared contact');
select is((select state from public.mail_outbox where id=(select id from contact_ready_mail)),'invalidated',
 'the unchanged readiness trigger still invalidates its genuine canonical event');
select is(private.keyless_owner_notice_current_v1((select review from keyless_ids)),false,'old immutable notice loses authority after actual email transition');
select is((select to_jsonb(n) from public.future_person_claim_notices n where claim_id=(select review from keyless_ids)),
 (select body from preserved_notice),'email transition never rewrites notice identity or fixed deadlines');
select is((select jsonb_agg(to_jsonb(c) order by c.id) from public.encrypted_contact_references c join public.subject_principals sp on sp.id=c.principal_id
 where sp.principal_kind='genetic_parent'),(select body from preserved_parent_contacts),'email transition preserves every distinct genetic-parent contact byte-exact');
create function pg_temp.stale_proven_notice_transition_probe() returns boolean language plpgsql as $$
declare original_contact jsonb; observed boolean;
begin
 select to_jsonb(c) into strict original_contact from public.encrypted_contact_references c where id=(select id from account_contact);
 begin
  -- Adversarially queue the same genuine notice after its contact already ended.
  -- No delivery/provider state or immutable purpose/identity/deadline is changed.
  update public.mail_outbox m set state='queued' from public.future_person_claim_notices n
   where n.outbox_id=m.id and n.claim_id=(select review from keyless_ids);
  update auth.users set email='second-owner-change@example.invalid' where id='7a000000-0000-0000-0000-000000000001';
  observed:=(select m.state='invalidated' from public.mail_outbox m join public.future_person_claim_notices n on n.outbox_id=m.id
   where n.claim_id=(select review from keyless_ids))
   and (select to_jsonb(c)=original_contact from public.encrypted_contact_references c where id=(select id from account_contact))
   and (private.keyless_owner_notice_current_v1((select review from keyless_ids)) is false);
  raise exception using errcode='P0002',message='probe rollback';
 exception when no_data_found then null;end;
 return observed;
end $$;
select ok(pg_temp.stale_proven_notice_transition_probe(),
 'a later Auth transition invalidates a stale queued genuine notice on an already-rotated proven contact without resurrecting it');
set local role service_role;
select throws_ok($$select pg_temp.account_draft('v2-old-email-after-change')$$,'42501','verified account contact unavailable','old server email refuses after current Auth changes');
select lives_ok($$select pg_temp.account_draft('v2-new-email-after-change',p_email=>'new-verified-owner@example.invalid')$$,
 'a fresh v2 request can independently create new current verified account authority');
reset role;
select is((select count(*) from public.encrypted_contact_references c join public.subject_principals sp on sp.id=c.principal_id
 where sp.principal_kind='account_subject' and sp.account_id='7a000000-0000-0000-0000-000000000001' and c.status='current'),1::bigint,
 'the successor account authority is unique and does not resurrect the old notice');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
 cross join unnest(array['private.create_verified_account_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)',
 'private.invalidate_verified_account_auth_contact_v1()','private.guard_verified_account_contact_revision_v1()',
 'private.guard_verified_account_contact_index_v1()']) fn where has_function_privilege(role,fn,'execute')),0::bigint,'all API roles are denied every new private helper');
select ok(has_function_privilege('service_role','public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)','execute')
 and not exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) role where has_function_privilege(role,
 'public.create_embryo_cohort_draft_v2(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean,jsonb,jsonb,text)','execute')),
 'only service can execute the new public producer door');
set constraints all immediate;
select * from finish();
rollback;
