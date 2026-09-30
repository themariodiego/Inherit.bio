-- Restriction deletes the cohort's canonical sources (owner decision,
-- 28 September 2026; docs/protocol/decisions.md). TEST-LOCAL only.
--
-- `private.delete_embryo_cohort_sources_v1(cohort, reason)` calls
-- `private.plan_embryo_source_deletion_v1` with every canonical source file of
-- the cohort. `public.restrict_embryo_cohort_v1` keeps its signature, grants,
-- checks, lock order and every earlier effect. After it deletes the cohort's
-- QC, scores, figures and genotypes, it calls the helper at one marked point,
-- in the same transaction. That deletes each membership, source
-- and `genome_files` row, and proves no store still names a deleted file. The
-- parts stay under a `purpose = 'source'` unwind. The same claim, finish and
-- confirm doors dispose of them, and `complete_embryo_ingest_unwind_v1`
-- deletes the rows once their markers are proved. If the planner refuses,
-- for example because something else still depends on a file, the whole
-- restriction rolls back. Nothing is half-restricted.
--
-- api.embryo-withdraw is an alias of this door (src/app/api/embryo-cohorts/
-- [id]/withdraw/route.ts has no write path of its own), so withdrawal gets
-- the same deletion. No other function restricts a cohort.

-- Every canonical source of one cohort, through the source-deletion planner
-- (20260930132000): membership, source, genotypes and `genome_files` row now,
-- parts after their markers are proved. A cohort with no source is a no-op.
-- The caller holds the cohort lock. No grant for any role: only the
-- restriction and withdrawal paths call it.
create function private.delete_embryo_cohort_sources_v1(p_cohort_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_files uuid[];
begin
  if p_cohort_id is null or p_reason is null or p_reason not in ('restriction','withdrawal') then
    raise exception using errcode='22023', message='invalid_request';
  end if;
  perform 1 from public.embryo_cohorts where id = p_cohort_id for update;
  if not found then raise exception using errcode='42501', message='cohort unavailable'; end if;
  select array_agg(x.file_id order by x.file_id) into v_files
    from private.embryo_canonical_sources x where x.cohort_id = p_cohort_id;
  if v_files is null then
    return jsonb_build_object('status','none','sources',0);
  end if;
  return private.plan_embryo_source_deletion_v1(v_files, p_reason);
end $$;
revoke all on function private.delete_embryo_cohort_sources_v1(uuid, text)
  from public, anon, authenticated, inherit_upload_only, service_role;

create or replace function public.restrict_embryo_cohort_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_cohort_id uuid,
  p_token_nonce text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cohort public.embryo_cohorts%rowtype;
  v_actor uuid;
  v_recipient uuid;
  v_grant record;
begin
  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = p_cohort_id
  for update;
  if v_cohort.id is null then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'cohort_restrict',
    'cohort', v_cohort.id
  );

  v_actor := private.acting_embryo_principal_v1(
    p_account_id, private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities')
  );
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not a disposition authority';
  end if;
  if v_cohort.status not in ('upload_pending', 'ingesting', 'active') then
    raise exception using errcode = '55000', message = 'already restricted';
  end if;

  update public.embryo_cohorts
  set status = 'restricted', lifecycle_revision = lifecycle_revision + 1
  where id = v_cohort.id;

  update public.subjects
  set lifecycle = 'restricted', lifecycle_revision = lifecycle_revision + 1,
      updated_at = v_now
  where cohort_id = v_cohort.id and lifecycle <> 'purged';

  delete from public.embryo_figures f
  using public.embryo_scores sc, public.embryos e
  where f.finding_id = sc.id and sc.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_scores sc
  using public.embryos e
  where sc.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_qc q
  using public.embryos e
  where q.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_variants v
  using public.embryos e
  where v.embryo_id = e.id and e.cohort_id = v_cohort.id;

  -- ==== SOURCE DELETION (20260930150000) ====
  -- Owner decision, 28 September 2026: restriction deletes the cohort's
  -- canonical sources, in this transaction. This one call moves into the
  -- restriction core when the withdrawal branch lands.
  perform private.delete_embryo_cohort_sources_v1(v_cohort.id, 'restriction');
  -- ==== END SOURCE DELETION ====

  update public.future_person_record_key_hashes h
  set status = 'revoked', ended_at = v_now
  from public.embryos e
  where h.embryo_id = e.id and e.cohort_id = v_cohort.id and h.status = 'current';
  update public.future_person_record_key_print_rights pr
  set status = 'revoked'
  from public.embryos e
  where pr.embryo_id = e.id and e.cohort_id = v_cohort.id and pr.status = 'unconsumed';

  for v_grant in
    select pg.grant_id
    from public.purpose_grants pg
    where pg.target_kind = 'cohort' and pg.target_id = v_cohort.id
      and pg.revoked_at is null
    for update
  loop
    update public.purpose_grants
    set revoked_at = v_now, revocation_reason = 'cohort_restricted'
    where grant_id = v_grant.grant_id;
    update public.directional_grants
    set status = 'revoked', ended_at = v_now
    where grant_id = v_grant.grant_id and status = 'current';
  end loop;

  foreach v_recipient in array private.embryo_cohort_set_v1(v_cohort.id, 'notice_recipients') loop
    perform private.enqueue_embryo_principal_mail_v1(
      v_recipient, 'cohort-restriction-notice', 'cohort-restriction-notice',
      'cohort', v_cohort.id,
      jsonb_build_object('embryoCount', v_cohort.embryo_count),
      encode(extensions.digest(convert_to(
        concat_ws(':', 'cohort-restriction-notice', v_cohort.id::text,
          v_recipient::text), 'UTF8'), 'sha256'), 'hex'),
      v_now + interval '30 days', null, null
    );
  end loop;

  perform private.append_legal_audit_event(
    'embryo.cohort.restricted', null, 'api.cohort-restrict', 'accepted',
    jsonb_build_object('embryo_count', v_cohort.embryo_count)
  );
end;
$$;

revoke all on function public.restrict_embryo_cohort_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.restrict_embryo_cohort_v1(uuid, uuid, uuid, text)
  to service_role;
