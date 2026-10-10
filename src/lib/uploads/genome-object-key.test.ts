import { describe, expect, it } from "vitest";
import { genomeKeyMatchesUpload, genomeOriginalKeySchema, genomeStagingKeySchema, genomeUploadObjectKeySchema } from "./genome-object-key";
import { assertGenomeOriginalMetadataBounds, assertPreparedMetadataBounds } from "../genome/prepared-source/canonical-manifest";
import { directUploadReceipt } from "./subject-upload-contract";
import { storageUploadAuthorizationSchema } from "./storage-upload-token";
const account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const subject = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const upload = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const name = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const prefix = `${account}/${subject}/${upload}/`;

describe("exact database-selected genome locators", () => {
  it("retains an existing flat original and staging key byte-for-byte", () => {
    expect(genomeOriginalKeySchema.parse(name)).toBe(name);
    expect(genomeStagingKeySchema.parse(name)).toBe(name);
  });
  it.each(["vcf", "vcf.gz", "g.vcf", "txt", "tsv"])("admits the registered opaque final filename .%s", extension => {
    const key = `${prefix}${name}.${extension}`;
    expect(genomeOriginalKeySchema.parse(key)).toBe(key);
    expect(genomeKeyMatchesUpload(key, upload, account)).toBe(true);
    expect(genomeStagingKeySchema.safeParse(key).success).toBe(false);
  });
  it("admits only the staged .part namespace and binds both issuance receipts to their actual upload", () => {
    const stagingKey = `${prefix}${name}.part`;
    const value = { accountId: account, sessionId: subject, accountAuthSessionRevision: 1, uploadId: upload,
      jti: name, stagingKey, maximumBytes: 10, expiresAt: "2026-10-10T23:00:00Z" };
    expect(storageUploadAuthorizationSchema.parse(value).stagingKey).toBe(stagingKey);
    const publicValue = { transport: "direct-storage", uploadId: upload, bucket: "genomes", stagingKey,
      uploadToken: "synthetic-token", authorizationHeader: "Bearer {uploadToken}", maximumBytes: 10, expiresAt: value.expiresAt };
    expect(directUploadReceipt.parse(publicValue).stagingKey).toBe(stagingKey);
    expect(storageUploadAuthorizationSchema.safeParse({ ...value, accountId: subject }).success).toBe(false);
    expect(storageUploadAuthorizationSchema.safeParse({ ...value, uploadId: subject }).success).toBe(false);
    expect(directUploadReceipt.safeParse({ ...publicValue, uploadId: subject }).success).toBe(false);
    expect(genomeOriginalKeySchema.safeParse(stagingKey).success).toBe(false);
  });
  it.each([`${prefix}person.vcf`, `${prefix}${name}.bam`, `${prefix}${name}.vcf/extra`,
    `${account}/${subject}/${name}.vcf`, `prepared/${name}`, `${prefix}../${name}.vcf`,
    `${prefix}${name}.vcf?token=x`, `${prefix}${name}.vcf#fragment`, `${prefix}${name}.vcf%2Fextra`,
    `${prefix}${name.toUpperCase()}.vcf`, `${prefix}${name}.vcf\\extra`, `${prefix}${name}.vcf\n`])(
    "refuses a malformed, original-filename, alternate-provider or URL locator (%s)", key => {
      expect(genomeUploadObjectKeySchema.safeParse(key).success).toBe(false);
    });
});


it("retains canonical 128-character bounds and admits only exact finite original-locator metadata fields", () => {
 const key = `${prefix}${name}.vcf.gz`;
 expect(key.length).toBeGreaterThan(128);
 expect(() => assertPreparedMetadataBounds({ objectKey: key }, 16384)).toThrow();
 expect(() => assertGenomeOriginalMetadataBounds({ objectKey: key, name: key }, 16384)).not.toThrow();
 for (const value of [{ sha256: key }, { name: `${key}/extra` }, { objectKey: "x".repeat(200) },
   { objectKey: `${prefix}${name}.part` }, { objectKey: key, extra: "x".repeat(129) }]) {
  expect(() => assertGenomeOriginalMetadataBounds(value, 16384)).toThrow();
 }
 const getter = { get objectKey(): string { throw new Error("must not invoke metadata accessor"); } };
 expect(() => assertGenomeOriginalMetadataBounds(getter, 16384)).toThrow("invalid_manifest");
 expect(() => assertGenomeOriginalMetadataBounds({ objectKey: key }, 20)).toThrow();
});
