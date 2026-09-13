-- D-101: `/api/jobs/research-publish` is a due-work drain, not an operator
-- command. The register has always described it that way — `requestContract:
-- { body: "forbidden", query: "forbidden" }` and
-- `policy.mode: "machine-reviewed-publication-only"` — while the route read a
-- `slug` from the request body and published whichever template the caller
-- named. The caller chose the target; nothing checked that a human had
-- approved it. The route now takes no input, and this function is where "due"
-- is decided.
--
-- Due means: the template is sitting in the review queue (`status = 'review'`)
-- and its most recent `public.template_reviews` row decided `approve`. That is
-- the approval record the review queue already writes — `decision` is one of
-- `approve`, `re_review`, `retire`, and the newest `review_revision` wins, so
-- a later `re_review` or `retire` takes a template straight back out of the
-- due set without deleting the history of the approval that preceded it.
--
-- One template per call, oldest approval first, claimed with
-- `for update ... skip locked` and flipped to `published` inside the same
-- transaction: two drains running at once cannot both publish one template and
-- so cannot write the changelog entry twice. The caller loops.
create or replace function public.claim_due_research_publication_v1()
returns table (slug text, title text, summary text)
language plpgsql security definer set search_path='' as $$
declare v_slug text;
begin
  select t.slug into v_slug
  from public.report_templates t
  join lateral (
    select r.decision
    from public.template_reviews r
    where r.template_id = t.slug
    order by r.review_revision desc
    limit 1
  ) latest on true
  where t.status = 'review' and latest.decision = 'approve'
  order by (
    select r.decided_at from public.template_reviews r
    where r.template_id = t.slug order by r.review_revision desc limit 1
  ), t.slug
  for update of t skip locked
  limit 1;

  if v_slug is null then return; end if;

  -- `published_at` is the first publication. A template that went back for
  -- re-review and was approved again keeps the date its readers first saw.
  update public.report_templates t
  set status = 'published',
      published_at = coalesce(t.published_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where t.slug = v_slug;

  return query
  select t.slug, t.title, t.summary
  from public.report_templates t where t.slug = v_slug;
end;
$$;
revoke all on function public.claim_due_research_publication_v1() from public,anon,authenticated;
grant execute on function public.claim_due_research_publication_v1() to service_role;
