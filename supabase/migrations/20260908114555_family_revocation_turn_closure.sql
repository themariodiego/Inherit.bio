-- Physical residual repair for the existing explicit revoke/stop helper.
-- Global reversible Pause sharing does not call this function. This does not
-- certify or terminalize the separate generic family purge jobs/manifests.
create or replace function private.delete_pair_derived_rows_v1(
  p_pair_ids uuid[], p_recipient_account_id uuid, p_subject_ids uuid[], p_purpose text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_portrait_count integer := 0;
  v_message_count integer := 0;
  v_turns jsonb;
begin
  -- Both supported paired-turn writers lock their parent chat before append.
  -- Capture membership while holding those same locks, before deleting any
  -- provenance. Never expand a recipient selection into another user's chat.
  perform 1 from public.chats c
  where c.family_pair_id = any(p_pair_ids)
    or (c.user_id = p_recipient_account_id and cardinality(p_subject_ids) > 0)
    or exists(select 1 from public.copilot_turn_dependencies d
      where d.chat_id=c.id and d.dependency_kind='pair' and d.dependency_id=any(p_pair_ids))
  order by c.id for update;

  with seeds as (
    select m.chat_id, m.turn_id from public.chat_messages m
    join public.chats c on c.id=m.chat_id
    where c.family_pair_id=any(p_pair_ids)
      or (c.user_id=p_recipient_account_id and m.user_id=c.user_id
        and m.retrieved_subject_ids && p_subject_ids
        and (p_purpose is null or m.retrieved_purpose_keys @> array[p_purpose]))
    union
    select h.chat_id, h.turn_id from public.copilot_context_history h
    join public.chats c on c.id=h.chat_id
    where c.family_pair_id=any(p_pair_ids)
      or (c.user_id=p_recipient_account_id and h.retrieved_subject_ids && p_subject_ids
        and (p_purpose is null or h.retrieved_purpose_keys @> array[p_purpose]))
    union
    select d.chat_id, d.turn_id from public.copilot_turn_dependencies d
    join public.chats c on c.id=d.chat_id
    where c.family_pair_id=any(p_pair_ids)
      or (d.dependency_kind='pair' and d.dependency_id=any(p_pair_ids))
      or (c.user_id=p_recipient_account_id and (
        -- A grant dependency supplies its own exact subject, purpose and
        -- revision; it need not duplicate those facts on the assistant row.
        (d.dependency_kind='grant' and exists(select 1 from public.purpose_grants g
          join public.directional_grants dg on dg.grant_id=g.grant_id
            and dg.grant_revision=g.grant_revision
          where g.grant_id=d.dependency_id and g.grant_revision=d.dependency_revision
            and g.target_kind='subject' and g.target_id=any(p_subject_ids)
            and dg.recipient_account_id=p_recipient_account_id
            and (p_purpose is null or g.purpose=p_purpose)))
        or (p_purpose is null and (
          (d.dependency_kind='subject' and d.dependency_id=any(p_subject_ids))
          or (d.dependency_kind='file' and exists(select 1 from public.genome_files f
            where f.id=d.dependency_id and f.subject_id=any(p_subject_ids)))
          or (d.dependency_kind='relationship' and exists(select 1 from public.subject_relationships r
            where r.id=d.dependency_id and r.subject_id=any(p_subject_ids)
              and r.recipient_account_id=p_recipient_account_id))
        ))
      ))
  ), cutoffs as (
    select m.chat_id,min(m.turn_ordinal) as ordinal
    from public.chat_messages m join seeds s using(chat_id,turn_id)
    group by m.chat_id
  ), selected as (
    -- A later turn consumed the prior conversation. Keep the independent
    -- prefix, delete both roles of the first affected turn and its suffix.
    select m.chat_id,m.turn_id from public.chat_messages m
    join cutoffs c on c.chat_id=m.chat_id and m.turn_ordinal>=c.ordinal
    union select chat_id,turn_id from seeds
  )
  select coalesce(jsonb_agg(to_jsonb(s) order by s.chat_id,s.turn_id),'[]'::jsonb)
  into v_turns from selected s;

  if cardinality(p_pair_ids)>0 then
    delete from public.portrait_results where family_pair_id=any(p_pair_ids);
    get diagnostics v_portrait_count=row_count;
  end if;
  delete from public.copilot_context_tokens t
  where (t.scope_kind='family' and t.target_id=any(p_pair_ids))
    or (t.account_id=p_recipient_account_id and t.target_id=any(p_subject_ids))
    or exists(select 1 from jsonb_to_recordset(v_turns) as x(chat_id uuid,turn_id uuid)
      where x.chat_id=t.chat_id);

  -- These stores reference chats, not messages; deleting them first has no
  -- cascade into another turn/chat. Preserve parent chats and independent
  -- source/result rows. Remove orphan metadata for an exactly matched turn too.
  delete from public.copilot_turn_dependencies d
  using jsonb_to_recordset(v_turns) as x(chat_id uuid,turn_id uuid)
  where d.chat_id=x.chat_id and d.turn_id=x.turn_id;
  delete from public.copilot_context_history h
  using jsonb_to_recordset(v_turns) as x(chat_id uuid,turn_id uuid)
  where h.chat_id=x.chat_id and h.turn_id=x.turn_id;
  delete from public.chat_messages m
  using jsonb_to_recordset(v_turns) as x(chat_id uuid,turn_id uuid)
  where m.chat_id=x.chat_id and m.turn_id=x.turn_id;
  get diagnostics v_message_count=row_count;

  if exists(select 1 from jsonb_to_recordset(v_turns) as x(chat_id uuid,turn_id uuid)
    where exists(select 1 from public.chat_messages m where m.chat_id=x.chat_id and m.turn_id=x.turn_id)
      or exists(select 1 from public.copilot_context_history h where h.chat_id=x.chat_id and h.turn_id=x.turn_id)
      or exists(select 1 from public.copilot_turn_dependencies d where d.chat_id=x.chat_id and d.turn_id=x.turn_id))
  then raise exception using errcode='55000',message='family_turn_purge_residual'; end if;
  return jsonb_build_object('portrait_results',v_portrait_count,'chat_messages',v_message_count);
end;
$$;

-- Preserve the existing internal ABI and service-only privilege boundary.
revoke all on function private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)
  from public,anon,authenticated,inherit_upload_only;
grant execute on function private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text) to service_role;
