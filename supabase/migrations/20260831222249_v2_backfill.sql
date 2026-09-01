-- Lossless v1-to-v2 attribution backfill.

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on
)
select
  'consent.self-source-migrated',
  1,
  encode(digest(convert_to(
    'Existing self-upload authorization migrated without changing the account data.',
    'UTF8'
  ), 'sha256'), 'hex'),
  'Existing self-upload authorization migrated without changing the account data.',
  'This record preserves the authorization under which the account uploaded its own data.',
  date '2026-09-01'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'consent.self-source-migrated' and version = 1
);

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on
)
select
  'consent.cloud-model-migrated',
  1,
  encode(digest(convert_to(
    'Existing cloud-model authorization migrated without broadening its provider or data classes.',
    'UTF8'
  ), 'sha256'), 'hex'),
  'Existing cloud-model authorization migrated without broadening its provider or data classes.',
  'This record preserves an existing provider-specific cloud-model authorization.',
  date '2026-09-01'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'consent.cloud-model-migrated' and version = 1
);

insert into public.subjects (
  owner_account_id,
  subject_account_id,
  subject_class,
  upload_class,
  display_label,
  lifecycle
)
select
  p.id,
  p.id,
  'self',
  'self',
  coalesce(nullif(btrim(p.display_name), ''), 'You'),
  'active'
from public.profiles p
where not exists (
  select 1 from public.subjects s
  where s.subject_account_id = p.id and s.subject_class = 'self'
);

insert into public.subject_principals (
  subject_id,
  account_id,
  principal_kind,
  status
)
select s.id, s.subject_account_id, 'account_subject', 'active'
from public.subjects s
where s.subject_class = 'self'
  and not exists (
    select 1 from public.subject_principals sp
    where sp.subject_id = s.id
      and sp.account_id = s.subject_account_id
      and sp.principal_kind = 'account_subject'
      and sp.status = 'active'
  );

insert into public.subject_account_bindings (
  subject_id,
  subject_principal_id,
  account_id,
  account_principal_id,
  binding_kind,
  binding_revision,
  status
)
select s.id, sp.id, s.subject_account_id, sp.id, 'self', 1, 'current'
from public.subjects s
join public.subject_principals sp
  on sp.subject_id = s.id
 and sp.account_id = s.subject_account_id
 and sp.principal_kind = 'account_subject'
 and sp.status = 'active'
where s.subject_class = 'self'
  and not exists (
    select 1 from public.subject_account_bindings sab
    where sab.subject_id = s.id and sab.status = 'current'
  );

insert into public.subject_relationships (
  subject_id,
  data_subject_principal_id,
  recipient_principal_id,
  recipient_account_id,
  relationship_kind,
  relationship_revision,
  status
)
select s.id, sp.id, sp.id, s.subject_account_id, 'self', 1, 'current'
from public.subjects s
join public.subject_principals sp
  on sp.subject_id = s.id
 and sp.account_id = s.subject_account_id
 and sp.principal_kind = 'account_subject'
 and sp.status = 'active'
where s.subject_class = 'self'
  and not exists (
    select 1 from public.subject_relationships sr
    where sr.subject_id = s.id
      and sr.data_subject_principal_id = sp.id
      and sr.recipient_principal_id = sp.id
      and sr.relationship_kind = 'self'
      and sr.status = 'current'
  );

insert into public.consent_signatures (
  artifact_key,
  artifact_version,
  artifact_body_sha256,
  signer_principal_id,
  signer_account_id,
  target_kind,
  target_id,
  purpose,
  statement_keys,
  jurisdiction_code,
  jurisdiction_revision,
  subject_binding_revision,
  signed_at
)
select
  ca.artifact_key,
  ca.version,
  ca.body_sha256,
  sp.id,
  s.subject_account_id,
  'subject',
  s.id,
  'self-source-migrated',
  array['self-upload-authorization'],
  coalesce(p.jurisdiction_code, 'ZZ'),
  p.jurisdiction_revision,
  s.subject_binding_revision,
  s.created_at
from public.subjects s
join public.profiles p on p.id = s.subject_account_id
join public.subject_principals sp
  on sp.subject_id = s.id
 and sp.account_id = s.subject_account_id
 and sp.principal_kind = 'account_subject'
 and sp.status = 'active'
join public.consent_artifacts ca
  on ca.artifact_key = 'consent.self-source-migrated' and ca.version = 1
where s.subject_class = 'self'
  and not exists (
    select 1 from public.consent_signatures cs
    where cs.target_kind = 'subject'
      and cs.target_id = s.id
      and cs.artifact_key = 'consent.self-source-migrated'
      and cs.artifact_version = 1
  );

insert into public.subject_consents (
  signature_id,
  subject_id,
  account_id,
  consent_type,
  scope,
  grant_revision,
  granted_at
)
select
  cs.id,
  s.id,
  s.subject_account_id,
  'self_source',
  array['variants', 'reports.monogenic', 'reports.polygenic', 'ancestry', 'copilot.local', 'family.portrait', 'raw.export'],
  1,
  cs.signed_at
from public.subjects s
join public.consent_signatures cs
  on cs.target_kind = 'subject'
 and cs.target_id = s.id
 and cs.artifact_key = 'consent.self-source-migrated'
 and cs.artifact_version = 1
where s.subject_class = 'self'
  and not exists (
    select 1 from public.subject_consents sc
    where sc.subject_id = s.id
      and sc.consent_type = 'self_source'
      and sc.revoked_at is null
  );

-- Preserve any legacy provider-specific cloud-model authorization. The legacy
-- table remains read-only for export fidelity.
insert into public.consent_signatures (
  artifact_key,
  artifact_version,
  artifact_body_sha256,
  signer_principal_id,
  signer_account_id,
  target_kind,
  target_id,
  purpose,
  statement_keys,
  jurisdiction_code,
  jurisdiction_revision,
  subject_binding_revision,
  signed_at
)
select
  ca.artifact_key,
  ca.version,
  ca.body_sha256,
  sp.id,
  cg.user_id,
  'subject',
  s.id,
  'cloud-model-migrated:' || cg.provider_key,
  array['cloud-model-provider-authorization'],
  coalesce(p.jurisdiction_code, 'ZZ'),
  p.jurisdiction_revision,
  s.subject_binding_revision,
  cg.granted_at
from public.consent_grants cg
join public.subjects s
  on s.subject_account_id = cg.user_id and s.subject_class = 'self'
join public.profiles p on p.id = cg.user_id
join public.subject_principals sp
  on sp.subject_id = s.id
 and sp.account_id = cg.user_id
 and sp.principal_kind = 'account_subject'
 and sp.status = 'active'
join public.consent_artifacts ca
  on ca.artifact_key = 'consent.cloud-model-migrated' and ca.version = 1
where cg.revoked_at is null
  and not exists (
    select 1 from public.consent_signatures cs
    where cs.target_kind = 'subject'
      and cs.target_id = s.id
      and cs.purpose = 'cloud-model-migrated:' || cg.provider_key
  );

insert into public.subject_consents (
  signature_id,
  subject_id,
  account_id,
  consent_type,
  scope,
  provider_key,
  grant_revision,
  granted_at
)
select
  cs.id,
  s.id,
  cg.user_id,
  'cloud_model',
  case when cardinality(cg.data_classes) > 0 then cg.data_classes else array['self'] end,
  cg.provider_key,
  1,
  cg.granted_at
from public.consent_grants cg
join public.subjects s
  on s.subject_account_id = cg.user_id and s.subject_class = 'self'
join public.consent_signatures cs
  on cs.target_kind = 'subject'
 and cs.target_id = s.id
 and cs.purpose = 'cloud-model-migrated:' || cg.provider_key
where cg.revoked_at is null
  and not exists (
    select 1 from public.subject_consents sc
    where sc.subject_id = s.id
      and sc.consent_type = 'cloud_model'
      and sc.provider_key = cg.provider_key
      and sc.revoked_at is null
  );

revoke insert, update, delete on table public.consent_grants from authenticated;

alter table public.genome_files
  add column subject_id uuid references public.subjects (id) on delete restrict;
alter table public.user_variants
  add column subject_id uuid references public.subjects (id) on delete restrict;
alter table public.ancestry_results
  add column subject_id uuid references public.subjects (id) on delete restrict;
alter table public.user_prs
  add column subject_id uuid references public.subjects (id) on delete restrict;

update public.genome_files gf
set subject_id = s.id
from public.subjects s
where s.subject_account_id = gf.user_id
  and s.subject_class = 'self'
  and gf.subject_id is null;

update public.user_variants uv
set subject_id = gf.subject_id
from public.genome_files gf
where gf.id = uv.file_id
  and uv.subject_id is null;

update public.ancestry_results ar
set subject_id = s.id
from public.subjects s
where s.subject_account_id = ar.user_id
  and s.subject_class = 'self'
  and ar.subject_id is null;

update public.user_prs up
set subject_id = s.id
from public.subjects s
where s.subject_account_id = up.user_id
  and s.subject_class = 'self'
  and up.subject_id is null;

do $$
begin
  if exists (select 1 from public.genome_files where subject_id is null) then
    raise exception 'v2 backfill left a genome_files subject_id null';
  end if;
  if exists (select 1 from public.user_variants where subject_id is null) then
    raise exception 'v2 backfill left a user_variants subject_id null';
  end if;
  if exists (select 1 from public.ancestry_results where subject_id is null) then
    raise exception 'v2 backfill left an ancestry_results subject_id null';
  end if;
  if exists (select 1 from public.user_prs where subject_id is null) then
    raise exception 'v2 backfill left a user_prs subject_id null';
  end if;
  if exists (
    select 1
    from public.genome_files gf
    join public.subjects s on s.id = gf.subject_id
    where s.owner_account_id is distinct from gf.user_id
  ) then
    raise exception 'v2 backfill cross-account genome_files attribution';
  end if;
  if exists (
    select 1
    from public.user_variants uv
    join public.subjects s on s.id = uv.subject_id
    where s.owner_account_id is distinct from uv.user_id
  ) then
    raise exception 'v2 backfill cross-account user_variants attribution';
  end if;
  if exists (
    select 1
    from public.ancestry_results ar
    join public.subjects s on s.id = ar.subject_id
    where s.owner_account_id is distinct from ar.user_id
  ) then
    raise exception 'v2 backfill cross-account ancestry_results attribution';
  end if;
  if exists (
    select 1
    from public.user_prs up
    join public.subjects s on s.id = up.subject_id
    where s.owner_account_id is distinct from up.user_id
  ) then
    raise exception 'v2 backfill cross-account user_prs attribution';
  end if;
end;
$$;

alter table public.user_variants alter column subject_id set not null;
alter table public.ancestry_results alter column subject_id set not null;
alter table public.user_prs alter column subject_id set not null;

create index genome_files_subject_idx on public.genome_files (subject_id, created_at desc);
create index user_variants_subject_rsid_idx
  on public.user_variants (subject_id, rsid) where rsid is not null;
create index user_variants_subject_pos_idx
  on public.user_variants (subject_id, chrom, pos);
create index ancestry_results_subject_idx
  on public.ancestry_results (subject_id, created_at desc);
create index user_prs_subject_idx
  on public.user_prs (subject_id, computed_at desc);
