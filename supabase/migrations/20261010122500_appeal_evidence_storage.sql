-- Private appeal evidence transport, storage.legal-evidence-v1.
-- Existing three-segment keys stay byte-exact: AES-GCM binds their full path.
-- No object is moved, renamed, re-encrypted or inferred from a prefix here.
-- New fragments/final plans use the four registered native case/document
-- segments. Old already-planned completion, read and exact due deletion remain.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal-evidence', 'legal-evidence', false, 20000028, array['application/octet-stream'])
on conflict (id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='legal-evidence' and name='legal-evidence'
  and public=false and file_size_limit=20000028 and allowed_mime_types=array['application/octet-stream']) then
  raise exception using errcode='55000',message='legal_evidence_bucket_incompatible';
 end if;
end $$;
-- No user Storage policy: every object operation remains service-only.
-- Fail closed on an incompatible historical row rather than abandoning its key.
alter table private.appeal_document_sessions drop constraint appeal_document_sessions_planned_object_key_check;
alter table private.appeal_document_sessions add constraint appeal_document_sessions_planned_object_key_check check (
 planned_object_key is null or (
  planned_object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and split_part(planned_object_key,'/',1)=intake_id::text
  and split_part(planned_object_key,'/',2)=document_id::text
 ) or (
  planned_object_key ~ '^appeal-case/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png)$' and split_part(planned_object_key,'/',2)=intake_id::text
  and split_part(planned_object_key,'/',3)=document_id::text
  and right(planned_object_key,4)=case media_type when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' end
 ));
alter table private.appeal_document_fragments drop constraint appeal_document_fragments_object_key_check;
alter table private.appeal_document_fragments add constraint appeal_document_fragments_object_key_check check (
 object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or object_key ~ '^appeal-case/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]part$');
alter table private.appeal_documents drop constraint appeal_documents_object_key_check;
alter table private.appeal_documents add constraint appeal_documents_object_key_check check (
 (object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and split_part(object_key,'/',1)=intake_id::text and split_part(object_key,'/',2)=id::text)
 or (object_key ~ '^appeal-case/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png)$' and split_part(object_key,'/',2)=intake_id::text and split_part(object_key,'/',3)=id::text
  and right(object_key,4)=case media_type when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' end));
do $$ begin
 if exists(select 1 from private.appeal_document_fragments fragment
  join private.appeal_document_sessions session on session.id=fragment.session_id
  where split_part(fragment.object_key,'/',1)<>session.intake_id::text
   or split_part(fragment.object_key,'/',2)<>session.document_id::text) then
  raise exception using errcode='55000',message='legacy_appeal_object_binding_incompatible';
 end if;
end $$;

-- A permissive legacy CHECK alone would admit fresh old-layout keys. These
-- triggers preserve only an unchanged existing key or exact persisted old plan.
create function private.guard_appeal_object_key_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare session private.appeal_document_sessions; changed boolean;
begin
 if tg_table_name='appeal_document_sessions' then
  if new.planned_object_key is null then return new;end if;
  changed:=true;
  if tg_op='UPDATE' then changed:=new.planned_object_key is distinct from old.planned_object_key;end if;
  if changed and (new.planned_object_key !~ '^appeal-case/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|jpg|png)$'
   or split_part(new.planned_object_key,'/',2)<>new.intake_id::text
   or split_part(new.planned_object_key,'/',3)<>new.document_id::text) then
   raise exception using errcode='42501',message='appeal object key unavailable';
  end if;
 elsif tg_table_name='appeal_document_fragments' then
  if tg_op='UPDATE' then
   if new.object_key is distinct from old.object_key or new.session_id<>old.session_id then
    raise exception using errcode='42501',message='appeal object key unavailable';
   end if;
   return new;
  end if;
  select source.* into session from private.appeal_document_sessions source where source.id=new.session_id;
  if session.id is null or new.object_key !~ '^appeal-case/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]part$'
   or split_part(new.object_key,'/',2)<>session.intake_id::text
   or split_part(new.object_key,'/',3)<>session.document_id::text then
   raise exception using errcode='42501',message='appeal object key unavailable';
  end if;
 elsif tg_table_name='appeal_documents' and tg_op='INSERT' then
  select source.* into session from private.appeal_document_sessions source where source.id=new.session_id;
  -- Only this exact already-persisted plan admits a legacy final object.
  if session.id is null or new.intake_id<>session.intake_id or new.id<>session.document_id
   or new.object_key is distinct from session.planned_object_key then
   raise exception using errcode='42501',message='appeal object key unavailable';
  end if;
 else raise exception using errcode='42501',message='appeal object key unavailable';
 end if;
 return new;
end $$;
revoke all on function private.guard_appeal_object_key_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger guard_appeal_session_object_key before insert or update of planned_object_key on private.appeal_document_sessions
 for each row execute function private.guard_appeal_object_key_v1();
create trigger guard_appeal_fragment_object_key before insert or update on private.appeal_document_fragments
 for each row execute function private.guard_appeal_object_key_v1();
create trigger guard_appeal_final_object_key before insert on private.appeal_documents
 for each row execute function private.guard_appeal_object_key_v1();


-- Replacements preserve every current session/nonce/revision/size/hash check,
-- global lock and immutable manifest field. Only the native key expressions differ.
create or replace function private.reserve_appeal_document_chunk_v1(
  p_session_id uuid, p_cookie_hash text, p_sequence integer, p_byte_count integer, p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session private.appeal_document_sessions;
  v_limits jsonb := private.appeal_document_limits_v1();
  v_written bigint;
  v_key text;
  v_intake private.new_public_appeal_intakes;
begin
  v_session := private.appeal_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null or v_session.state <> 'open' then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if p_sequence is null or p_sequence < 0 or p_sequence >= (v_limits->>'maximumChunks')::integer
    or exists (select 1 from private.appeal_document_fragments f where f.session_id = v_session.id and f.sequence = p_sequence) then
    raise exception using errcode = '23505', message = 'claim document chunk already written';
  end if;
  select coalesce(sum(f.byte_count), 0) into v_written from private.appeal_document_fragments f
  where f.session_id = v_session.id;
  if p_byte_count is null or p_byte_count < 1 or p_byte_count > (v_limits->>'chunkBytes')::integer
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or v_written + p_byte_count > v_session.declared_bytes then
    perform private.fail_appeal_document_session_row_v1(v_session.id, 'integrity');
    return jsonb_build_object('status', 'invalid');
  end if;
  v_key := 'appeal-case/' || v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text || '.part';
  insert into private.appeal_document_fragments (session_id, sequence, object_key, byte_count, sha256)
  values (v_session.id, p_sequence, v_key, p_byte_count, p_sha256);
  select i.* into v_intake from private.new_public_appeal_intakes i where i.id = v_session.intake_id;
  return jsonb_build_object('status', 'reserved', 'objectKey', v_key,
    'wrappedDataKey', encode(v_session.wrapped_document_key, 'hex'));
end;
$$;

create or replace function private.begin_appeal_document_completion_v1(
  p_session_id uuid, p_cookie_hash text, p_complete_nonce_hash text, p_chunk_count integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session private.appeal_document_sessions;
  v_count integer;
  v_bytes bigint;
  v_max integer;
  v_intake private.new_public_appeal_intakes;
begin
  if p_complete_nonce_hash is null or p_complete_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'claim document completion invalid';
  end if;
  select s.* into v_session from private.appeal_document_sessions s
  where s.id = p_session_id and s.cookie_hash = p_cookie_hash for update;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if private.appeal_document_session_for_v1(p_session_id,p_cookie_hash) is null then
   raise exception using errcode='42501',message='appeal unavailable';end if;
  if v_session.state <> 'open' then
    -- The same nonce may ask again for the outcome; nothing else may.
    if v_session.complete_nonce_hash is distinct from p_complete_nonce_hash then
      raise exception using errcode = '23505', message = 'claim document completion already used';
    end if;
    return private.appeal_document_status_v1(v_session);
  end if;
  v_session := private.appeal_document_session_for_v1(p_session_id, p_cookie_hash);
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'claim document session unavailable';
  end if;
  if exists (select 1 from private.appeal_document_sessions where complete_nonce_hash = p_complete_nonce_hash) then
    raise exception using errcode = '23505', message = 'claim document completion already used';
  end if;
  select count(*), coalesce(sum(byte_count), 0), coalesce(max(sequence), -1)
  into v_count, v_bytes, v_max
  from private.appeal_document_fragments where session_id = v_session.id and state = 'written';
  if p_chunk_count is null or p_chunk_count < 1 or p_chunk_count <> v_count or v_max <> v_count - 1
    or exists (select 1 from private.appeal_document_fragments where session_id = v_session.id and state <> 'written')
    or v_bytes <> v_session.declared_bytes then
    update private.appeal_document_sessions set complete_nonce_hash = p_complete_nonce_hash
    where id = v_session.id;
    perform private.fail_appeal_document_session_row_v1(v_session.id, 'integrity');
    return jsonb_build_object('status', 'refused', 'reason', 'integrity');
  end if;
  update private.appeal_document_sessions set state = 'composing', complete_nonce_hash = p_complete_nonce_hash,
    planned_object_key = 'appeal-case/' || v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text
      || case v_session.media_type when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' end
  where id = v_session.id
  returning * into v_session;
  select i.* into v_intake from private.new_public_appeal_intakes i where i.id = v_session.intake_id;
  return jsonb_build_object('status', 'compose',
    'documentId', v_session.document_id, 'documentKind', v_session.document_kind,
    'mediaType', v_session.media_type, 'sizeBytes', v_session.declared_bytes,
    'sha256', v_session.declared_sha256,
    'objectKey', v_session.planned_object_key,
    'wrappedDataKey', encode(v_session.wrapped_document_key, 'hex'),
    'fragments', (select jsonb_agg(jsonb_build_object('sequence', f.sequence, 'objectKey', f.object_key,
        'byteCount', f.byte_count, 'sha256', f.sha256) order by f.sequence)
      from private.appeal_document_fragments f where f.session_id = v_session.id));
end;
$$;
revoke all on function private.reserve_appeal_document_chunk_v1(uuid,text,integer,integer,text),
 private.begin_appeal_document_completion_v1(uuid,text,text,integer) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.reserve_appeal_document_chunk_v1(uuid,text,integer,integer,text),
 private.begin_appeal_document_completion_v1(uuid,text,text,integer) to service_role;
