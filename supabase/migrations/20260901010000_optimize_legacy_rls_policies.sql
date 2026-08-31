-- Evaluate the authenticated user ID once per statement instead of once per
-- candidate row. This preserves the legacy owner-only policy semantics while
-- avoiding per-row Auth function calls on large genome tables.

alter policy profiles_select_own on public.profiles
  using ((select auth.uid()) = id);
alter policy profiles_insert_own on public.profiles
  with check ((select auth.uid()) = id);
alter policy profiles_update_own on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
alter policy profiles_delete_own on public.profiles
  using ((select auth.uid()) = id);

alter policy genome_files_select_own on public.genome_files
  using ((select auth.uid()) = user_id);
alter policy user_variants_select_own on public.user_variants
  using ((select auth.uid()) = user_id);
alter policy ancestry_select_own on public.ancestry_results
  using ((select auth.uid()) = user_id);

alter policy llm_settings_insert_own on public.llm_settings
  with check ((select auth.uid()) = user_id);
alter policy llm_settings_update_own on public.llm_settings
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
alter policy llm_settings_delete_own on public.llm_settings
  using ((select auth.uid()) = user_id);
alter policy llm_settings_select_own on public.llm_settings
  using ((select auth.uid()) = user_id);

alter policy consent_select_own on public.consent_grants
  using ((select auth.uid()) = user_id);
alter policy chats_select_own on public.chats
  using ((select auth.uid()) = user_id);
alter policy chat_messages_select_own on public.chat_messages
  using ((select auth.uid()) = user_id);
alter policy user_prs_select_own on public.user_prs
  using ((select auth.uid()) = user_id);
