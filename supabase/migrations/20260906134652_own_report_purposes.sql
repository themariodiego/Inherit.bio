insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
values('consent.own-monogenic',1,'2d15be63b5ff226bcf9e5c2a57f35a9956dd20b37ef64955708278fd1efa779f',$artifact$You let Inherit use your own DNA to make reports about individual genetic variants for you.

This choice applies only to this result type. Other results, sharing, research and outside AI remain separate choices.

Results can be uncertain, incomplete or wrong. They are for learning, not a diagnosis or a substitute for clinical testing and professional advice.

You can withdraw this choice and ask to delete your data.

What you confirm:

1. I want Inherit to make this result type from my own DNA for me.$artifact$,
'Choose this result type for your own DNA. This does not turn on other results or sharing.',date '2026-09-06');

insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
values('consent.own-polygenic',1,'62e3d9fc421be1264842bb2fdb794166540ad34554a2014e7443ee0eb72937b8',$artifact$You let Inherit use your own DNA to make polygenic reports that combine many genetic variants for you.

This choice applies only to this result type. Other results, sharing, research and outside AI remain separate choices.

Results can be uncertain, incomplete or wrong. They are for learning, not a diagnosis or a substitute for clinical testing and professional advice.

You can withdraw this choice and ask to delete your data.

What you confirm:

1. I want Inherit to make this result type from my own DNA for me.$artifact$,
'Choose this result type for your own DNA. This does not turn on other results or sharing.',date '2026-09-06');

insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)
values('consent.own-ancestry',1,'73eeddb35ff7c4e5e98c44df2954159e71ae88afad5eea28daaf1b8282a0a5f0',$artifact$You let Inherit use your own DNA to make genetic ancestry estimates for you.

This choice applies only to this result type. Other results, sharing, research and outside AI remain separate choices.

Results can be uncertain, incomplete or wrong. They are for learning, not a diagnosis or a substitute for clinical testing and professional advice.

You can withdraw this choice and ask to delete your data.

What you confirm:

1. I want Inherit to make this result type from my own DNA for me.$artifact$,
'Choose this result type for your own DNA. This does not turn on other results or sharing.',date '2026-09-06');
-- The self extension binds the principal revision too; old unrelated grants are unchanged.
alter table public.directional_grants add column self_principal_revision bigint check(self_principal_revision>0);

create function public.own_report_context_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $function$
declare c jsonb; p public.subject_principals%rowtype;
begin
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,p_subject_id);
 -- Claimed embryo records cannot restart analysis through this ordinary DNA path.
 perform 1 from public.subjects where id=p_subject_id and subject_class='self' and lifecycle='active' for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 select sp.* into p from public.subject_account_bindings b join public.subject_principals sp on sp.id=b.subject_principal_id
 where b.subject_id=p_subject_id and b.account_id=p_account_id and b.status='current'
 and b.binding_revision=(c->>'accountBindingRevision')::bigint and sp.status='active'
 and sp.account_id=p_account_id and sp.subject_id=p_subject_id and sp.principal_kind='account_subject' for share of b,sp;
 if p.id is null then raise exception using errcode='42501',message='not_found'; end if;
 return c||jsonb_build_object('principalId',p.id,'principalRevision',p.principal_revision);
end;
$function$;
revoke all on function public.own_report_context_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only;
grant execute on function public.own_report_context_v1(uuid,uuid,uuid) to service_role;

create function public.grant_own_report_purpose_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_snapshot jsonb,p_purpose text,p_artifact_version integer,p_artifact_body_sha256 text,p_nonce_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path=pg_catalog
as $function$
declare c jsonb; a public.consent_artifacts%rowtype; g public.purpose_grants%rowtype;
 v_key text; v_principal uuid; v_signature uuid; v_now timestamptz:=clock_timestamp();
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry')
 or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
 or p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 c:=public.own_report_context_v1(p_account_id,p_session_id,p_subject_id);
 if c is distinct from p_snapshot then raise exception using errcode='42501',message='not_found'; end if;
 v_principal:=(c->>'principalId')::uuid;
 v_key:=case p_purpose when 'reports.monogenic' then 'consent.own-monogenic'
  when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-ancestry' end;
 select * into a from public.consent_artifacts where artifact_key=v_key and version=p_artifact_version
  and body_sha256=p_artifact_body_sha256 and superseded_at is null and published_at<=v_now
  and effective_on<=timezone('UTC',v_now)::date
  and body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex') for share;
 if a.artifact_key is null then raise exception using errcode='55000',message='consent_artifact_changed'; end if;
 insert into public.purpose_grant_nonces(nonce_hash,account_id) values(p_nonce_hash,p_account_id);
 -- The account row lock in store authority serializes grants; an independent choice never grants another layer.
 select pg.* into g from public.purpose_grants pg join public.directional_grants dg
 on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 where pg.target_kind='subject' and pg.target_id=p_subject_id and pg.purpose=p_purpose
 and pg.signer_principal_id=v_principal and pg.data_subject_principal_id=v_principal
 and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>v_now)
 and pg.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
 and pg.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
 and pg.artifact_key=a.artifact_key and pg.artifact_version=a.version and pg.artifact_body_sha256=a.body_sha256
 and dg.status='current' and dg.direction='self' and dg.recipient_principal_id=v_principal
 and dg.recipient_account_id=p_account_id and dg.relationship_id is null and dg.pair_id is null
 and dg.relationship_or_pair_revision=(c->>'accountBindingRevision')::bigint
 and dg.self_principal_revision=(c->>'principalRevision')::bigint for update of pg,dg;
 if g.grant_id is null then
  -- End only stale self-direction pairs for this one purpose. Other recipients and purposes are untouched.
  with ended as (
   update public.purpose_grants pg set revoked_at=v_now,revocation_reason='superseded'
   from public.directional_grants dg where dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
   and pg.target_kind='subject' and pg.target_id=p_subject_id and pg.purpose=p_purpose
   and pg.revoked_at is null and dg.direction='self' and dg.recipient_account_id=p_account_id
   returning pg.grant_id
  ) update public.directional_grants set status='superseded',ended_at=v_now where grant_id in(select grant_id from ended);
  insert into public.consent_signatures(artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
   signer_account_id,target_kind,target_id,purpose,statement_keys,jurisdiction_code,jurisdiction_revision,subject_binding_revision)
  select a.artifact_key,a.version,a.body_sha256,v_principal,p_account_id,'subject',p_subject_id,p_purpose,
   array['make-this-result-for-me'],coalesce(jurisdiction_code,'ZZ'),jurisdiction_revision,(c->>'subjectBindingRevision')::bigint
   from public.profiles where id=p_account_id returning id into v_signature;
  insert into public.purpose_grants(grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,
   artifact_body_sha256,signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,jurisdiction_code,jurisdiction_revision)
  select 1,'subject',p_subject_id,p_purpose,a.artifact_key,a.version,a.body_sha256,v_signature,v_principal,v_principal,
   (c->>'subjectBindingRevision')::bigint,coalesce(jurisdiction_code,'ZZ'),jurisdiction_revision
   from public.profiles where id=p_account_id returning * into g;
  insert into public.directional_grants(grant_id,grant_revision,recipient_principal_id,recipient_account_id,
   relationship_or_pair_revision,direction,self_principal_revision)
  values(g.grant_id,g.grant_revision,v_principal,p_account_id,(c->>'accountBindingRevision')::bigint,'self',(c->>'principalRevision')::bigint);
 end if;
 update public.purpose_grant_nonces set grant_id=g.grant_id where nonce_hash=p_nonce_hash;
 perform private.append_legal_audit_event('purpose.granted',null,'api.consents','accepted',
  jsonb_build_object('purpose',p_purpose,'direction','self','revision',g.grant_revision));
 -- No analytic output is written here. The explicit process operation rechecks the selected live pair.
 return jsonb_build_object('recordKind','purpose_grant','recordId',g.grant_id,'artifactKey',a.artifact_key,
  'artifactVersion',a.version,'purposeKey',p_purpose,'signedAt',g.granted_at);
end;
$function$;
revoke all on function public.grant_own_report_purpose_v1(uuid,uuid,uuid,jsonb,text,integer,text,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.grant_own_report_purpose_v1(uuid,uuid,uuid,jsonb,text,integer,text,text,timestamptz) to service_role;
