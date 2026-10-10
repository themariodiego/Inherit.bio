/** Bounded synthetic R2 binding behind the real signed fragment gateway.
 * This proves local protocol behavior; it supplies no hosted-provider evidence. */
import assert from "node:assert/strict";
import https from "node:https";
import { createPublicKey } from "node:crypto";
import gateway from "../../workers/embryo-fragments/worker.mjs";
import { createEmbryoFragmentBinding } from "./embryo-fragment-fixture";

export const EMBRYO_BROWSER_FRAGMENT_ORIGIN = "https://embryo.fragments.test:8141";
export const EMBRYO_BROWSER_FRAGMENT_BUCKET = "inherit-embryo-ci";
export const EMBRYO_BROWSER_FRAGMENT_LIMITS = Object.freeze({ requests: 2048, concurrent: 1, objectBytes: 8_388_608, totalBytes: 33_554_432, objects: 512 });

export async function startEmbryoBrowserFragmentFixture(input: { publicJwk: Record<string, unknown>; key: Buffer; cert: Buffer }) {
  assert(input.publicJwk.kty === "EC" && input.publicJwk.crv === "P-256" && typeof input.publicJwk.kid === "string"
    && !Object.hasOwn(input.publicJwk, "d"), "Synthetic public signing key required");
  createPublicKey({ key: input.publicJwk, format: "jwk" });
  const store = createEmbryoFragmentBinding();
  let requests = 0, active = 0, bytesReceived = 0, closed = false;
  const server = https.createServer({ key: input.key, cert: input.cert }, async (incoming, outgoing) => {
    requests += 1;
    if (closed || requests > EMBRYO_BROWSER_FRAGMENT_LIMITS.requests || active >= EMBRYO_BROWSER_FRAGMENT_LIMITS.concurrent
      || incoming.url !== "/fragment" || incoming.headers.host !== "embryo.fragments.test:8141"
      || !["GET", "PUT"].includes(incoming.method ?? "")) { outgoing.writeHead(404).end(); incoming.resume(); return; }
    active += 1;
    incoming.setTimeout(10_000, () => incoming.destroy());
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length; bytesReceived += chunk.length;
        assert(!closed && size <= EMBRYO_BROWSER_FRAGMENT_LIMITS.objectBytes
          && bytesReceived <= EMBRYO_BROWSER_FRAGMENT_LIMITS.totalBytes, "Fixture body allowance exhausted");
        chunks.push(Buffer.from(chunk));
      }
      assert(store.values.size < EMBRYO_BROWSER_FRAGMENT_LIMITS.objects, "Fixture object allowance exhausted");
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(name, value);
      const reply = await gateway.fetch(new Request(`${EMBRYO_BROWSER_FRAGMENT_ORIGIN}/fragment`, {
        method: incoming.method, headers, ...(incoming.method === "PUT" ? { body: Uint8Array.from(Buffer.concat(chunks)) } : {}),
      }), { FRAGMENTS: store.binding, BUCKET_NAME: EMBRYO_BROWSER_FRAGMENT_BUCKET,
        TOKEN_ISSUER: "http://127.0.0.1:54321/auth/v1", SIGNING_PUBLIC_KEYS: JSON.stringify([input.publicJwk]) });
      assert(!closed, "Fixture closed");
      outgoing.writeHead(reply.status, Object.fromEntries(reply.headers.entries()));
      outgoing.end(Buffer.from(await reply.arrayBuffer()));
    } catch { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); }
    finally { active -= 1; }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(8141, "203.0.114.12", resolve); });
  return { async close() { closed = true; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.values.clear(); } };
}
