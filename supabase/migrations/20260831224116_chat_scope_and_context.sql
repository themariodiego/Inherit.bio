-- Immutable Copilot scope and atomic, provenance-bound turn pairs.

alter table public.chats
  add column scope_kind text,
  add column subject_id uuid references public.subjects (id) on delete restrict,
  add column cohort_id uuid references public.embryo_cohorts (id) on delete restrict,
  add column family_pair_id uuid references public.family_pairs (id) on delete restrict,
  add column report_id uuid,
  add column scope_revision bigint not null default 1 check (scope_revision > 0),
  add column lifecycle_revision bigint,
  add column grant_revision bigint,
  add column relationship_revision bigint,
  add column provider_classification text,
  add column runtime_attestation_revision bigint,
  add column model_recipient_revision bigint,
  add column cohort_authority_fingerprint text,
  add column authorization_fingerprint text,
  add column legacy_unverified boolean not null default true;

update public.chats c
set scope_kind = 'self',
    subject_id = s.id,
    lifecycle_revision = s.lifecycle_revision,
    provider_classification = 'local',
    runtime_attestation_revision = 1,
    model_recipient_revision = 1,
    authorization_fingerprint = encode(extensions.digest(
      convert_to('legacy-chat|' || c.id::text || '|' || s.id::text, 'utf8'), 'sha256'
    ), 'hex')
from public.subjects s
where s.subject_class = 'self' and s.subject_account_id = c.user_id;

alter table public.chats
  alter column scope_kind set not null,
  alter column lifecycle_revision set not null,
  alter column provider_classification set not null,
  alter column runtime_attestation_revision set not null,
  alter column model_recipient_revision set not null,
  alter column authorization_fingerprint set not null,
  add constraint chats_scope_kind_check check (scope_kind in ('self', 'subject', 'family', 'cohort', 'report')),
  add constraint chats_scope_target_check check (
    (scope_kind in ('self', 'subject') and subject_id is not null and num_nonnulls(cohort_id, family_pair_id, report_id) = 0)
    or (scope_kind = 'cohort' and cohort_id is not null and num_nonnulls(subject_id, family_pair_id, report_id) = 0)
    or (scope_kind = 'family' and family_pair_id is not null and num_nonnulls(subject_id, cohort_id, report_id) = 0)
    or (scope_kind = 'report' and report_id is not null and num_nonnulls(subject_id, cohort_id, family_pair_id) = 0)
  ),
  add constraint chats_fingerprint_check check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint chats_cohort_fingerprint_check check (
    (scope_kind = 'cohort') = (cohort_authority_fingerprint is not null)
    and (cohort_authority_fingerprint is null or cohort_authority_fingerprint ~ '^[0-9a-f]{64}$')
  );

create or replace function private.guard_chat_scope_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    new.user_id, new.scope_kind, new.subject_id, new.cohort_id,
    new.family_pair_id, new.report_id, new.scope_revision
  ) is distinct from row(
    old.user_id, old.scope_kind, old.subject_id, old.cohort_id,
    old.family_pair_id, old.report_id, old.scope_revision
  ) then
    raise exception using errcode = '23514', message = 'chat scope is immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_chat_scope_update() from public, anon, authenticated;
grant execute on function private.guard_chat_scope_update() to service_role;
create trigger chats_scope_immutable before update on public.chats
for each row execute function private.guard_chat_scope_update();

create or replace function private.valid_embryo_findings(p_value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(p_value) item
      where jsonb_typeof(item) <> 'object'
        or (select array_agg(k order by k) from jsonb_object_keys(item) k)
          is distinct from array[
            'citation_ids', 'condition_id', 'condition_name', 'coverage_state',
            'embryo_label', 'evidence_label', 'finding', 'not_covered_reason'
          ]::text[]
        or jsonb_typeof(item -> 'citation_ids') <> 'array'
        or jsonb_typeof(item -> 'condition_id') <> 'string'
        or jsonb_typeof(item -> 'condition_name') <> 'string'
        or jsonb_typeof(item -> 'coverage_state') <> 'string'
        or jsonb_typeof(item -> 'embryo_label') <> 'string'
        or jsonb_typeof(item -> 'evidence_label') <> 'string'
        or not (jsonb_typeof(item -> 'finding') in ('object', 'null'))
        or not (jsonb_typeof(item -> 'not_covered_reason') in ('string', 'null'))
        or coalesce((item -> 'finding') ?| array['sex', 'embryo_sex', 'karyotype', 'rank', 'score', 'recommendation'], false)
    )
$$;

revoke all on function private.valid_embryo_findings(jsonb) from public, anon, authenticated;
grant execute on function private.valid_embryo_findings(jsonb) to service_role;

alter table public.chat_messages
  add column turn_id uuid,
  add column turn_ordinal bigint,
  add column paired_role text,
  add column scope_revision bigint,
  add column authorization_fingerprint text,
  add column retrieved_subject_ids uuid[] not null default '{}',
  add column retrieved_purpose_keys text[] not null default '{}',
  add column contributor_ids uuid[] not null default '{}',
  add column grant_revisions bigint[] not null default '{}',
  add column lifecycle_revisions bigint[] not null default '{}',
  add column provider_classification text,
  add column runtime_attestation_revision bigint,
  add column model_recipient_revision bigint,
  add column cohort_authority_fingerprint text,
  add column citation_ids text[] not null default '{}',
  add column embryo_findings jsonb not null default '[]'::jsonb,
  add column legacy_unverified boolean not null default true;

with numbered as (
  select id, row_number() over (partition by chat_id order by created_at, id)::bigint as row_number_value
  from public.chat_messages
)
update public.chat_messages m
set turn_id = gen_random_uuid(),
    turn_ordinal = row_number_value,
    paired_role = case when m.role = 'assistant' then 'assistant' else 'user' end,
    scope_revision = c.scope_revision,
    authorization_fingerprint = c.authorization_fingerprint,
    provider_classification = c.provider_classification,
    runtime_attestation_revision = c.runtime_attestation_revision,
    model_recipient_revision = c.model_recipient_revision,
    cohort_authority_fingerprint = c.cohort_authority_fingerprint
from public.chats c, numbered
where c.id = m.chat_id and numbered.id = m.id;

alter table public.chat_messages
  alter column turn_id set not null,
  alter column turn_ordinal set not null,
  alter column paired_role set not null,
  alter column scope_revision set not null,
  alter column authorization_fingerprint set not null,
  alter column provider_classification set not null,
  alter column runtime_attestation_revision set not null,
  alter column model_recipient_revision set not null,
  add constraint chat_messages_paired_role_check check (paired_role in ('user', 'assistant')),
  add constraint chat_messages_fingerprint_check check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint chat_messages_embryo_findings_check check (private.valid_embryo_findings(embryo_findings)),
  add constraint chat_messages_noncohort_findings_check check (
    cohort_authority_fingerprint is not null or embryo_findings = '[]'::jsonb
  );

create unique index chat_messages_turn_role_idx
  on public.chat_messages (chat_id, turn_id, paired_role);
create index chat_messages_turn_order_idx
  on public.chat_messages (chat_id, turn_ordinal, paired_role);

create or replace function private.persist_chat_turn_pair_v1(
  p_chat_id uuid,
  p_account_id uuid,
  p_user_content jsonb,
  p_assistant_content jsonb,
  p_embryo_findings jsonb default '[]'::jsonb,
  p_citation_ids text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat public.chats;
  v_turn_id uuid := gen_random_uuid();
  v_ordinal bigint;
begin
  select * into v_chat from public.chats
  where id = p_chat_id and user_id = p_account_id for update;
  if v_chat.id is null or v_chat.legacy_unverified then
    raise exception using errcode = '42501', message = 'chat scope is unavailable';
  end if;
  if not private.valid_embryo_findings(coalesce(p_embryo_findings, '[]'::jsonb))
    or (v_chat.scope_kind <> 'cohort' and p_embryo_findings <> '[]'::jsonb) then
    raise exception using errcode = '23514', message = 'chat embryo findings are invalid';
  end if;
  select coalesce(max(turn_ordinal), 0) + 1 into v_ordinal
  from public.chat_messages where chat_id = p_chat_id;

  insert into public.chat_messages (
    chat_id, user_id, role, content, turn_id, turn_ordinal, paired_role,
    scope_revision, authorization_fingerprint, provider_classification,
    runtime_attestation_revision, model_recipient_revision,
    cohort_authority_fingerprint, embryo_findings, citation_ids, legacy_unverified
  ) values
  (
    p_chat_id, p_account_id, 'user', p_user_content, v_turn_id, v_ordinal, 'user',
    v_chat.scope_revision, v_chat.authorization_fingerprint, v_chat.provider_classification,
    v_chat.runtime_attestation_revision, v_chat.model_recipient_revision,
    v_chat.cohort_authority_fingerprint, p_embryo_findings, '{}', false
  ),
  (
    p_chat_id, p_account_id, 'assistant', p_assistant_content, v_turn_id, v_ordinal, 'assistant',
    v_chat.scope_revision, v_chat.authorization_fingerprint, v_chat.provider_classification,
    v_chat.runtime_attestation_revision, v_chat.model_recipient_revision,
    v_chat.cohort_authority_fingerprint, p_embryo_findings, p_citation_ids, false
  );
  return v_turn_id;
end;
$$;

revoke all on function private.persist_chat_turn_pair_v1(uuid, uuid, jsonb, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function private.persist_chat_turn_pair_v1(uuid, uuid, jsonb, jsonb, jsonb, text[])
  to service_role;

revoke all on table public.chats, public.chat_messages from anon, authenticated;
grant all on table public.chats, public.chat_messages to service_role;
