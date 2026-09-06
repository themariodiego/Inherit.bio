/** Local-only provider integration, not account onboarding or a browser journey.
 * Runs the installed Storage HTTP app in an isolated process with an ephemeral
 * ES256 public key. Does not restart services, rotate Auth keys, send mail, read
 * existing objects, or reset the shared database. Only synthetic bytes are used.
 * Synthetic account/consent receipts remain like other local e2e fixtures;
 * this run's physical objects are removed through the provider in finally.
 * Run with NODE_PATH=./node_modules/next/dist/compiled, then:
 * node --conditions=react-server --import tsx scripts/storage-upload-http.mts
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { mintStorageUploadToken, storageUploadAuthorizationSchema } from "../src/lib/uploads/storage-upload-token";
import { SubjectStructureError, validateSubjectStructure } from "../src/lib/uploads/subject-structure";
import { INGEST_CHUNK_MAXIMUM_BYTES } from "../src/lib/genome/ingest-limits";

const project = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id = "([A-Za-z0-9_-]+)"$/m)?.[1];
assert(project, "Local project ID required");
assert(!process.env.VERCEL && !process.env.CI, "Manual local Docker verification only");
const account = randomUUID();
const session = randomUUID();
const sql = (statement: string) => execFileSync("docker", ["exec", "-i", `supabase_db_${project}`,
  "psql", "-XAtq", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
{ input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 }).trim();
const fixture = sql(`begin;
 do $$begin
  if exists(select 1 from private.upload_authorization_config
   where auth_issuer<>'http://127.0.0.1:54321/auth/v1') then
   raise exception 'local issuer mismatch'; end if;
 end$$;
 insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1') on conflict(singleton) do nothing;
 -- Explicit local fixture policy, clamped to config.toml's 50MiB Storage cap.
 update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=52428800,
  maximum_account_bytes=1073741824,maximum_active_uploads=32 where singleton;
 insert into auth.users(id,email,raw_user_meta_data)
 values('${account}','storage-http-${account}@e2e.local','{"display_name":"Synthetic upload test"}');
 insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 values('${session}','${account}',now(),now(),'aal1');
 update public.profiles set date_of_birth=date '1990-01-01' where id='${account}';
 do $$declare subject uuid; artifact text; nonce text; begin
  select id into strict subject from public.subjects where subject_account_id='${account}' and subject_class='self';
  foreach artifact in array array['disclosure.insurance-and-discrimination','consent.upload-self'] loop
   nonce:=encode(extensions.gen_random_bytes(32),'hex');
   insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
   values(nonce,'${account}','${session}','own_upload_artifact_sign',now()+interval '9 minutes');
   perform public.sign_own_upload_artifact_v1('${account}','${session}',subject,artifact,1,
    (select body_sha256 from public.consent_artifacts where artifact_key=artifact and version=1),
    case when artifact='consent.upload-self' then array['own-adult-dna'] else array['understood'] end,
    1,1,1,1,1,nonce);
  end loop;
 end$$;
 select id from public.subjects where subject_account_id='${account}' and subject_class='self';
 commit;`);
assert.match(fixture, /^[0-9a-f-]{36}$/);
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const kid = randomUUID();
process.env.INHERIT_UPLOAD_SIGNING_JWK = JSON.stringify({ ...keys.privateKey.export({ format: "jwk" }), kid });
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
const synthetic = Buffer.from("Synthetic upload transport fixture. No genetic data.\n");
const receipts: ReturnType<typeof storageUploadAuthorizationSchema.parse>[] = [];
const finalKeys: string[] = [];
function issue(size = synthetic.length, bytes: Buffer = synthetic, format = "VCF") {
  assert(["VCF", "VCF.GZ"].includes(format));
  const receipt = storageUploadAuthorizationSchema.parse(JSON.parse(sql(
    `select public.issue_own_storage_upload_v1('${account}','${session}','${fixture}','${format}',${size},
    '${createHash("sha256").update(bytes).digest("hex")}');`)));
  receipts.push(receipt);
  return { receipt, token: mintStorageUploadToken(receipt) };
}

// The provider loads its existing local credentials itself; none leave the
// container. Only this test process adds the ephemeral public verification key.
const providerCode = String.raw`
const readline = require('node:readline');
const lines = readline.createInterface({input:process.stdin});
let app, origin, paused;
const admissions=new Map();
const versions=new Map();
const races=new Map();
const emit = (id,result) => process.stdout.write('INHERIT_TRANSPORT_RECEIPT:'+JSON.stringify({id,result})+'\n');
lines.on('line',async line=>{
 let message;
 try {
  message=JSON.parse(line);
  if(message.init){
   const prior=JSON.parse(process.env.JWT_JWKS||'{"keys":[]}');
   process.env.JWT_JWKS=JSON.stringify({keys:[...prior.keys,message.init]});
   process.env.LOG_LEVEL='silent';
   process.env.PG_QUEUE_ENABLE='false';
   // Observe the real provider permission probe; never replace its decision.
   const {Uploader}=require('/app/dist/storage/uploader.js');
   const originalPrepare=Uploader.prototype.prepareUpload;
   Uploader.prototype.prepareUpload=async function(options){
    const result=await originalPrepare.call(this,options);
    const objects=versions.get(options.objectName)||[];
    objects.push({backend:this.backend,version:result,
     key:this.location.getKeyLocation({tenantId:this.db.tenantId,bucketId:options.bucketId,objectName:options.objectName})});
    versions.set(options.objectName,objects);
    const race=races.get(options.objectName);
    if(race){race.admitted++;if(race.admitted===2)race.release();await race.gate;}
    const admitted=admissions.get(options.objectName);
    if(admitted){admissions.delete(options.objectName);admitted();}
    return result;
   };
   app=require('/app/dist/app.js').default({logger:false});
   origin=await app.listen({host:'127.0.0.1',port:0});
   emit(message.id,{ready:true}); return;
  }
  if(message.close){await app.close();emit(message.id,{closed:true});process.exit(0);}
  if(message.abortPaused){
   if(paused){paused.request.destroy();await paused.response.catch(()=>{});paused=undefined;}
   emit(message.id,{closed:true});return;
  }
  if(message.compete){
   const key=message.path.split('/').pop();
   let release,fail;
   const gate=new Promise((resolve,reject)=>{release=resolve;fail=reject;});
   const race={gate,release,admitted:0};races.set(key,race);
   const timer=setTimeout(()=>fail(new Error('Probe barrier timed out')),5000);
   const send=async()=>{
    const response=await fetch(origin+message.path,{method:'POST',headers:message.headers,
     body:Buffer.from(message.body,'base64'),signal:AbortSignal.timeout(12000)});
    return {status:response.status,body:await response.text()};
   };
   try{const results=await Promise.all([send(),send()]);emit(message.id,{results,admittedCount:race.admitted});}
   finally{clearTimeout(timer);races.delete(key);}
   return;
  }
  if(message.probeVersions){
   let present=0,absent=0;
   const {storageS3Bucket}=require('/app/dist/config.js').getConfig();
   for(const object of versions.get(message.probeVersions)||[]){
    try{await object.backend.headObject(storageS3Bucket,object.key,object.version);present++;}
    catch(error){if(error.code!=='ENOENT')throw error;absent++;}
   }
   emit(message.id,{present,absent});return;
  }
  if(message.observeCopy){
   const {stagingKey,finalKey,version}=message.observeCopy;
   const source=versions.get(stagingKey)?.[0];
   if(!source||!source.key.endsWith('/'+stagingKey)||![finalKey,version].every(value=>/^[0-9a-f-]{36}$/.test(value)))throw new Error('Invalid test copy');
   versions.set(finalKey,[{...source,key:source.key.slice(0,-stagingKey.length)+finalKey,version}]);
   emit(message.id,{ready:true});return;
  }
  if(message.pause){
   const http=require('node:http');
   const body=Buffer.from(message.body,'base64');
   let admitted=false;
   const key=message.path.split('/').pop();
   admissions.set(key,()=>{admitted=true;emit(message.id,{admitted:true});});
   const response=new Promise((resolve,reject)=>{
    const request=http.request(origin+message.path,{method:'POST',headers:{...message.headers,'Content-Length':body.length}},response=>{
     let bytes='';response.setEncoding('utf8');response.on('data',chunk=>bytes+=chunk);
     response.on('end',()=>{const result={status:response.statusCode,body:bytes};
      if(!admitted)emit(message.id,result);resolve(result);});
    });
    request.on('error',reject);request.setTimeout(12000,()=>request.destroy(new Error('Test transfer timed out')));
    paused={request,remaining:body.subarray(1)};request.write(body.subarray(0,1));
   });
   response.catch(()=>{});paused.response=response;return;
  }
  if(message.finish){paused.request.end(paused.remaining);emit(message.id,await paused.response);paused=undefined;return;}
  const headers={...message.headers};
  if(message.admin) headers.Authorization='Bearer '+process.env.SERVICE_KEY;
  const response=await fetch(origin+message.path,{method:message.method,headers,
   body:message.body===undefined?undefined:Buffer.from(message.body,'base64'),signal:AbortSignal.timeout(12000)});
  if(message.binary){
   const bodyBase64=Buffer.from(await response.arrayBuffer()).toString('base64');
   emit(message.id,{status:response.status,bodyBase64,contentRange:response.headers.get('content-range')});
  }else{const body=await response.text();emit(message.id,{status:response.status,body});}
 }catch(error){emit(message?.id,{error:error?.name||'ProviderError'});}
});
lines.on('close',async()=>{if(app)await app.close();process.exit(0);});
`;
const child = spawn("docker", ["exec", "-i", `supabase_storage_${project}`, "node", "-e", providerCode],
  { stdio: ["pipe", "pipe", "pipe"] });
const reader = createInterface({ input: child.stdout });
let sequence = 0;
type ProviderResult = { status?: number; body?: string; ready?: boolean; closed?: boolean; admitted?: boolean;
  present?: number; absent?: number; error?: string; results?: ProviderResult[]; admittedCount?: number;
  bodyBase64?: string; contentRange?: string | null };
const pending = new Map<number, { resolve: (value: ProviderResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
// Do not forward provider stderr or raw logs: they are not a test receipt.
child.stderr.resume();
reader.on("line", line => {
  if (!line.startsWith("INHERIT_TRANSPORT_RECEIPT:")) return;
  const { id, result } = JSON.parse(line.slice("INHERIT_TRANSPORT_RECEIPT:".length));
  const request = pending.get(id);
  if (request) { clearTimeout(request.timer); pending.delete(id); request.resolve(result); }
});
child.on("close", () => {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Test provider exited")); }
  pending.clear();
});
function provider(message: Record<string, unknown>): Promise<ProviderResult> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Bounded provider test timed out")); }, 18_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, ...message }) + "\n");
  });
}
const upload = (item: ReturnType<typeof issue>, patch: Record<string, unknown> = {}) => provider({
  method: "POST", path: `/object/genomes/${item.receipt.stagingKey}`,
  headers: { Authorization: `Bearer ${item.token}`, "Content-Type": "application/octet-stream", "x-upsert": "false" },
  body: synthetic.toString("base64"), ...patch,
});
function successful(result: ProviderResult, label: string) {
  assert(result.status !== undefined && result.status >= 200 && result.status < 300,
    `${label}: HTTP ${result.status ?? result.error}`);
  console.log(`PASS ${label}`);
}
function denied(result: ProviderResult, label: string) {
  assert(result.status !== undefined && result.status >= 400 && result.status < 500,
    `${label}: HTTP ${result.status ?? result.error}`);
  console.log(`PASS ${label}`);
}
// These checks join the real provider bytes to the real finalization transaction.
// They complement route-unit tests, not a substitute for the pending browser flow.
async function checkFinalization(bytes: Buffer, compressed: boolean, rejected = false) {
  const format = compressed ? "VCF.GZ" : "VCF";
  const item = issue(bytes.length, bytes, format);
  successful(await upload(item, { body: bytes.toString("base64") }), `structural ${format} fixture stored`);
  const argumentsSql = `'${account}','${session}','${item.receipt.uploadId}'`;
  const begin = JSON.parse(sql(`set role service_role; select public.begin_own_upload_finalization_v1(${argumentsSql});`));
  assert.equal(begin.status, "authorized");
  for (const key of [begin.claim, begin.stagingKey, begin.finalKey]) assert.match(key, /^[0-9a-f-]{36}$/);
  assert.equal(begin.stagingKey, item.receipt.stagingKey); assert.notEqual(begin.stagingKey, begin.finalKey);
  finalKeys.push(begin.finalKey);
  const claimedSql = `${argumentsSql},'${begin.claim}'`;
  const recheck = () => assert.deepEqual(JSON.parse(sql(`set role service_role;
    select public.authorize_own_upload_finalization_v1(${claimedSql});`)), begin);
  async function* ranges(key: string) {
    for (let start = 0; start < bytes.length; start += INGEST_CHUNK_MAXIMUM_BYTES) {
      recheck(); const end = Math.min(start + INGEST_CHUNK_MAXIMUM_BYTES, bytes.length) - 1;
      const response = await provider({ method: "GET", path: `/object/authenticated/genomes/${key}`, admin: true,
        headers: { Range: `bytes=${start}-${end}` }, binary: true });
      assert.equal(response.status, 206); assert.equal(response.contentRange, `bytes ${start}-${end}/${bytes.length}`);
      const body = Buffer.from(response.bodyBase64!, "base64"); assert.equal(body.length, end - start + 1); yield body;
    }
  }
  let evidence: Awaited<ReturnType<typeof validateSubjectStructure>>;
  try {
    evidence = await validateSubjectStructure(ranges(begin.stagingKey), { declaredFormat: format,
      expectedSize: begin.expectedSize, expectedSha256: begin.expectedSha256, maximumDecodedBytes: begin.maximumDecodedBytes });
  } catch (error) {
    if (!rejected || !(error instanceof SubjectStructureError)) throw error;
    assert.equal(error.code, "subject_source_not_single_sample");
    const cleanup = JSON.parse(sql(`set role service_role; select public.abort_own_upload_finalization_v1(${claimedSql});`));
    assert.deepEqual(cleanup, { bucket: "genomes", stagingKey: begin.stagingKey, finalKey: begin.finalKey });
    successful(await provider({ method: "DELETE", path: "/object/genomes", admin: true,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify({ prefixes: [begin.stagingKey, begin.finalKey] })).toString("base64") }), "rejected complete source removed by provider");
    assert.equal(sql(`set role service_role; select public.ack_own_upload_finalization_cleanup_v1(${claimedSql});`), "t");
    assert.deepEqual(await provider({ probeVersions: begin.stagingKey }), { present: 0, absent: 1 });
    assert.equal(sql(`select count(*) from public.genome_files where user_id='${account}' and bucket_path='${begin.finalKey}';`), "0");
    console.log("PASS second source beyond preflight rejected; no file published and physical bytes removed"); return;
  }
  assert(!rejected, "invalid fixture must not pass structural validation");
  recheck();
  successful(await provider({ method: "POST", path: "/object/copy", admin: true,
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify({ bucketId: "genomes", sourceKey: begin.stagingKey, destinationKey: begin.finalKey })).toString("base64") }), "validated source copied to a fresh provider key");
  const object = JSON.parse(sql(`select json_build_object('id',id,'version',version) from storage.objects
    where bucket_id='genomes' and name='${begin.finalKey}';`));
  assert.match(object.id, /^[0-9a-f-]{36}$/);
  assert.equal((await provider({ observeCopy: { stagingKey: begin.stagingKey, finalKey: begin.finalKey, version: object.version } })).ready, true);
  const copyHash = createHash("sha256"); for await (const chunk of ranges(begin.finalKey)) copyHash.update(chunk);
  assert.equal(copyHash.digest("hex"), evidence.rawSha256); recheck();
  successful(await provider({ method: "DELETE", path: "/object/genomes", admin: true,
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify({ prefixes: [begin.stagingKey] })).toString("base64") }), "staging removed before final publication");
  recheck();
  const receipt = JSON.parse(sql(`set role service_role; select public.complete_own_upload_finalization_v1(${claimedSql},
    '${object.id}','${evidence.rawSha256}','${evidence.decodedSha256}');`));
  assert.match(receipt.fileId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(receipt, { fileId: receipt.fileId, status: "finalized_ready_for_processing", analysisState: "ready_for_processing",
    next: { routeId: "api.file-process", operation: "process" } });
  const saved = JSON.parse(sql(`select json_build_object('raw',sha256,'decoded',source_sha256,'version',structural_validator_version,
    'name',original_name,'verified',single_logical_sample_verified_at is not null) from public.genome_files where id='${receipt.fileId}';`));
  assert.deepEqual(saved, { raw: evidence.rawSha256, decoded: evidence.decodedSha256, version: "single-logical-sample-v1", name: "Genome file", verified: true });
  assert.equal(sql(`select status from public.retention_due_phases where retention_id='upload.staging-2h'
    and target_id='${item.receipt.uploadId}';`), "cancelled");
  if (compressed) assert.notEqual(evidence.rawSha256, evidence.decodedSha256);
  assert.equal(sql(`select count(*) from public.worker_jobs where file_id='${receipt.fileId}';`), "0");
  assert.equal(sql(`select count(*) from public.purpose_grants where target_id='${fixture}';`), "0");
  assert.deepEqual(await provider({ probeVersions: begin.stagingKey }), { present: 0, absent: 1 });
  assert.deepEqual(await provider({ probeVersions: begin.finalKey }), { present: 1, absent: 0 });
  console.log(`PASS ${format}: complete hash/structure, fresh immutable file, exact saved evidence, zero analysis jobs`);
}
async function checkExpiredUploadCleanup(bytes: Buffer) {
  const item = issue(bytes.length, bytes);
  successful(await upload(item, { body: bytes.toString("base64") }), "abandoned-upload fixture stored");
  const begin = JSON.parse(sql(`set role service_role; select public.begin_own_upload_finalization_v1(
    '${account}','${session}','${item.receipt.uploadId}');`));
  for (const key of [begin.stagingKey, begin.finalKey]) assert.match(key, /^[0-9a-f-]{36}$/);
  assert.equal(begin.stagingKey, item.receipt.stagingKey); finalKeys.push(begin.finalKey);
  successful(await provider({ method: "POST", path: "/object/copy", admin: true,
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify({ bucketId: "genomes", sourceKey: begin.stagingKey, destinationKey: begin.finalKey })).toString("base64") }), "unfinished final copy stored before simulated crash");
  const version = sql(`select version from storage.objects where bucket_id='genomes' and name='${begin.finalKey}';`);
  assert.equal((await provider({ observeCopy: { stagingKey: begin.stagingKey, finalKey: begin.finalKey, version } })).ready, true);
  // Advance only this run's synthetic deadline, never a global retention queue.
  sql(`update public.retention_due_phases set phase_deadline='1900-01-01' where retention_id='upload.staging-2h'
    and target_id='${item.receipt.uploadId}';`);
  const first = JSON.parse(sql(`set role service_role; select public.claim_own_upload_purge_v1(repeat('a',64));`));
  assert.match(first.manifestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(first.objects.map((object: { objectName: string }) => object.objectName).sort(), [begin.stagingKey, begin.finalKey].sort());
  sql(`update public.retention_due_phases set claim_expires_at=clock_timestamp()-interval '1 second'
    where retention_id='upload.staging-2h' and target_id='${item.receipt.uploadId}';`);
  const recovered = JSON.parse(sql(`set role service_role; select public.claim_own_upload_purge_v1(repeat('b',64));`));
  assert.deepEqual(recovered, first, "a replacement worker retains the exact frozen object manifest");
  assert.equal(sql(`set role service_role; select public.authorize_own_upload_purge_v1('${first.manifestId}',repeat('b',64));`), "t");
  successful(await provider({ method: "DELETE", path: "/object/genomes", admin: true,
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify({ prefixes: [begin.stagingKey, begin.finalKey] })).toString("base64") }), "recovered cleanup removes both exact provider objects");
  assert.equal(sql(`set role service_role; select public.finish_own_upload_purge_v1('${first.manifestId}',repeat('b',64));`), "t");
  assert.equal(sql(`select count(*) from public.upload_sessions where id='${item.receipt.uploadId}';`), "0");
  for (const key of [begin.stagingKey, begin.finalKey]) {
    assert.deepEqual(await provider({ probeVersions: key }), { present: 0, absent: 1 });
  }
  console.log("PASS crashed cleanup worker recovered; staging/copy bytes physically absent and working session purged");
}
let ready = false;
let primaryFailure = false;
try {
  const started = await provider({ init: { ...keys.publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" } });
  assert.equal(started.ready, true); ready = true;
  const first = issue();
  denied(await upload(first, { path: `/object/genomes/${randomUUID()}` }), "wrong object key denied over HTTP");
  denied(await upload(first, { path: `/object/genomes-staging/${first.receipt.stagingKey}` }), "wrong bucket denied over HTTP");
  successful(await upload(first), "application ES256 bearer uploads synthetic bytes through provider HTTP");
  assert.equal(sql(`select status from public.upload_sessions where id='${first.receipt.uploadId}';`), "uploaded");
  denied(await upload(first), "completed bearer replay denied over HTTP");
  denied(await upload(first, { headers: { Authorization: `Bearer ${first.token}`, "Content-Type": "application/octet-stream", "x-upsert": "true" } }), "upsert denied over HTTP");
  for (const [method, path] of [["GET", `/object/authenticated/genomes/${first.receipt.stagingKey}`],
    ["POST", "/object/list/genomes"], ["DELETE", `/object/genomes/${first.receipt.stagingKey}`]]) {
    denied(await provider({ method, path, headers: { Authorization: `Bearer ${first.token}`, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: Buffer.from('{"prefix":""}').toString("base64") } : {}) }), `${method} object access denied`);
  }
  const stored = await provider({ method: "GET", path: `/object/authenticated/genomes/${first.receipt.stagingKey}`, admin: true });
  successful(stored, "privileged exact fixture read verifies actual stored bytes");
  assert.equal(stored.body, synthetic.toString());
  const tooLarge = issue(synthetic.length - 1);
  denied(await upload(tooLarge), "declared body over its session bound denied");
  for (let attempt = 0; attempt < 5; attempt++) {
  const competing = issue();
  const competition = await upload(competing, { compete: true });
  assert.equal(competition.admittedCount, 2, "both real permission probes complete before either transfer proceeds");
  const competitors = competition.results!;
  const outcome = competitors.map(result => {
    let code = "unknown";
    try { const value = JSON.parse(result.body ?? "{}").error; if (typeof value === "string" && /^[A-Za-z ]{1,64}$/.test(value)) code = value; } catch { /* no provider body in diagnostics */ }
    return { status: result.status, error: result.error, code };
  });
  assert.equal(competitors.filter(result => result.status === 200).length, 1, `exactly one competing upload succeeds: ${JSON.stringify(outcome)}`);
  denied(competitors.find(result => result.status !== 200)!, "competing bearer cannot replace the winning upload");
  const winner = await provider({ method: "GET", path: `/object/authenticated/genomes/${competing.receipt.stagingKey}`, admin: true });
  successful(winner, "competing attempts preserve the winner's exact bytes");
  assert.equal(winner.body, synthetic.toString());
  assert.deepEqual(await provider({ probeVersions: competing.receipt.stagingKey }), { present: 1, absent: 1 },
    "the losing transfer version is physically removed while the winner remains");
  }
  const single = Buffer.from("##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_PRIVATE_LABEL\n"
    + "opaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\n");
  const opaqueRow = Buffer.from("opaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\n");
  await checkFinalization(Buffer.concat([single,
    Buffer.from(opaqueRow.toString().repeat(Math.ceil(INGEST_CHUNK_MAXIMUM_BYTES / opaqueRow.length)))]), false);
  await checkFinalization(gzipSync(single), true);
  await checkFinalization(Buffer.concat([single, Buffer.from("opaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\topaque\n".repeat(1500)), single]), false, true);
  await checkExpiredUploadCleanup(single);
  const inFlight = issue();
  const admission = await upload(inFlight, { pause: true });
  assert.equal(admission.admitted, true, `real provider permission probe passed before consent withdrawal: ${JSON.stringify({status:admission.status,error:admission.error})}`);
  const revoked = issue();
  sql(`update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
   where account_id='${account}' and consent_type='upload_class';`);
  denied(await upload(revoked), "live consent withdrawal denies an already-issued bearer");
  denied(await provider({ finish: true }), "withdrawal after admission rejects in-flight completion");
  assert.equal(sql(`select count(*) from storage.objects where bucket_id='genomes' and name='${inFlight.receipt.stagingKey}';`), "0");
  assert.equal(sql(`select status from public.upload_sessions where id='${inFlight.receipt.uploadId}';`), "issued");
  const failedBytes = await provider({ probeVersions: inFlight.receipt.stagingKey });
  assert.deepEqual(failedBytes, { present: 0, absent: 1 }, "provider physically removes the rejected transfer version");
  console.log("PASS rejected in-flight bytes are physically absent, not merely hidden by metadata");
  console.log("Storage HTTP integration passed; this is not a complete file-to-report journey.");
} catch (error) { primaryFailure = true; throw error; } finally {
  try { if (ready) {
    await provider({ abortPaused: true });
    const cleanup = await provider({ method: "DELETE", path: "/object/genomes", admin: true,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify({ prefixes: [...receipts.map(item => item.stagingKey), ...finalKeys] })).toString("base64") });
    successful(cleanup, "only this run's synthetic object keys removed through Storage");
    for (const key of [...receipts.map(item => item.stagingKey), ...finalKeys]) {
      const objects = await provider({ probeVersions: key });
      assert.equal(objects.present, 0, "all prepared versions from this run must be physically absent after cleanup");
    }
    console.log("PASS physical cleanup verified for all prepared test-object versions");
  } } catch (error) {
    if (!primaryFailure) throw error;
    console.log("Cleanup also failed; the original integration failure is preserved.");
  } finally {
    if (ready) await provider({ close: true }).catch(() => {});
    child.stdin.end(); reader.close();
    delete process.env.INHERIT_UPLOAD_SIGNING_JWK;
  }
}
