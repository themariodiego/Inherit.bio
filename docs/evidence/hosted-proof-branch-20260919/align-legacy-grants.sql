-- Hosted-proof branch only (project iofjhrtcyawjjhuxbgfd), applied 19 September 2026 as
-- hosted_proof_align_legacy_grants_with_production. Never for the Inherit project.
--
-- The branch database was created with narrower default privileges for the postgres
-- role in the public schema than the Inherit project has (tables: anon and authenticated
-- hold only REFERENCES, TRIGGER and MAINTAIN; sequences and functions grant nothing), so
-- the nineteen legacy relations that rely on defaults and one function ended up narrower
-- than production. This sets the branch's default privileges to production's and grants
-- exactly the production privileges on those objects; every other object was already
-- equal by digest.
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
-- Production: anon/authenticated arwdxtm, service_role arwdDxtm.
grant select, insert, update, delete on table public.changelog_entries, public.llm_settings, public.profiles, public.providers, public.prs_scores, public.prs_weights, public.ref_genes, public.ref_variants, public.report_templates, public.research_releases to anon, authenticated, service_role;
-- Production: anon/authenticated rxtm, service_role arwdDxtm.
grant select on table public.ancestry_results, public.consent_grants, public.genome_files, public.user_variants to anon, authenticated;
grant select, insert, update, delete on table public.ancestry_results, public.consent_grants, public.genome_files, public.user_variants to service_role;
-- Production: anon/authenticated xtm (no reads), service_role arwdDxtm; llm_keys service_role only.
grant select, insert, update, delete on table public.user_prs, public.llm_keys to service_role;
-- Production sequences: rwU for the three roles.
grant usage, select, update on sequence public.embryo_variants_id_seq, public.legal_audit_retention_checkpoints_id_seq, public.user_variants_id_seq to anon, authenticated, service_role;
-- Production grants execute on this reader to anon, authenticated and service_role, in that order.
revoke execute on function public.own_subject_purpose_granted_v1(uuid, uuid, uuid, text) from service_role;
grant execute on function public.own_subject_purpose_granted_v1(uuid, uuid, uuid, text) to anon, authenticated, service_role;
-- Same privileges as production for job_time_stats; only the recorded order differed.
revoke execute on function public.job_time_stats(text) from authenticated, service_role;
grant execute on function public.job_time_stats(text) to service_role, authenticated;
