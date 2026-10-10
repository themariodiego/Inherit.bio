/** Actual owner-only read proof, shared by the browser and database preflight.
 * The genuine owner-notice producer uses the private review ID as public claim ID.
 * Every original decision/notice/custody/nonce comparison remains included. */
export function keylessEffectProofSql(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) {
    throw new Error("Invalid synthetic review scope");
  }
  return `select encode(extensions.digest(convert_to(jsonb_build_object(
    'review',to_jsonb(r),
    'decisions',(select jsonb_agg(to_jsonb(d) order by d.id) from private.claim_review_decisions d where d.review_id=r.id),
    'assignments',(select jsonb_agg(to_jsonb(a) order by a.assignment_revision) from private.claim_review_assignments a where a.review_id=r.id),
    'documents',(select jsonb_agg(to_jsonb(d) order by d.id) from private.claim_documents d where d.intake_id=r.id),
    'documentSessions',(select jsonb_agg(to_jsonb(s) order by s.id) from private.claim_document_sessions s where s.intake_id=r.id),
    'claims',(select jsonb_agg(to_jsonb(c) order by c.id) from public.future_person_claims c where c.id=r.id),
    'notices',(select jsonb_agg(to_jsonb(n) order by n.id) from public.future_person_claim_notices n
      join public.future_person_claims c on c.id=n.claim_id where c.id=r.id),
    'intake',to_jsonb(i),
    'principalCount',(select count(*) from public.future_person_claimant_principals),
    'custodyCount',(select count(*) from private.future_person_custody_slices),
    'rightsNonces',(select jsonb_agg(to_jsonb(n) order by n.rights_session_id,n.nonce_revision) from public.rights_nonces n))::text,'UTF8'),'sha256'),'hex')
    from private.claim_reviews r join private.future_person_claim_intakes i on i.id=r.id where r.id='${id}'::uuid`;
}
