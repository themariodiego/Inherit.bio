-- Owner decision, 28 September 2026 (docs/protocol/decisions.md): an
-- approved single-parent basis review is a retained human review decision.
-- The terminal purge of an abandoned attempt keeps it unchanged, and its
-- `target_id` keeps naming the deleted draft.
--
-- This restates 20260930130000's zero-residual check with one more closed,
-- named skip, and nothing else:
--   * `public.legal_reviews.target_id`, only for a row with
--     `target_kind = 'single_parent_basis'` and `decision = 'approved'`.
--     Register: the ingest-abandoned-no-source effect retains
--     "human-review-decisions". Any other review naming a deleted row, and
--     every other column of `legal_reviews`, still counts.
-- The reviewed evidence it approved holds only a document hash and the
-- review's id, so it names no deleted row and needs no skip.

create or replace function private.embryo_ingest_attempt_residue_v1(p_ids uuid[], p_objects text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  r record; col record; n bigint; v_total bigint;
  v_registered jsonb := '{}'::jsonb; v_unregistered jsonb := '{}'::jsonb; v_unverifiable integer := 0;
  v_retained_targets constant text[] := array['legal-audit-chain-retention','audit-principal-link-key-envelope'];
  v_control constant text[] := array['public.retention_rows','public.retention_due_phases'];
begin
  if p_ids is null or cardinality(p_ids) = 0 or array_position(p_ids, null) is not null then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  for r in
    select 'registered' kind, s.store_name, to_regclass(s.store_name) rel, s.target_id
      from public.purge_target_stores s
      where not (s.target_id = any (v_retained_targets))
    union all
    select 'unregistered', n2.nspname||'.'||c.relname, c.oid::regclass, null
      from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
      where n2.nspname in ('public','private') and c.relkind in ('r','p') and not c.relispartition
        and not exists (select 1 from public.purge_target_stores s where to_regclass(s.store_name) = c.oid)
        and not (n2.nspname||'.'||c.relname = any (v_control))
    order by 1, 2
  loop
    if r.rel is null then
      v_unverifiable := v_unverifiable + 1;
      continue;
    end if;
    v_total := 0;
    for col in select a.attname, a.atttypid from pg_attribute a
        where a.attrelid = r.rel and a.attnum > 0 and not a.attisdropped
          and a.atttypid in ('uuid'::regtype, 'uuid[]'::regtype)
        order by a.attnum
    loop
      if (r.store_name, col.attname::text) = ('private.invitation_terminal_notices', 'invitation_id') then
        continue;
      end if;
      if (r.store_name, col.attname::text) = ('public.legal_reviews', 'target_id') then
        -- The one retained review: an approved single-parent basis review
        -- keeps its target. Every other review naming a deleted row counts.
        select count(*) into n from public.legal_reviews lr
          where lr.target_id = any (p_ids)
            and not (lr.target_kind = 'single_parent_basis' and lr.decision = 'approved');
        v_total := v_total + n;
        continue;
      end if;
      execute format(case when col.atttypid = 'uuid'::regtype
          then 'select count(*) from %s where %I = any ($1)'
          else 'select count(*) from %s where %I && $1' end, r.rel, col.attname)
        into n using p_ids;
      v_total := v_total + n;
    end loop;
    if r.store_name = 'storage.objects' then
      -- By exact bucket and name, so the lookup uses the name index.
      select count(*) into n
        from unnest(coalesce(p_objects, '{}'::text[])) o(object)
        join storage.objects so on so.bucket_id = split_part(o.object, '/', 1)
          and so.name = substr(o.object, length(split_part(o.object, '/', 1)) + 2);
      v_total := v_total + n;
    end if;
    if v_total > 0 then
      if r.kind = 'registered' then
        v_registered := v_registered || jsonb_build_object(r.store_name, v_total);
      else
        v_unregistered := v_unregistered || jsonb_build_object(r.store_name, v_total);
      end if;
    end if;
  end loop;
  return jsonb_build_object('registered', v_registered, 'unregistered', v_unregistered,
    'unverifiable', v_unverifiable);
end $$;

-- The unwind planner's closed store check admits the same review, and only
-- it: 20260930120000's body, with `legal_reviews` checked by rule instead of
-- by table. Before this, no single-parent attempt could be planned at all.
create or replace function private.assert_embryo_unwind_plannable_stores_v1(p_targets uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare r record; v_exists boolean; v_allowed constant text[]:=array[
  'subjects','embryos','embryo_cohorts','embryo_cohort_drafts','embryo_participant_sets',
  'embryo_basis_bindings','embryo_donor_attributions','embryo_ingest_sessions','embryo_ingest_unwinds',
  'embryo_ingest_chunks','embryo_ingest_fragments','embryo_fragment_handle_maps','embryo_mapping_challenges',
  'embryo_draft_participants','draft_participant_slots','embryo_operation_nonces','consent_signatures','attestations',
  'attestation_contradictions','subject_invitations','mail_outbox','token_candidates','rights_sessions',
  'future_person_record_key_hashes','future_person_record_key_print_rights','future_person_record_key_recipients',
  'retention_rows','retention_due_phases','purge_manifests','purge_manifest_entries',
  'genome_files','genome_storage_objects','upload_sessions','worker_jobs'];
begin
  for r in select c.relname table_name,a.attname column_name from pg_class c
    join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname='public' and c.relkind='r' and not a.attisdropped and a.atttypid='uuid'::regtype
      and a.attname in ('cohort_id','subject_id','embryo_id','target_id','draft_id','embryo_draft_id','ingest_session_id','session_id')
      and not c.relname=any(v_allowed) and c.relname<>'legal_reviews'
  loop
    execute format('select exists(select 1 from public.%I where %I=any($1))',r.table_name,r.column_name)
      into v_exists using p_targets;
    if v_exists then raise exception using errcode='55000',message='unsupported unwind store'; end if;
  end loop;
  -- The one review a purge retains: an approved single-parent basis review.
  -- Any other review naming the attempt is still an unsupported store.
  if exists(select 1 from public.legal_reviews lr where lr.target_id=any(p_targets)
      and not (lr.target_kind='single_parent_basis' and lr.decision='approved')) then
    raise exception using errcode='55000',message='unsupported unwind store';
  end if;
  if exists(select 1 from public.worker_jobs w
    where (w.cohort_id=any(p_targets) or w.subject_id=any(p_targets))
      and not (w.kind='split_cohort_vcf' and w.output_kind='ingest.normalize'
        and w.source_binding_kind='embryo-ingest-fragment-set'
        and w.source_binding_id=any(p_targets))) then
    raise exception using errcode='55000',message='unsupported unwind store';
  end if;
end $$;
