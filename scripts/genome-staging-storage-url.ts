import { genomeStagingKeySchema } from "../src/lib/uploads/genome-object-key";

/** Locator syntax only; origins come from each runner's existing closed target.
 * Permission and actual response-to-issuance equality remain separate checks. */
export function genomeStagingStorageUrl(raw: string, origin: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  const prefix = "/storage/v1/object/genomes/";
  return url.origin === origin && !url.username && !url.password && !url.search && !url.hash
    && raw === url.origin + url.pathname && url.pathname.startsWith(prefix)
    && genomeStagingKeySchema.safeParse(url.pathname.slice(prefix.length)).success;
}

/** Count only the actual installed provider's successful staging POST. */
export function successfulGenomeStagingPost(raw: string, origin: string, method: string | undefined, status: number): boolean {
  return method === "POST" && status >= 200 && status < 300 && genomeStagingStorageUrl(raw, origin);
}
