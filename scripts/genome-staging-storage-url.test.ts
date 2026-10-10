import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { genomeStagingStorageUrl, successfulGenomeStagingPost } from "./genome-staging-storage-url";

const API = "http://127.0.0.1:54321";
const ID = "00000000-0000-4000-8000-000000000001";
const current = `${ID}/${ID}/${ID}/original-${ID}.part`;
const endpoint = (key: string) => `${API}/storage/v1/object/genomes/${key}`;

describe("actual provider upload observation", () => {
  it.each([ID, current])("counts successful actual-provider POST shapes for %s", key => {
    expect(genomeStagingStorageUrl(endpoint(key), API)).toBe(true);
    for (const status of [200, 201, 204, 299]) expect(successfulGenomeStagingPost(endpoint(key), API, "POST", status)).toBe(true);
    for (const status of [0, 199, 300, 400, 403, 500, NaN]) expect(successfulGenomeStagingPost(endpoint(key), API, "POST", status)).toBe(false);
    for (const method of [undefined, "OPTIONS", "GET", "PUT", "DELETE", "post"])
      expect(successfulGenomeStagingPost(endpoint(key), API, method, 200)).toBe(false);
  });
  it.each([
    `${ID}/${ID}/${ID}/${ID}.vcf`, `${ID}/${ID}/${ID}/original-${ID}.vcf`,
    `${ID}/${ID}/original-${ID}.part`, `${current}/extra`, `${current}?upsert=true`, `${current}?`,
    `${current}#fragment`, `${current}#`, `${current}%2fextra`,
    `${ID}/${ID}/${ID}/original-ABCDEF00-0000-4000-8000-000000000001.part`,
    `${ID}/${ID}/${ID}/original-00000000-0000-4000-8000-000000000001.part\n`,
  ])("cannot count an embryo, final, malformed or extended locator %s", key => {
    expect(genomeStagingStorageUrl(endpoint(key), API)).toBe(false);
    expect(successfulGenomeStagingPost(endpoint(key), API, "POST", 200)).toBe(false);
  });
  it.each(["http://localhost:3100", "http://localhost:54321", "http://127.0.0.1:55321", "https://example.invalid"])
    ("does not count a staging path at foreign origin %s", origin => {
      expect(successfulGenomeStagingPost(`${origin}/storage/v1/object/genomes/${current}`, API, "POST", 200)).toBe(false);
    });
  it("refuses invalid URLs, another bucket, encoded prefixes and normalized alternate paths", () => {
    for (const url of ["not-a-url", endpoint(current).replace("/genomes/", "/other/"),
      endpoint(current).replace("/object/", "/object%2f"), `${API}/ignored/../storage/v1/object/genomes/${current}`]) {
      expect(genomeStagingStorageUrl(url, API)).toBe(false);
      expect(successfulGenomeStagingPost(url, API, "POST", 200)).toBe(false);
    }
    const username = new URL(endpoint(current)); username.username = "synthetic-user";
    expect(successfulGenomeStagingPost(username.href, API, "POST", 200)).toBe(false);
  });
  it("shares the actual counter and guided predicate while retaining mandatory transport evidence", () => {
    const proxy = readFileSync("scripts/local-storage-browser-proxy.ts", "utf8");
    expect(proxy).toContain('if (successfulGenomeStagingPost(target.href, LOCAL_STORAGE_ORIGIN, request.method, result.status)) forwardedUploads++;');
    expect(proxy).toContain('await requestProvider({ method: request.method,');
    expect(proxy).toContain('target.origin === LOCAL_STORAGE_ORIGIN');
    expect(proxy).toContain('"Installed provider did not return an HTTP response"');
    const guided = readFileSync("scripts/self-host-first-run-smoke.ts", "utf8");
    expect(guided).toContain('return genomeStagingStorageUrl(raw, LOCAL.origin);');
    expect(guided).toContain('if (method === "POST") return once("storage", 1);');
    expect(readFileSync("scripts/run-upload-browser.mts", "utf8"))
      .toContain('assert(storageProxy.uploads() > 0, "No browser upload crossed the actual provider proxy");');
  });
});
