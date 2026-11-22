"""Write the kit's production-readonly-prechecks.sql from the rehearsal's guard map and the
release notes' per-migration pre-checks.

    python3 -I make-prechecks.py <out.sql>

Inputs (committed next to this script): ../data/guard-map.json (guards.py: every md5 of
the 21 migrations, mapped on the mirror of release 3's rehearsed post-state) and
../data/referenced-identifiers.tsv (idents.py). The release notes give one pre-check
SELECT per migration, each for the state just before that migration (steps.py ran every
one there; all hold). At the start of the release only some of their columns mean the
same thing, so this file keeps, per migration, what can be read before batch 1:
  * every md5 pin, in any of the 21 files, on a function body that exists before this
    release and that no earlier migration of the release changes (the guard map's `pin`
    rows with origin `pre-state`), with the ACL the mirror holds; and every constraint
    definition md5 pinned the same way;
  * the notes' data and catalog conditions that do not depend on an earlier migration of
    this release (their must_be_* columns, renamed m<NN>_..., each checked against the
    file it belongs to);
  * every object the release creates must be absent; the functions and relations the
    files name must exist;
  * the notes' context_* columns, the sizes of the tables batches lock, and the session.
Pins on bodies an earlier migration of this release writes are proven by the dry runs.
"""
import json
import os
import sys

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
gm = json.load(open(os.path.join(D, 'guard-map.json')))['guards']
ids = [l.rstrip('\n').split('|') for l in open(os.path.join(D, 'referenced-identifiers.tsv')) if l.strip()]


def lit(s):
    return "'" + s.replace("'", "''") + "'"


def arr(xs):
    return 'array[' + ','.join(lit(x) for x in xs) + ']::text[]'


def dyn(objs, query, typ):
    """A value read only when the objects it names exist (None of them may be created by
    this release; some are created by releases 1-3). The query runs through query_to_xml,
    so a state without them (an earlier release missing) gives NULL instead of failing the
    whole SELECT; NULL is never 0, so a must_be_zero key that reads one is a stop."""
    cond = ' and '.join(f"pg_catalog.to_reg{'class' if k == 'rel' else 'procedure'}({lit(n)}) is not null" for k, n in objs)
    return (f"(case when {cond} then (pg_catalog.xpath('/row/v/text()', pg_catalog.query_to_xml("
            f"{lit('select (' + query + ') as v')}, false, true, '')))[1]::text::{typ} end)")


fns, order = {}, []
for g in gm:
    if g['kind'] != 'pin' or not g['origin'].startswith('pre-state'):
        continue
    key = (g['regproc'], g['measure'])
    if key not in fns:
        fns[key] = dict(regproc=g['regproc'], measure=g['measure'], want=[], acl=g['acl'],
                        origin=g['origin'][len('pre-state: '):], refs=[])
        order.append(key)
    if g['md5'] not in fns[key]['want']:
        fns[key]['want'].append(g['md5'])
    ref = f"#{g['index']:02d}:{g['line']}"
    if ref not in fns[key]['refs']:
        fns[key]['refs'].append(ref)
assert all(len(v['want']) == 1 for v in fns.values())
cons = {}
for g in gm:
    if g['kind'] == 'constraint' and g['role'] == 'pin' and g['origin'] == 'pre-state':
        c = cons.setdefault(g['constraint'], dict(want=g['md5'], refs=[]))
        assert c['want'] == g['md5']
        c['refs'].append(f"#{g['index']:02d}:{g['line']}")
order.sort(key=lambda k: (min(int(r[1:3]) for r in fns[k]['refs']), k))
vals = ',\n  '.join(
    f"({lit(' '.join(fns[k]['refs'][:4]) + (' ...' if len(fns[k]['refs']) > 4 else ''))}, {lit(fns[k]['regproc'])}, "
    f"{lit(fns[k]['measure'])}, {lit(fns[k]['want'][0])}, {lit(fns[k]['acl'])}, {lit(fns[k]['origin'])})" for k in order)
cvals = ',\n  '.join(
    f"({lit(' '.join(v['refs']))}, {lit(c.rsplit('.', 1)[0])}, {lit(c.rsplit('.', 1)[1])}, {lit(v['want'])})"
    for c, v in sorted(cons.items()))
fn_names = sorted(x for x, k in ids if k == 'fn')
rels = sorted(x for x, k in ids if k.startswith('rel:'))
absent = sorted(x for x, k in ids if k == 'ABSENT')
ROLES = ['anon', 'authenticated', 'inherit_upload_only', 'service_role']
release3 = ['20261024110000', '20261024220000', '20261025200000', '20261025400000']
versions = sorted({g['file'][:14] for g in gm} | {'20261119120000'})
assert len(versions) == 21, versions
BUCKET_CHECKS = [
    ('public.genome_storage_objects', 'genome_storage_objects_bucket_id_check',
     "CHECK ((bucket_id = ANY (ARRAY['genomes'::text, 'generated-artifacts'::text])))"),
    ('public.account_deletion_storage_entries', 'account_deletion_storage_entries_bucket_id_check',
     "CHECK ((bucket_id = ANY (ARRAY['genomes'::text, 'genomes-staging'::text, 'generated-artifacts'::text, 'legal-evidence'::text])))"),
    ('public.embryo_ingest_delete_objects', 'embryo_ingest_delete_objects_bucket_id_check',
     "CHECK (((bucket_id = ANY (ARRAY['genomes'::text, 'genomes-staging'::text, 'generated-artifacts'::text, 'legal-evidence'::text])) OR (bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$'::text)))")]
bvals = ',\n  '.join(f"({lit(r)}, {lit(n)}, {lit(d)})" for r, n, d in BUCKET_CHECKS)
UPLOADER_READ_CALLERS = ['private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)',
                         'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)',
                         'private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)',
                         'private.path_b_normalization_authority_v1(uuid,text)',
                         'private.public_appeal_provisional_binding_v1(uuid)']
NEW_OBJECTS = [  # created by the release, not functions: (kind, relation, name)
    ('constraint', 'public.mail_outbox', 'mail_outbox_adult_invitation_note_sealed'),
    ('trigger', 'public.mail_outbox', 'clear_adult_invitation_note_envelope'),
    ('trigger', 'private.invitation_terminal_notices', 'settle_adult_acceptance_notice'),
    ('trigger', 'public.subjects', 'purge_subject_copilot_chats')]
nvals = ',\n  '.join(f"({lit(k)}, {lit(r)}, {lit(n)})" for k, r, n in NEW_OBJECTS)

sql = f"""-- Read-only pre-checks for guarded release 4 (the 21 migrations 20261119110000 ..
-- 20261122200000; one SELECT, one jsonb row; writes nothing). Run AFTER releases 1-3 are
-- applied, merged and deployed (release 3's batch-2 post-state read back EQUAL, and code
-- with release 3's migration tree be49d283 deployed), BEFORE this release's dry runs.
-- Run: python3 -I ../api/api-run.py production-readonly-prechecks.sql $R/prechecks --json-column prechecks
--  (or psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f production-readonly-prechecks.sql).
-- Written by ../rehearsal/scripts/make-prechecks.py. "guards" re-runs, read-only and in this
-- session's settings (the ones the batches restore before each migration), every md5 pin of
-- the 21 files on a function body that exists before this release and that no earlier
-- migration of the release changes ({len(fns)} functions; "measure" def is
-- md5(pg_get_functiondef), src is md5(prosrc)); each also needs the ACL the rehearsal mirror
-- holds. "constraint_guards" does the same for the {len(cons)} constraint definitions the files
-- pin. Every "must_be_zero" value that is not 0 means a migration guard would refuse, a
-- statement would fail, or an object the release creates already exists, on production as
-- it is now; each key names the migration (mNN = #NN) whose release-notes pre-check it
-- comes from. "context" holds the notes' context counts, for the operator and the owner.
-- "sizes" are the rows of the tables the batches lock (README.md, "Locks"). Expected values
-- (the rehearsal mirror of release 3's post-state) are in README.md, "Pre-check stop rules".
-- A value that reads an object releases 1-3 create is read only when the object exists
-- (NULL otherwise, never 0), so on a state where release 3 is missing this SELECT still
-- answers, and says so (rehearsed: ../rehearsal/data/negatives.tsv, missing-release-3).
with guard(ref, fn, measure, want_md5, want_acl, origin) as (values
  {vals}),
checked as (
 select g.ref, g.fn, g.measure, g.want_md5, g.want_acl, g.origin, p.oid is not null as present,
  case g.measure when 'def' then md5(pg_catalog.pg_get_functiondef(p.oid)) else md5(p.prosrc) end as have_md5,
  p.proacl::text as acl
 from guard g left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(g.fn)),
cguard(ref, rel, name, want_md5) as (values
  {cvals}),
cchecked as (
 select g.ref, g.rel, g.name, g.want_md5, md5(pg_catalog.pg_get_constraintdef(c.oid)) as have_md5
 from cguard g left join pg_catalog.pg_constraint c on c.conrelid = pg_catalog.to_regclass(g.rel) and c.conname = g.name
  and c.contype = 'c' and c.convalidated),
bucket(rel, name, def) as (values
  {bvals}),
newobj(kind, rel, name) as (values
  {nvals})
select jsonb_build_object(
 'session', jsonb_build_object(
   'current_user', current_user,
   'statement_timeout', current_setting('statement_timeout'),
   'lock_timeout', current_setting('lock_timeout'),
   'search_path', current_setting('search_path'),
   'server_version', current_setting('server_version')),
 'ledger', (select jsonb_build_object('count', count(*), 'max', max(version),
   'above_release3_max', count(*) filter (where version > '20261025400000'),
   'release3_versions_present', count(*) filter (where version = any({arr(release3)})),
   'release_versions_present', count(*) filter (where version = any({arr(versions)})))
   from supabase_migrations.schema_migrations),
 'guards', (select jsonb_object_agg(fn || ' ' || measure, jsonb_build_object('refs', ref, 'origin', origin,
   'ok', coalesce(have_md5 = want_md5 and acl = want_acl, false), 'present', present,
   'want_md5', want_md5, 'have_md5', have_md5, 'want_acl', want_acl, 'proacl', acl)) from checked),
 'constraint_guards', (select jsonb_object_agg(rel || '.' || name, jsonb_build_object('refs', ref,
   'ok', coalesce(have_md5 = want_md5, false), 'want_md5', want_md5, 'have_md5', have_md5)) from cchecked),
 'must_be_zero', jsonb_build_object(
   'guarded_bodies_not_as_rehearsed', (select count(*) from checked where not coalesce(have_md5 = want_md5 and acl = want_acl, false)),
   'guarded_constraints_not_as_rehearsed', (select count(*) from cchecked where not coalesce(have_md5 = want_md5, false)),
   -- every existing function (by name) and relation the 21 files name: {len(fn_names)} functions, {len(rels)} relations
   'prerequisite_functions_missing', (select count(*) from unnest({arr(fn_names)}) f
     where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'prerequisite_relations_missing', (select count(*) from unnest({arr(rels)}) r where pg_catalog.to_regclass(r) is null),
   'roles_missing', (select count(*) from unnest({arr(ROLES)}) r where not exists (select 1 from pg_catalog.pg_roles where rolname = r)),
   -- every function name the release creates ({len(absent)}), and its constraint and triggers
   'release_functions_present', (select count(*) from unnest({arr(absent)}) f
     where exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'release_objects_present', (select count(*) from newobj o where case o.kind
     when 'constraint' then exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = pg_catalog.to_regclass(o.rel) and c.conname = o.name)
     else exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = pg_catalog.to_regclass(o.rel) and t.tgname = o.name) end),
   -- #01: each a refusal the migration would raise, and its reviewed bucket checks
   'm01_account_deletion_entries_on_dropped_buckets', (select count(*) from public.account_deletion_storage_entries
     where bucket_id in ('genomes-staging','generated-artifacts')),
   'm01_embryo_unwind_entries_on_dropped_buckets', (select count(*) from public.embryo_ingest_delete_objects
     where bucket_id in ('genomes-staging','generated-artifacts')),
   'm01_recorded_objects_on_dropped_buckets', (select count(*) from public.genome_storage_objects
     where bucket_id in ('genomes-staging','generated-artifacts')),
   'm01_legacy_staging_sessions_reachable_by_embryo_unwind', (select count(*) from public.upload_sessions u where u.storage_bucket = 'genomes-staging'
     and (u.cohort_id is not null or exists (select 1 from public.subjects s where s.id = u.subject_id and s.cohort_id is not null))),
   'm01_dropped_buckets_present', (select count(*) from storage.buckets where id in ('genomes-staging','generated-artifacts')),
   'm01_bucket_checks_not_as_reviewed', (select count(*) from bucket b where not exists (select 1 from pg_catalog.pg_constraint c
     where c.conrelid = pg_catalog.to_regclass(b.rel) and c.conname = b.name and c.contype = 'c' and c.convalidated
       and pg_catalog.pg_get_constraintdef(c.oid) = b.def)),
   -- #02: the spend table as release 3's 20261024220000 made it, and the ingest status check
   'm02_spend_table_not_as_reviewed', (select count(*) from (select 1) x where (select array_agg(column_name::text order by column_name)
     from information_schema.columns where table_schema = 'private' and table_name = 'session_csrf_token_uses')
     is distinct from array['expires_at','route_id','token_hash']),
   'm02_ingest_status_check_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.embryo_ingest_sessions'::regclass and c.conname = 'embryo_ingest_sessions_status_check' and c.convalidated)),
   -- #03: the table block's refusal, what the new check would refuse, and the pinned provider key
   'm03_plain_notes_on_sendable_rows', (select count(*) from public.mail_outbox where template_id = 'adult-subject-invitation'
     and state in ('queued','claimed') and template_payload ? 'note'),
   'm03_invitation_payloads_outside_request_or_note', (select count(*) from public.mail_outbox where template_id = 'adult-subject-invitation'
     and (template_payload - array['request','note'] <> '{{}}'::jsonb or (template_payload ? 'request' and template_payload ? 'note'))),
   'm03_provider_attempt_key_not_as_pinned', (select count(*) from (select 1) x where private.mail_provider_attempt_key_v1(
     jsonb_populate_record(null::public.mail_outbox, jsonb_build_object('idempotency_key', repeat('a',64),
     'token_purpose', 'adult-subject-invitation', 'attempt_count', 3)))
     is distinct from '6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517'),
   -- #04: the door's self branch (pinned by fragment and ACL, not by md5) and the column the notice reads
   'm04_door_without_its_self_branch', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamp with time zone)')
       and p.proacl::text = '{{postgres=X/postgres,service_role=X/postgres}}' and p.prosecdef
       and pg_catalog.pg_get_functiondef(p.oid) like '%return private.empty_self_subject_v1(p_account_id,s.id);%')),
   'm04_mail_contact_revision_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.profiles'::regclass and attname = 'mail_contact_revision' and not attisdropped)),
   -- #05: the terminal notice queue's insert trigger, enabled
   'm05_notice_trigger_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'private.invitation_terminal_notices'::regclass and t.tgname = 'enqueue_invitation_terminal_notice' and t.tgenabled = 'O')),
   -- #07: the archive tables the cleanup door works on
   'm07_archive_tables_missing', 2 - (select count(*) from pg_catalog.pg_class where oid in
     (pg_catalog.to_regclass('private.export_archive_attempts'), pg_catalog.to_regclass('private.export_archive_jobs'))),
   -- #08: the legal-audit actor trigger, and the operation check before its widening
   'm08_actor_trigger_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_trigger t
     where t.tgrelid = 'public.account_operation_nonces'::regclass and t.tgname = 'legal_audit_actor_on_consumed_insert' and not t.tgisinternal)),
   'm08_check_not_before_widening', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.account_operation_nonces'::regclass and c.conname = 'account_operation_nonces_operation_check' and c.convalidated
       and pg_catalog.pg_get_constraintdef(c.oid) like '%''provider_setting_delete''%'
       and pg_catalog.pg_get_constraintdef(c.oid) not like '%''file_delete''%')),
   -- #09: the queue's one trigger, the two registered classes and phases, and no clock yet
   'm09_notice_queue_triggers_not_one', abs(1 - (select count(*) from pg_catalog.pg_trigger t
     where t.tgrelid = 'private.invitation_terminal_notices'::regclass and not t.tgisinternal)),
   'm09_retention_classes_missing', 2 - (select count(*) from public.retention_registry where execution_class = 'scheduledDuePhase'
     and retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d')),
   'm09_retention_phases_missing', 2 - (select count(*) from public.retention_phase_registry where phase_kind = 'notice-enqueue'
     and (retention_id, phase_id) in (('adult.acceptance-hold-72h','adult-acceptance-second-notice'),('adult.re-notice-30d','adult-revocation-renotice'))),
   'm09_clocks', (select count(*) from public.retention_rows where retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d')),
   -- #11, #13: the transfer switch answers false before the release (#13 opens it)
   'm11_m13_transfer_switch_open', (select count(*) from (select 1) x where {dyn([('fn', 'private.subject_transfer_open_v1()')], 'select private.subject_transfer_open_v1()', 'boolean')} is distinct from false),
   -- #14, #16: the job table the guard reads
   'm14_job_table_missing', 1 - (select count(*) from pg_catalog.pg_class where oid = pg_catalog.to_regclass('private.export_archive_jobs')),
   -- #20: exactly the five bodies that ask the uploader's read (#19 widens none of them to ask it)
   'm20_uploader_read_callers_not_the_five', (select count(*) from (select 1) x where array(select p.oid from pg_catalog.pg_proc p
     where p.prosrc ~ '[^a-z_]path_b_subject_v1\\s*\\(' and p.oid is distinct from pg_catalog.to_regprocedure('private.path_b_subject_v1(uuid,uuid)') order by p.oid)
     is distinct from array(select pg_catalog.to_regprocedure(x)::oid from unnest({arr(UPLOADER_READ_CALLERS)}) x order by 1))),
 'context', jsonb_build_object(
   'm01_legacy_staging_sessions', (select count(*) from public.upload_sessions where storage_bucket = 'genomes-staging'),
   'm01_legacy_staging_sessions_live', (select count(*) from public.upload_sessions where storage_bucket = 'genomes-staging'
     and status in ('issued','uploaded','validating','held')),
   'm01_account_deletions_in_progress', (select count(*) from public.account_deletion_requests where state = 'delete_started'),
   'm02_spent_hashes', {dyn([('rel', 'private.session_csrf_token_uses')], 'select count(*) from private.session_csrf_token_uses', 'bigint')},
   'm02_live_reset_sessions', {dyn([('rel', 'private.auth_recovery_sessions')], 'select count(*) from private.auth_recovery_sessions where expires_at > clock_timestamp()', 'bigint')},
   'm03_plain_notes_on_ended_rows', (select count(*) from public.mail_outbox where template_id = 'adult-subject-invitation'
     and state not in ('queued','claimed') and template_payload ? 'note'),
   'm03_invitation_rows', (select count(*) from public.mail_outbox where template_id = 'adult-subject-invitation'),
   'm04_door_md5', (select md5(pg_catalog.pg_get_functiondef(p.oid)) from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamp with time zone)')),
   'm04_live_self_upload_consents', (select count(*) from public.subject_consents where consent_type = 'upload_class' and revoked_at is null
     and subject_id in (select id from public.subjects where subject_class = 'self')),
   'm05_account_held_path_b_records', (select count(*) from public.subjects where subject_class = 'other_adult' and lifecycle = 'active'
     and ownership_transferred_at is null and owner_account_id is not null and subject_account_id is not null),
   'm05_m09_terminal_notices', (select count(*) from private.invitation_terminal_notices),
   'm06_third_party_cohorts', (select count(*) from public.embryo_cohorts where upload_class = 'embryo_third_party'),
   'm06_open_third_party_drafts', (select count(*) from public.embryo_cohort_drafts where upload_class = 'embryo_third_party'
     and state in ('draft','evidence_pending','ready')),
   'm07_export_delete_guard', (select count(*) from pg_catalog.pg_trigger t where t.tgrelid = 'public.generated_exports'::regclass
     and t.tgname = 'guard_export_archive_delete' and t.tgenabled = 'O'),
   'm07_m14_self_record_exports', (select count(*) from public.generated_exports e join public.subjects s on s.id = e.target_id
     where e.target_kind = 'subject' and s.subject_class = 'self'),
   'm07_live_self_record_exports', (select count(*) from public.generated_exports e join public.subjects s on s.id = e.target_id
     where e.target_kind = 'subject' and s.subject_class = 'self' and e.status in ('queued','building','ready')),
   'm07_self_record_attempts_holding_objects', (select count(*) from private.export_archive_attempts a
     join public.generated_exports e on e.id = a.export_id join public.subjects s on s.id = e.target_id
     where e.target_kind = 'subject' and s.subject_class = 'self' and a.state in ('writing','bytes_complete')),
   'm07_m15_test_r2_enabled', (select coalesce(bool_or(enabled), false) from private.account_archive_r2_configuration),
   'm08_check_md5', (select md5(pg_catalog.pg_get_constraintdef(c.oid)) from pg_catalog.pg_constraint c
     where c.conrelid = 'public.account_operation_nonces'::regclass and c.conname = 'account_operation_nonces_operation_check'),
   'm08_m14_m16_pending_file_deletions', (select count(*) from private.genome_file_deletions),
   'm09_accepted_adult_invitations', (select count(*) from public.subject_invitations where invitation_kind = 'adult_subject' and status = 'accepted'),
   'm10_subject_chats', (select count(*) from public.chats where scope_kind = 'subject'),
   'm10_live_copilot_local_grants', (select count(*) from public.purpose_grants where purpose = 'copilot.local' and revoked_at is null),
   'm11_m13_records_held_by_their_person', (select count(*) from public.subjects where subject_class = 'other_adult' and upload_class = 'adult'
     and lifecycle = 'active' and subject_account_id is not null and owner_account_id is distinct from subject_account_id),
   'm11_m13_m17_transferred_records', (select count(*) from public.subjects where ownership_transferred_at is not null),
   'm12_m15_accepted_path_a_invitations', (select count(*) from public.subject_invitations i where i.invitation_kind = 'adult_subject'
     and i.status = 'accepted' and not exists (select 1 from public.adult_subject_drafts d where d.subject_id = i.target_id)),
   'm12_current_person_to_person_grants', (select count(*) from public.directional_grants where status = 'current' and direction = 'subject_to_recipient'),
   'm14_live_self_record_copies', (select count(*) from public.generated_exports e join public.subjects s on s.id = e.target_id
     join private.export_archive_jobs j on j.export_id = e.id where e.target_kind = 'subject' and s.subject_class = 'self'
     and j.deadline > clock_timestamp() and (e.status in ('queued','building') or (e.status = 'ready' and e.expires_at > clock_timestamp()))),
   'm14_jobless_copies_being_made', (select count(*) from public.generated_exports e left join private.export_archive_jobs j on j.export_id = e.id
     where e.target_kind = 'subject' and j.export_id is null and e.status in ('queued','building')),
   'm14_ready_account_copies', (select count(*) from public.generated_exports where target_kind = 'account' and status = 'ready'),
   'm15_open_account_archives', (select count(*) from public.generated_exports where target_kind = 'account' and status in ('queued','building','ready')),
   'm16_live_account_copies_with_a_self_record', (select count(*) from public.generated_exports e join private.export_archive_jobs j on j.export_id = e.id
     join public.subjects s on s.subject_account_id = e.target_id and s.subject_class = 'self' and e.subject_partitions @> jsonb_build_array(s.id)
     where e.target_kind = 'account' and j.deadline > clock_timestamp()
     and (e.status in ('queued','building') or (e.status = 'ready' and e.expires_at > clock_timestamp()))),
   'm17_relocations_not_swapped', {dyn([('rel', 'private.subject_transfer_relocations')], "select count(*) from private.subject_transfer_relocations where state in ('queued','copying')", 'bigint')},
   'm17_exports_of_transferred_records', (select count(*) from public.generated_exports e join public.subjects s on s.id = e.target_id
     where e.target_kind = 'subject' and s.ownership_transferred_at is not null),
   'm18_m19_confirmed_reviewed_document_records', (select count(*) from public.adult_subject_drafts
     where adult_flow = 'path-b-reviewed-document' and state = 'confirmed'),
   'm18_accepted_reviewed_document_invitations', (select count(*) from public.subject_invitations i join public.adult_subject_drafts d
     on d.subject_id = i.target_id and d.adult_flow = 'path-b-reviewed-document' and d.state = 'confirmed'
     where i.invitation_kind = 'adult_subject' and i.status = 'accepted'),
   'm19_transferred_reviewed_document_records', (select count(*) from public.subjects s join public.adult_subject_drafts d on d.subject_id = s.id
     where d.adult_flow = 'path-b-reviewed-document' and d.state = 'confirmed' and s.ownership_transferred_at is not null),
   'm19_live_grants_on_reviewed_document_records', (select count(*) from public.purpose_grants g join public.adult_subject_drafts d on d.subject_id = g.target_id
     where g.target_kind = 'subject' and d.adult_flow = 'path-b-reviewed-document' and g.revoked_at is null),
   'm20_m21_records_whose_document_is_no_longer_retained', {dyn([('fn', 'private.path_b_reviewed_document_retained_v1(uuid)')], "select count(*) from public.adult_subject_drafts d join public.subjects s on s.id = d.subject_id where d.adult_flow = 'path-b-reviewed-document' and d.state = 'confirmed' and s.lifecycle = 'active' and not private.path_b_reviewed_document_retained_v1(s.id)", 'bigint')}),
 'sizes', jsonb_build_object(
   'genome_storage_objects', (select count(*) from public.genome_storage_objects),
   'account_deletion_storage_entries', (select count(*) from public.account_deletion_storage_entries),
   'embryo_ingest_delete_objects', (select count(*) from public.embryo_ingest_delete_objects),
   'mail_outbox', (select count(*) from public.mail_outbox),
   'invitation_terminal_notices', (select count(*) from private.invitation_terminal_notices),
   'account_operation_nonces', (select count(*) from public.account_operation_nonces),
   'subjects', (select count(*) from public.subjects)),
 'context_locks', jsonb_build_object(
   'unconsumed_account_operation_nonces', (select count(*) from public.account_operation_nonces where consumed_at is null and expires_at > now()),
   'mail_outbox_queued_or_claimed', (select count(*) from public.mail_outbox where state in ('queued','claimed')))
) as prechecks;
"""
open(sys.argv[1], 'w', encoding='utf-8').write(sql)
print(sys.argv[1], len(sql), 'bytes;', len(fns), 'guarded functions,', len(cons), 'guarded constraints,',
      len(fn_names), 'functions,', len(rels), 'relations,', len(absent), 'absent names')
