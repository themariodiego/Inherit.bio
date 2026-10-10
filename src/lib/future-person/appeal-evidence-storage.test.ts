import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { encryptSecret } = await import("@/lib/crypto");
const { composeClaimDocument } = await import("./document-compose");
const { openDocumentBytes, sealDocumentBytes } = await import("./document-envelope");
afterAll(() => vi.unstubAllEnvs());

const migration = readFileSync("supabase/migrations/20261010122500_appeal_evidence_storage.sql", "utf8");
const original = readFileSync("supabase/migrations/20261009204626_public_appeal_evidence_session.sql", "utf8");
const CASE = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const OPAQUE = "33333333-3333-4333-8333-333333333333";
const legacy = `${CASE}/${DOC}/${OPAQUE}`;
const canonical = `appeal-case/${CASE}/${DOC}/${OPAQUE}.pdf`;
const sha = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");

function body(source: string, name: string) {
  const start = source.indexOf(`function private.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n$$;", start) + 4);
}

describe("the registered appeal storage producer", () => {
  it("changes only the key expression in both complete original authority bodies", () => {
    const old = "v_session.intake_id::text || '/' || v_session.document_id::text || '/' || gen_random_uuid()::text";
    const prefix = "'appeal-case/' || " + old;
    expect(body(migration, "reserve_appeal_document_chunk_v1").replace(prefix + " || '.part'", old))
      .toBe(body(original, "reserve_appeal_document_chunk_v1"));
    expect(body(migration, "begin_appeal_document_completion_v1").replace(prefix
      + "\n      || case v_session.media_type when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' end", old))
      .toBe(body(original, "begin_appeal_document_completion_v1"));
  });

  it("creates only a private sealed-byte bucket, retains service RPC grants and no user policy", () => {
    expect(migration).toContain("values ('legal-evidence', 'legal-evidence', false, 20000028, array['application/octet-stream'])");
    expect(migration).toContain("message='legal_evidence_bucket_incompatible'");
    expect(migration).not.toMatch(/create\s+policy/iu);
    expect(migration).toContain("private.begin_appeal_document_completion_v1(uuid,text,text,integer) to service_role;");
    expect(migration).toContain("revoke all on function private.guard_appeal_object_key_v1() from public,anon,authenticated,inherit_upload_only,service_role;");
  });

  it("keeps both native bucket censuses complete and the existing retention bytes under the sealed MIME policy", () => {
    for (const file of ["drop_generated_artifacts_bucket.sql", "drop_genomes_staging_bucket.sql"]) {
      const fixture = readFileSync(`supabase/tests/${file}`, "utf8");
      expect(fixture).toContain("array['genomes','exports','future-person-identity','legal-evidence']");
      expect(fixture).toContain("not public and name='legal-evidence' and file_size_limit=20000028");
      expect(fixture).toContain("allowed_mime_types=array['application/octet-stream']");
      expect(fixture).toContain("schemaname='storage' and tablename='objects'");
      expect(fixture).toContain("like '%legal-evidence%'");
    }
    const cleanup = readFileSync("e2e/refused-invitation-cleanup.spec.ts", "utf8");
    expect(cleanup).toContain('Buffer.from("Synthetic legal evidence only")');
    expect(cleanup).toContain('contentType: "application/octet-stream", upsert: false');
  });

  it("assigns both genuine reviewers before capturing the native target graph", () => {
    const journey = readFileSync("e2e/helpers/appeal-document-storage-journey.ts", "utf8");
    const signedIn = journey.indexOf("const reviewer = await signInReviewer(reviewerContext, ORIGIN)");
    const assigned = journey.indexOf("private.grant_claim_reviewer_v1('${reviewer}')");
    const foreignAssigned = journey.indexOf("private.grant_claim_reviewer_v1('${foreignReviewer}')");
    const targets = journey.indexOf("const targetsBefore = await reviewFixtureSql(targetBag)");
    expect(signedIn).toBeGreaterThan(-1);
    expect(assigned).toBeGreaterThan(signedIn);
    expect(foreignAssigned).toBeGreaterThan(assigned);
    expect(targets).toBeGreaterThan(foreignAssigned);
  });

  it("preserves old ciphertext locators but guards fresh legacy plans/fragments and exact old completion", () => {
    expect(migration).toContain("changed:=new.planned_object_key is distinct from old.planned_object_key");
    expect(migration).toContain("new.object_key is distinct from old.object_key");
    expect(migration).toContain("new.object_key is distinct from session.planned_object_key");
    expect(migration).toContain("message='legacy_appeal_object_binding_incompatible'");
    expect(migration).not.toMatch(/(?:update|delete from)\s+storage\.objects/iu);
    expect(migration).not.toMatch(/update\s+private\.appeal_(?:documents|document_fragments)\s+set\s+object_key/iu);
  });

  it("registers both exact layouts and removes only genuinely closed bucket census exceptions", () => {
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8"));
    expect(register.storagePrefixes.filter((row: { bucket: string }) => row.bucket === "legal-evidence")
      .map((row: { id: string; prefix: string }) => [row.id, row.prefix])).toEqual([
      ["storage.legal-evidence-v1", "{target_kind}/{target_id}/{document_id}/{server_filename}"],
      ["storage.legal-evidence-appeal-legacy", "{case_id}/{document_id}/{server_filename}"],
    ]);
    const ledger = JSON.parse(readFileSync("docs/register-contract-divergence.json", "utf8"));
    expect(ledger.liveCallSiteOnUncreatedBucket).toEqual([]);
    expect(ledger.objectKeyShapeNotDescribedByAnyPrefix.map((row: { bucket: string }) => row.bucket))
      .toEqual(["genomes", "genomes"]);
  });
});

describe("exact-key encrypted composition across the storage transition", () => {
  async function compose(fragmentKey: string, finalKey: string, declaredType: "application/pdf" | "image/png" = "application/pdf") {
    const raw = crypto.randomBytes(32);
    const bytes = Buffer.from("%PDF-1.7\nSynthetic storage transition only\n");
    const objects = new Map<string, Uint8Array>([[fragmentKey, sealDocumentBytes(raw, fragmentKey, bytes)]]);
    const plan = { status: "compose" as const, storageKind: "appeal" as const, documentId: DOC,
      documentKind: "appeal-photo-identity" as const, mediaType: declaredType, sizeBytes: bytes.length,
      sha256: sha(bytes), objectKey: finalKey, wrappedDataKey: encryptSecret(raw.toString("base64")).toString("hex"),
      fragments: [{ sequence: 0, objectKey: fragmentKey, byteCount: bytes.length, sha256: sha(bytes) }] };
    const store = {
      async read(key: string) { const value = objects.get(key); if (!value) throw new Error("missing"); return value; },
      async create(key: string, value: Uint8Array) { if (objects.has(key)) throw new Error("exists"); objects.set(key, value); },
      async remove(keys: readonly string[]) { for (const key of keys) objects.delete(key); },
    };
    return { raw, bytes, objects, plan, store };
  }

  it.each([legacy, `appeal-case/${CASE}/${DOC}/${OPAQUE}.part`])("composes an exact existing fragment into its canonical final key", async fragment => {
    const fixture = await compose(fragment, canonical);
    try {
      expect(await composeClaimDocument(fixture.plan, fixture.store)).toBe("composed");
      expect(openDocumentBytes(fixture.raw, canonical, fixture.objects.get(canonical)!)?.equals(fixture.bytes)).toBe(true);
      expect(openDocumentBytes(fixture.raw, legacy, fixture.objects.get(canonical)!)).toBeNull();
    } finally { fixture.raw.fill(0); fixture.bytes.fill(0); }
  });

  it("finishes an already-persisted legacy plan without moving its authenticated path", async () => {
    const fixture = await compose(`appeal-case/${CASE}/${DOC}/${OPAQUE}.part`, legacy);
    try {
      expect(await composeClaimDocument(fixture.plan, fixture.store)).toBe("composed");
      expect(openDocumentBytes(fixture.raw, legacy, fixture.objects.get(legacy)!)?.equals(fixture.bytes)).toBe(true);
      expect(openDocumentBytes(fixture.raw, canonical, fixture.objects.get(legacy)!)).toBeNull();
    } finally { fixture.raw.fill(0); fixture.bytes.fill(0); }
  });

  it("refuses a mismatched declared format before writing a filename's purported bytes", async () => {
    const fixture = await compose(legacy, canonical.replace(".pdf", ".png"), "image/png");
    try {
      expect(await composeClaimDocument(fixture.plan, fixture.store)).toBe("type");
      expect(fixture.objects.has(fixture.plan.objectKey)).toBe(false);
    } finally { fixture.raw.fill(0); fixture.bytes.fill(0); }
  });
});
