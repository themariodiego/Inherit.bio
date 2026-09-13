begin;
select plan(16);

-- D-101. `claim_due_research_publication_v1` is the whole of "what is due":
-- the route that calls it reads nothing from its caller, so every rule about
-- which template publishes lives here.
--
-- Synthetic templates only; the outer transaction rolls back. Seeded
-- templates are all `published`, so they are outside the due set by
-- definition and this suite cannot pick one up by accident — asserted first.

select is((select count(*) from public.report_templates where status='review'), 0::bigint,
 'no pre-existing template sits in the review queue, so every claim below is this suite''s');

insert into public.report_templates
 (slug, category, title, summary, status, evidence, layer, estimate_kind) values
 ('d101-approved-late','lifestyle-wellness','Late','summary late','review','preliminary','estimate','single_locus'),
 ('d101-approved-early','lifestyle-wellness','Early','summary early','review','preliminary','estimate','single_locus'),
 ('d101-sent-back','lifestyle-wellness','Sent back','summary back','review','preliminary','estimate','single_locus'),
 ('d101-retired','lifestyle-wellness','Retired','summary retired','review','preliminary','estimate','single_locus'),
 ('d101-undecided','lifestyle-wellness','Undecided','summary none','review','preliminary','estimate','single_locus'),
 ('d101-draft','lifestyle-wellness','Draft','summary draft','draft','preliminary','estimate','single_locus');

insert into public.subject_principals (id, principal_kind) values
 ('d1010000-0000-0000-0000-000000000001','reviewer');

insert into public.template_reviews
 (template_id, reviewer_principal_id, review_revision, decision, evidence_review_due, decided_at) values
 -- Approved second, but decided earlier: approval order, not insertion order.
 ('d101-approved-late','d1010000-0000-0000-0000-000000000001',1,'approve',date '2027-01-01', timestamptz '2026-09-11 10:00Z'),
 ('d101-approved-early','d1010000-0000-0000-0000-000000000001',1,'approve',date '2027-01-01', timestamptz '2026-09-10 10:00Z'),
 -- Approved, then sent back. The newest revision decides.
 ('d101-sent-back','d1010000-0000-0000-0000-000000000001',1,'approve',date '2027-01-01', timestamptz '2026-09-09 10:00Z'),
 ('d101-sent-back','d1010000-0000-0000-0000-000000000001',2,'re_review',date '2027-01-01', timestamptz '2026-09-09 11:00Z'),
 ('d101-retired','d1010000-0000-0000-0000-000000000001',1,'approve',date '2027-01-01', timestamptz '2026-09-08 10:00Z'),
 ('d101-retired','d1010000-0000-0000-0000-000000000001',2,'retire',date '2027-01-01', timestamptz '2026-09-08 11:00Z'),
 -- A draft the reviewer approved before it reached the queue is not in it.
 ('d101-draft','d1010000-0000-0000-0000-000000000001',1,'approve',date '2027-01-01', timestamptz '2026-09-07 10:00Z');

create temporary table first_claim as select * from public.claim_due_research_publication_v1();

select is((select count(*) from first_claim), 1::bigint,
 'a claim takes exactly one template, so the caller controls the batch by looping');
select is((select slug from first_claim), 'd101-approved-early',
 'the oldest approval publishes first, not the most recently approved');
select is((select title from first_claim), 'Early',
 'the claim carries the title the changelog entry is written from');
select is((select summary from first_claim), 'summary early',
 'the claim carries the summary the changelog entry is written from');

select is((select status::text from public.report_templates where slug='d101-approved-early'),
 'published', 'the claim publishes the template it returns, in the same transaction');
select isnt((select published_at from public.report_templates where slug='d101-approved-early'),
 null, 'publication stamps the date readers first saw it');

select is((select slug from public.claim_due_research_publication_v1()), 'd101-approved-late',
 'the next claim takes the next approval and never re-takes the published one');

select is((select count(*) from public.claim_due_research_publication_v1()), 0::bigint,
 'with every approval published the drain has no work, which is how the route answers no_work');

select is((select status::text from public.report_templates where slug='d101-sent-back'), 'review',
 'a template sent back for re-review stays in the queue however it was decided before');
select is((select status::text from public.report_templates where slug='d101-retired'), 'review',
 'a retired decision does not publish the approval that preceded it');
select is((select status::text from public.report_templates where slug='d101-undecided'), 'review',
 'a template nobody has decided on is never due: an approval is what publishes');
select is((select status::text from public.report_templates where slug='d101-draft'), 'draft',
 'an approval on something outside the review queue does not pull it into publication');

-- Re-approving a template that was sent back puts it back in the due set, and
-- its first publication date survives.
update public.report_templates set status='published', published_at=timestamptz '2026-01-01 00:00Z'
 where slug='d101-sent-back';
update public.report_templates set status='review' where slug='d101-sent-back';
insert into public.template_reviews
 (template_id, reviewer_principal_id, review_revision, decision, evidence_review_due, decided_at) values
 ('d101-sent-back','d1010000-0000-0000-0000-000000000001',3,'approve',date '2027-01-01', timestamptz '2026-09-12 10:00Z');
select is((select slug from public.claim_due_research_publication_v1()), 'd101-sent-back',
 'a re-approval after a re-review makes the template due again');
select is((select published_at from public.report_templates where slug='d101-sent-back'),
 timestamptz '2026-01-01 00:00Z',
 're-publication keeps the date the report was first published');

-- Only the worker role may drain. A signed-in reader must not be able to
-- publish a report by calling the function the drain calls.
select ok(has_function_privilege('service_role','public.claim_due_research_publication_v1()','execute')
 and not has_function_privilege('anon','public.claim_due_research_publication_v1()','execute')
 and not has_function_privilege('authenticated','public.claim_due_research_publication_v1()','execute'),
 'the drain function is executable by the worker role alone');

select * from finish();
rollback;
