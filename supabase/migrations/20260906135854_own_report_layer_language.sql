-- Preserve the initial artifact history; make consent match the existing report layer taxonomy.
-- Migration transaction only: the existing immutable-row trigger also blocks its lifecycle timestamp.
-- Hold the table lock until both new current versions commit; restore the guard before inserting them.
lock table public.consent_artifacts in access exclusive mode;
alter table public.consent_artifacts disable trigger consent_artifacts_immutable;
do $migration$
declare affected integer;
begin
 update public.consent_artifacts set superseded_at=clock_timestamp()
 where version=1 and superseded_at is null and (
  (artifact_key='consent.own-monogenic' and body_sha256='2d15be63b5ff226bcf9e5c2a57f35a9956dd20b37ef64955708278fd1efa779f') or
  (artifact_key='consent.own-polygenic' and body_sha256='62e3d9fc421be1264842bb2fdb794166540ad34554a2014e7443ee0eb72937b8'));
 get diagnostics affected=row_count;
 if affected<>2 then raise exception 'expected exactly two unchanged own-report v1 artifacts'; end if;
end;
$migration$;
alter table public.consent_artifacts enable trigger consent_artifacts_immutable;

insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on,summary_of_changes)
values('consent.own-monogenic',2,'8a63300cef48ac1e53901a6898257a4d8ef4ee4feee1b01204bef0f8519bd161',$artifact$You let Inherit read and show the genetic variants observed in your own DNA file, with information about their coverage. This choice does not promise a health interpretation.

This choice applies only to this result layer. Other results, sharing, research and outside AI remain separate choices.

Results can be uncertain, incomplete or wrong. They are for learning, not a diagnosis or a substitute for clinical testing and professional advice.

You can withdraw this choice and ask to delete your data.

What you confirm:

1. I want Inherit to make this result layer from my own DNA for me.$artifact$,
'Choose this result layer for your own DNA. This does not turn on other results or sharing.',date '2026-09-06',
'Clarifies that this layer shows observed variants and does not promise a health interpretation.');

insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on,summary_of_changes)
values('consent.own-polygenic',2,'d1588835c3976546d8d6ade453cd797f703c84b4e26a0e05e545afa40d10bb97',$artifact$You let Inherit use your own DNA to make trait reports and estimates for you. These may use individual variants or many variants, with the evidence, coverage and uncertainty shown.

This choice applies only to this result layer. Other results, sharing, research and outside AI remain separate choices.

Results can be uncertain, incomplete or wrong. They are for learning, not a diagnosis or a substitute for clinical testing and professional advice.

You can withdraw this choice and ask to delete your data.

What you confirm:

1. I want Inherit to make this result layer from my own DNA for me.$artifact$,
'Choose this result layer for your own DNA. This does not turn on other results or sharing.',date '2026-09-06',
'Clarifies that trait reports and estimates may use individual variants as well as many variants.');
