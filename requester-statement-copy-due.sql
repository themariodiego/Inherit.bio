-- SOURCE ONLY. Copy expiry uses the real archive clock. Closing copies never
-- changes the statement's original submission or fixed 30-day case deadline.
create function public.drain_due_requester_statement_copies_v1()
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare candidate record; item record; rows jsonb:='[]'; held bigint:=0; disposed bigint:=0;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 for candidate in select distinct c.id,c.subject_id from private.new_correction_archive_cases b
  join private.export_archive_jobs j on j.export_id=b.export_id join public.correction_requests c on c.id=b.correction_id
  where j.deadline<=clock_timestamp() or b.state='closing' order by c.subject_id,c.id limit 25 loop
  begin
   -- Subject/case before its complete export graph. A shared ZIP is revoked
   -- whole when any included case/copy closes; no other case source is changed.
   perform 1 from public.subjects where id=candidate.subject_id for update;
   perform 1 from public.correction_requests where id=candidate.id for update;
   perform private.close_new_correction_archives_v1(candidate.id);
   if private.drain_requester_statement_archive_zero_v1(candidate.id) then disposed:=disposed+1;
   else held:=held+1;end if;
  exception when lock_not_available or insufficient_privilege or object_not_in_prerequisite_state then held:=held+1;
  end;
 end loop;
 for item in select r.attempt_id,r.ordinal from private.new_correction_archive_r2_allocations r
  join private.export_archive_attempts a on a.id=r.attempt_id
  where r.state in('reserved','written','closing') and a.state='cleanup_pending'
   and a.cleanup_not_before<=clock_timestamp()
   and(r.claim_expires_at is null or r.claim_expires_at<=clock_timestamp())
   and exists(select 1 from private.new_correction_archive_cases where export_id=a.export_id and state='closing')
  order by r.attempt_id,r.ordinal limit 25 loop
  rows:=rows||jsonb_build_array(jsonb_build_object('attemptId',item.attempt_id,'ordinal',item.ordinal));
 end loop;
 return jsonb_build_object('disposed',disposed,'held',held,'segments',rows);
end $body$;
revoke all on function public.drain_due_requester_statement_copies_v1()
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.drain_due_requester_statement_copies_v1() to service_role;
