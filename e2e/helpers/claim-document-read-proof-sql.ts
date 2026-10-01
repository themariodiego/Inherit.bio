const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The native callee takes the actual document composite, never its UUID.
 * Planning this query executes no document, receipt or Auth operation. */
export function claimDocumentReadProofSql(review:string,account:string):string {
  if(!UUID.test(review)||!UUID.test(account))throw new Error("Invalid synthetic review scope");
  return `select jsonb_build_object(
    'authCurrent',auth.jwt()->>'sub'='${account}' and auth.jwt()->>'aal'='aal2'
      and auth.jwt()->>'role'='authenticated' and exists(select 1 from auth.sessions s
        where s.id=(auth.jwt()->>'session_id')::uuid and s.user_id='${account}'::uuid
          and (s.not_after is null or s.not_after>clock_timestamp())),
    'documentCurrent',d.state='clean' and d.intake_id=c.id and d.id=c.photo_document_id,
    'deliveredChunks',(select count(distinct r.chunk_sequence) from private.claim_review_reads r
      where r.review_id=c.id and r.reviewer_account_id='${account}'::uuid
        and r.document_id=d.id and r.delivery_verified_at is not null),
    'receiptsCurrent',coalesce((select bool_and(r.chunk_sequence=0 and r.document_sha256=d.sha256
        and r.review_revision=c.review_revision and r.assignment_revision=a.assignment_revision
        and r.auth_session_id=s.id and r.account_auth_session_revision=p.auth_session_revision
        and r.originating_session_revision=coalesce(s.refresh_token_counter,0)+1)
      from private.claim_review_reads r
      join private.claim_review_assignments a on a.review_id=r.review_id
        and a.reviewer_account_id=r.reviewer_account_id and a.status='current'
      join public.profiles p on p.id=r.reviewer_account_id
      join auth.sessions s on s.id=(auth.jwt()->>'session_id')::uuid and s.user_id=p.id
      where r.review_id=c.id and r.reviewer_account_id='${account}'::uuid
        and r.document_id=d.id and r.delivery_verified_at is not null),false),
    'expectedChunks',ceil(d.byte_count/4000000.0)::integer,
    'fullyRead',case private.claim_document_fully_read_v1('${review}'::uuid,'${account}'::uuid,d)
      when true then 't' when false then 'f' else null end)
    from private.claim_documents d join private.claim_reviews c on c.photo_document_id=d.id
    where c.id='${review}'::uuid`;
}
