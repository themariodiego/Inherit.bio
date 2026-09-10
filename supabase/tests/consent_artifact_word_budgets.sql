begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- G5.2 sets two numeric budgets on consent documents: a plain-language
-- summary of at most 150 words, and a change summary of at most 60 words in
-- the same block as the accept control. The schema already enforces the rest
-- of that contract — effective_on is NOT NULL, consent_artifacts_current_idx
-- keeps one live version per key, and consent_artifacts_check requires a
-- change summary on every version after the first — but nothing enforced the
-- two counts, which is what this file adds.
--
-- Words are counted by splitting on whitespace after trimming. That is an
-- approximation over markdown: a bare URL counts once and an inline link
-- counts its visible words plus its target. It errs toward counting more than
-- a reader sees, so it cannot pass a document that is genuinely over budget.
--
-- Reads committed reference data and writes nothing; the transaction rolls
-- back regardless.

create temporary view artifact_words as
select artifact_key, version,
  coalesce(array_length(regexp_split_to_array(btrim(summary_markdown), '\s+'), 1), 0) as summary_words,
  coalesce(array_length(regexp_split_to_array(btrim(coalesce(summary_of_changes, '')), '\s+'), 1), 0) as change_words
from public.consent_artifacts;

-- A passing run must be a real scan, not an empty table.
select cmp_ok((select count(*) from artifact_words), '>=', 15::bigint,
  'the consent artifact set is populated, so the budgets below are actually tested');
select cmp_ok((select count(*) from artifact_words where version > 1), '>=', 1::bigint,
  'at least one superseding version exists, so the change budget is exercised rather than vacuous');

select is((select count(*) from artifact_words where summary_words > 150), 0::bigint,
  'every consent summary is within the 150-word budget G5.2 sets');
select is((select count(*) from artifact_words where change_words > 60), 0::bigint,
  'every change summary is within the 60-word budget G5.2 sets');

-- The first version needs no change summary and must not be required to
-- invent one; later versions must carry it. The schema check enforces the
-- second half, and this pins the first so a future constraint cannot quietly
-- demand prose that has nothing to describe.
select is((select count(*) from public.consent_artifacts
  where version = 1 and nullif(btrim(coalesce(summary_of_changes, '')), '') is not null), 0::bigint,
  'a first version states no changes, because there are none to state');

select * from finish();
rollback;
