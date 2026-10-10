// SOURCE ONLY, a separate Cloudflare Worker module. This is not installed,
// compiled, deployed, paid setup or a claim of provider qualification.
import { DurableObject } from "cloudflare:workers";
type Env = { CASE_ARCHIVE_BUCKET: R2Bucket; CASE_ARCHIVE_BUCKET_NAME: string; CASE_ARCHIVE_BINDING_SHA256: string;
 CASE_ARCHIVE_TEST_ENABLED: string };
type Claim = { allocationSha256: string; token: string; expiresAt: number };
type State = { allocationSha256: string; writeStarted: boolean; terminal: boolean; claim: Claim | null };
type Frame = { allocationSha256: string; writeBindingSha256: string; configurationSha256: string; originalDeadline: string;
 writeIdentity: { byteCount: number; sha256: string; locator: { bucket: string; objectKey: string } } };
const fail = () => { throw new Error("case_archive_gateway_unavailable"); };
const digestPattern = /^[0-9a-f]{64}$/u, providerKey = /^export\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
async function sha(bytes: Uint8Array) {
 const value = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));return [...value].map(b => b.toString(16).padStart(2,"0")).join("");
}
/** One Durable Object per native random allocation digest. R2 access is held
 * ONLY by this binding. Deployment credentials, lifecycle rules, all-write
 * exclusion and final-commit conditional behavior still require real evidence.
 * No HTTP fetch handler, public endpoint, namespace selector or delete exists. */
export class RequesterStatementArchiveGateway extends DurableObject<Env> {
 async consumeTransportNonce(allocation:string,nonce:string,expiresAt:number){
  return this.ctx.blockConcurrencyWhile(async()=>{
   await this.state(allocation);const now=Date.now();
   if(!digestPattern.test(nonce)||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+16_000)fail();
   const key=`transport:${nonce}`;if(await this.ctx.storage.get(key)!==undefined)fail();
   await this.ctx.storage.put(key,expiresAt);const current=await this.ctx.storage.getAlarm();
   if(current===null||current>expiresAt)await this.ctx.storage.setAlarm(expiresAt);return true;
  });
 }
 async alarm(){
  await this.ctx.blockConcurrencyWhile(async()=>{
   const now=Date.now(),rows=await this.ctx.storage.list<number>({prefix:"transport:",limit:1000});let earliest:number|undefined;
   for(const [key,deadline] of rows){if(deadline<=now)await this.ctx.storage.delete(key);else earliest=Math.min(earliest??deadline,deadline);}
   if(rows.size===1000)await this.ctx.storage.setAlarm(now+1000);
   else if(earliest!==undefined)await this.ctx.storage.setAlarm(earliest);
   // Allocation terminal/writeStarted facts are never expired or deleted.
  });
 }
 private ready() {
  if (this.env.CASE_ARCHIVE_TEST_ENABLED !== "1" || !/^inherit-export-[a-z0-9-]{1,40}$/u.test(this.env.CASE_ARCHIVE_BUCKET_NAME)
   || !digestPattern.test(this.env.CASE_ARCHIVE_BINDING_SHA256)) fail();
 }
 describeConfiguration() { this.ready();return { bucket: this.env.CASE_ARCHIVE_BUCKET_NAME,
  bindingSha256: this.env.CASE_ARCHIVE_BINDING_SHA256, protocol: "r2-current-object-qualified-all-writer-gateway-v1" }; }
 private async state(allocation: string): Promise<State> {
  this.ready();if (!digestPattern.test(allocation)) fail();
  const stored = await this.ctx.storage.get<State>("allocation");
  if (stored && stored.allocationSha256 !== allocation) fail();
  return stored ?? { allocationSha256: allocation, writeStarted: false, terminal: false, claim: null };
 }
 private async exactKey(allocation: string, key: string) {
  if (!providerKey.test(key) || await sha(new TextEncoder().encode(`inherit-export-r2-allocation-v1\n${this.env.CASE_ARCHIVE_BUCKET_NAME}\n${key}`)) !== allocation) fail();
 }
 private describe(object: R2Object) { return { key: object.key, version: object.version, etag: object.etag, size: object.size, customMetadata: object.customMetadata ?? {} }; }
 private validClaim(stored: State, claim: Claim) {
  if (!stored.terminal || !stored.claim || !digestPattern.test(claim.token)
   || stored.allocationSha256 !== claim.allocationSha256 || stored.claim.token !== claim.token
   || stored.claim.expiresAt !== claim.expiresAt || Date.now() >= claim.expiresAt) fail();
 }
 async createPayload(frame: Frame, bytes: Uint8Array) {
  // The RPC input is a separate platform-owned clone. Keep its actual mutable
  // handle until the DO callback settles, including admission refusal paths.
  try { return await this.ctx.blockConcurrencyWhile(async () => {
   this.ready();const stored = await this.state(frame.allocationSha256), where = frame.writeIdentity.locator;
   if (stored.terminal || stored.writeStarted || frame.configurationSha256 !== this.env.CASE_ARCHIVE_BINDING_SHA256
    || where.bucket !== this.env.CASE_ARCHIVE_BUCKET_NAME || !providerKey.test(where.objectKey)
    || !digestPattern.test(frame.writeBindingSha256) || Date.now() >= Date.parse(frame.originalDeadline)
    || !(bytes instanceof Uint8Array) || bytes.byteLength !== frame.writeIdentity.byteCount || bytes.byteLength < 1
    || bytes.byteLength > 4_000_000 || await sha(bytes) !== frame.writeIdentity.sha256) fail();
   await this.exactKey(frame.allocationSha256,where.objectKey);
   // Persist admission BEFORE the actual PUT. Unknown result/restart cannot
   // permit a second payload submission. A later cleanup can still fence it.
   stored.writeStarted = true;await this.ctx.storage.put("allocation",stored);
   const object = await this.env.CASE_ARCHIVE_BUCKET.put(where.objectKey, bytes, {
    onlyIf: new Headers({ "If-None-Match": "*" }), customMetadata: { state: "owned-payload",
     allocationSha256: frame.allocationSha256, writeBindingSha256: frame.writeBindingSha256 },
    httpMetadata: { cacheControl: "no-store" } });
   if (object === null) fail();return this.describe(object!);
  }); } finally { if (bytes instanceof Uint8Array) bytes.fill(0); }
 }
 async readPayload(frame: Frame) {
  return this.ctx.blockConcurrencyWhile(async () => {
   const stored = await this.state(frame.allocationSha256), where = frame.writeIdentity.locator;
   if (stored.terminal || !stored.writeStarted || frame.configurationSha256 !== this.env.CASE_ARCHIVE_BINDING_SHA256
    || where.bucket !== this.env.CASE_ARCHIVE_BUCKET_NAME || !providerKey.test(where.objectKey)
    || Date.now() >= Date.parse(frame.originalDeadline)) fail();
   await this.exactKey(frame.allocationSha256,where.objectKey);
   const object = await this.env.CASE_ARCHIVE_BUCKET.get(where.objectKey);if (!object || !("body" in object)) fail();
   return { descriptor: this.describe(object!), body: object!.body };
  });
 }
 async beginCleanup(claim: Claim) {
  return this.ctx.blockConcurrencyWhile(async () => {
   const stored = await this.state(claim.allocationSha256);
   if (!digestPattern.test(claim.token) || !Number.isSafeInteger(claim.expiresAt) || claim.expiresAt <= Date.now()
    || claim.expiresAt > Date.now() + 30_000 || stored.claim && stored.claim.expiresAt > Date.now()) fail();
   // Terminal never expires and never goes back to writable. Claim expiration
   // permits another disposal attempt only. There is no payload ID/hash here.
   stored.terminal = true;stored.claim = claim;await this.ctx.storage.put("allocation",stored);return true;
  });
 }
 async endCleanup(claim: Claim) {
  return this.ctx.blockConcurrencyWhile(async () => {
   const stored=await this.state(claim.allocationSha256);
   if (!stored.claim || stored.claim.token!==claim.token || stored.claim.expiresAt!==claim.expiresAt) fail();
   stored.claim=null;await this.ctx.storage.put("allocation",stored);return true;
  });
 }
 async head(claim: Claim, key: string) {
  return this.ctx.blockConcurrencyWhile(async () => {
   const stored = await this.state(claim.allocationSha256);this.validClaim(stored,claim);await this.exactKey(claim.allocationSha256,key);
   const object = await this.env.CASE_ARCHIVE_BUCKET.head(key);this.validClaim(stored,claim);return object === null ? null : this.describe(object);
  });
 }
 async get(claim: Claim, key: string, onlyIf: Headers) {
  return this.ctx.blockConcurrencyWhile(async () => {
   const stored = await this.state(claim.allocationSha256);this.validClaim(stored,claim);await this.exactKey(claim.allocationSha256,key);
   const object = await this.env.CASE_ARCHIVE_BUCKET.get(key,{onlyIf});this.validClaim(stored,claim);return object && "body" in object ? { ...this.describe(object),body:object.body } : null;
  });
 }
 async putEmpty(claim: Claim, key: string, onlyIf: Headers) {
  return this.ctx.blockConcurrencyWhile(async () => {
   const stored = await this.state(claim.allocationSha256);this.validClaim(stored,claim);await this.exactKey(claim.allocationSha256,key);
   const object = await this.env.CASE_ARCHIVE_BUCKET.put(key,new Uint8Array(),{onlyIf,
    customMetadata:{state:"permanent-empty-fence",allocationSha256:claim.allocationSha256},httpMetadata:{cacheControl:"no-store"}});
   this.validClaim(stored,claim);if (object===null) fail();return this.describe(object!);
  });
 }
}
