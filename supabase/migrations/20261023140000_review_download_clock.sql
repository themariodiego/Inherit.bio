-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It patches a body 20261016190000_path_b_reviewed_document.sql
-- (PR 324) installs, so it can only follow it.
-- =====================================================================
--
-- public.open_permission_review_download_v1 inserted a review download whose
-- created_at took the column default, clock_timestamp(), and whose
-- expires_at was a second reading, clock_timestamp()+interval '1 hour'. The
-- table checks expires_at <= created_at + interval '1 hour', so whenever the
-- clock advanced between the two readings the insert failed and a named
-- reviewer's download was refused at random. Both values now come from one
-- reading. Nothing else changes: the same one-hour session, the same checks,
-- the same audit event.
--
-- Pattern: md5-guarded in-place patches of PR 324's reviewed body with its
-- exact ACL, one anchor each, the successor md5 and unchanged ACL asserted
-- (55000 otherwise).

do $patch_review_download_clock$
declare item record;definition text;before_acl aclitem[];
begin
 for item in select * from (values
  (1,'public.open_permission_review_download_v1(uuid,text)','243f68d2eabb8a27013df14d87cddb6b','679b0ee2056c448043e66208f069d603',
   '{postgres=X/postgres,authenticated=X/postgres}',
   $old$declare reviewer record; v_document private.permission_documents; v_download private.permission_document_review_downloads;$old$,
   $new$declare reviewer record; v_document private.permission_documents; v_download private.permission_document_review_downloads;
 v_now timestamptz;$new$,
   'review download declarations'),
  (2,'public.open_permission_review_download_v1(uuid,text)','679b0ee2056c448043e66208f069d603','5d13a237d73df132ac00a219ea289ebd',
   '{postgres=X/postgres,authenticated=X/postgres}',
   $old$ insert into private.permission_document_review_downloads(document_id,reviewer_account_id,auth_session_id,review_revision,
  cookie_hash,sha256,byte_count,chunk_count,expires_at)
 values(v_document.id,reviewer.account_id,reviewer.auth_session_id,v_document.review_revision,p_cookie_hash,
  v_document.sha256,v_document.byte_count,(v_document.byte_count+3999999)/4000000,clock_timestamp()+interval '1 hour')$old$,
   $new$ -- 20261023140000: one clock reading for both times, so the table's
 -- one-hour check holds however long the insert takes to evaluate.
 v_now:=clock_timestamp();
 insert into private.permission_document_review_downloads(document_id,reviewer_account_id,auth_session_id,review_revision,
  cookie_hash,sha256,byte_count,chunk_count,created_at,expires_at)
 values(v_document.id,reviewer.account_id,reviewer.auth_session_id,v_document.review_revision,p_cookie_hash,
  v_document.sha256,v_document.byte_count,(v_document.byte_count+3999999)/4000000,v_now,v_now+interval '1 hour')$new$,
   'review download clock')
 ) as patch(ordinal,target,before_md5,after_md5,acl,old_fragment,new_fragment,label) order by ordinal loop
  select pg_get_functiondef(p.oid),p.proacl into definition,before_acl from pg_proc p
   where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
 end loop;
end;
$patch_review_download_clock$;
