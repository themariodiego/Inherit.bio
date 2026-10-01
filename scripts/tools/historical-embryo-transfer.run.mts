import {spawn} from "node:child_process";
import {localE2eProject} from "../local-e2e-project";
import {verifiedHistoricalPair} from "./historical-embryo-fixture";

/** Owner test executor only. No production target, caller clock, stored
 * synthetic flag or fabricated history UPDATE. Output contains no raw Card,
 * token, contact, signature, document or source bytes. */
try{
  if(process.env.NODE_ENV!=="test"||process.env.INHERIT_TEST_JURISDICTION!=="1")throw new Error("Unavailable");
  const project=localE2eProject(process.env);
  const data:Buffer[]=[];let size=0;
  const value=await new Promise<unknown>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("Unavailable")),5000);
    process.stdin.on("data",(bytes:Buffer)=>{size+=bytes.length;if(size>16_384){clearTimeout(timer);reject(new Error("Unavailable"));process.stdin.destroy();}
      else data.push(bytes);});
    process.stdin.once("end",()=>{clearTimeout(timer);try{resolve(JSON.parse(Buffer.concat(data).toString("utf8")));}catch{reject(new Error("Unavailable"));}});
    process.stdin.once("error",()=>{clearTimeout(timer);reject(new Error("Unavailable"));});
  });
  const verified=verifiedHistoricalPair(value),[one,two]=verified.parents;
  // Every interpolated field has closed UUID/base64url validation. Clock
  // instants are derived ONCE by the actual database, never stdin or a GUC.
  const sql=`begin;
    create temporary table historical_native_clock as select t.now_at recorded_at,
      t.now_at-interval '19 years 6 months' effective_at,
      ((t.now_at at time zone 'UTC')::date-interval '19 years')::date documentary_birth
      from(select clock_timestamp() now_at)t;
    do $current_source$ begin
      if not exists(select 1 from private.embryo_canonical_sources source
        join public.embryos embryo on embryo.id=source.embryo_id and embryo.subject_id=source.subject_id and embryo.cohort_id=source.cohort_id
        join public.embryo_cohorts cohort on cohort.id=source.cohort_id and cohort.basis_case='true_two_parent' and cohort.status='active'
        join public.genome_files file on file.id=source.file_id and file.subject_id=source.subject_id
          and file.user_id=cohort.owner_account_id and file.cohort_id is null and not file.is_cohort_file
          and file.status='stored' and file.source_publication_state='published'
          and file.source_publication_revision=source.publication_revision and file.source_sha256=source.source_sha256
        where embryo.id='${verified.embryoId}'::uuid and source.sample_ordinal=embryo.sample_ordinal
          and source.call_immutability_proof='exact-staged-calls-v1'
          and source.source_sha256=private.embryo_canonical_source_sha256_v1(source.file_id)
          and source.part_count=(select count(*) from private.embryo_canonical_source_parts membership where membership.file_id=source.file_id)
          and source.membership_sha256=private.embryo_canonical_membership_sha256_v1(
            (select array_agg(membership.part_id order by membership.sequence) from private.embryo_canonical_source_parts membership
              where membership.file_id=source.file_id))) then
        raise exception using errcode='42501',message='historical fixture unavailable';end if;
    end $current_source$;
    create temporary table historical_native_proposal as select private.record_embryo_disposition_at_v1(
      '${one.accountId}'::uuid,'${one.sessionId}'::uuid,'${verified.embryoId}'::uuid,'propose','transferred',null,
      '${one.nonce}',(select effective_at from historical_native_clock)) body;
    create temporary table historical_native_transfer as select private.record_embryo_disposition_at_v1(
      '${two.accountId}'::uuid,'${two.sessionId}'::uuid,'${verified.embryoId}'::uuid,'confirm','transferred',
      (select (body->>'proposalId')::uuid from historical_native_proposal),'${two.nonce}',
      (select effective_at+interval '1 second' from historical_native_clock)) body;
    do $complete_clock$ begin
      if not exists(select 1 from public.embryos embryo cross join historical_native_clock t
        where embryo.id='${verified.embryoId}'::uuid and embryo.status='transferred'
          and embryo.transferred_at=t.effective_at+interval '1 second'
          and embryo.retention_expires_at=embryo.transferred_at+interval '18 years 9 months'+interval '24 months'
          and embryo.retention_expires_at>t.recorded_at and t.documentary_birth>=(embryo.transferred_at at time zone 'UTC')::date
          and t.documentary_birth<=(t.recorded_at at time zone 'UTC')::date-interval '18 years') then
        raise exception using errcode='42501',message='historical fixture unavailable';end if;
    end $complete_clock$;
    set constraints all immediate;
    select jsonb_build_object('evidence','time-compressed-synthetic-owner-producer',
      'recordedAt',t.recorded_at,'effectiveAt',transfer.body->>'effectiveAt',
      'documentaryBirth',t.documentary_birth,'closingDate',transfer.body->>'retentionExpiresAt')
      from historical_native_clock t cross join historical_native_transfer transfer;
    commit;`;
  const output=await new Promise<string>((resolve,reject)=>{
    const child=spawn("docker",["exec","-i",project.dbContainer,"psql","-XAtq","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],
      {stdio:["pipe","pipe","pipe"]});
    let result="",errors=false;const timer=setTimeout(()=>{child.kill("SIGTERM");reject(new Error("Unavailable"));},20_000);
    child.stdout.on("data",bytes=>{result+=String(bytes);if(result.length>4096){child.kill("SIGTERM");reject(new Error("Unavailable"));}});
    child.stderr.on("data",()=>{errors=true;});child.once("error",()=>{clearTimeout(timer);reject(new Error("Unavailable"));});
    child.stdin.once("error",()=>{clearTimeout(timer);child.kill("SIGTERM");reject(new Error("Unavailable"));});
    child.once("close",code=>{clearTimeout(timer);if(code!==0||errors)reject(new Error("Unavailable"));else resolve(result.trim());});
    child.stdin.end(sql);
  });
  const receipt=JSON.parse(output) as Record<string,unknown>;
  if(Object.keys(receipt).sort().join(",")!=="closingDate,documentaryBirth,effectiveAt,evidence,recordedAt"
    ||receipt.evidence!=="time-compressed-synthetic-owner-producer")throw new Error("Unavailable");
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}catch{
  // No SQL context, credential, private tuple or stack in executor output.
  process.stderr.write("historical_embryo_fixture_unavailable\n");process.exitCode=1;
}
