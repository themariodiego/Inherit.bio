import "server-only";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export type ModelEndpoint = { baseUrl: string; origin: string; providerClass: "local" | "cloud"; runtimeAttestationFingerprint: string };
export type ModelRuntime = { deployment: string; localAllowed: boolean; origins: string[]; attestation: string };

/** The operator must actually establish the named network boundary; this flag
 * records that attestation, it does not build or verify an isolated network. */
export function modelRuntime(env: Record<string, string | undefined> = process.env): ModelRuntime {
  const hosted = env.VERCEL !== undefined || env.VERCEL_ENV !== undefined;
  const deployment = hosted ? "vercel" : env.INHERIT_DEPLOYMENT_KIND ?? "unattested";
  let origins: string[] = [];
  try {
    const parsed: unknown = JSON.parse(env.INHERIT_LOCAL_MODEL_ORIGINS ?? "[]");
    if (Array.isArray(parsed) && parsed.length <= 16 && parsed.every(v => typeof v === "string" && new URL(v).origin === v)) origins = [...new Set(parsed)].sort();
  } catch { /* Invalid setup never enables local transport. */ }
  const attestation = env.INHERIT_LOCAL_MODEL_HOST_ATTESTATION ?? "";
  const localAllowed = !hosted && deployment === "self-hosted-development"
    && env.ALLOW_LOCAL_MODEL_ENDPOINTS === "1" && attestation === "same-host-egress-isolated-v1" && origins.length > 0;
  return { deployment, localAllowed, origins, attestation: localAllowed ? attestation : "unavailable" };
}

export function modelRuntimeRevision(runtime = modelRuntime()): string {
  return createHash("sha256").update(JSON.stringify({ policy: "model-endpoint-v1", ...runtime })).digest("hex");
}

export function normalizeModelEndpoint(baseUrl: string, runtime = modelRuntime()): ModelEndpoint {
  if (baseUrl.length > 2048 || /[\\\s%]/.test(baseUrl) || /\/\.{1,2}(?:\/|$)/.test(baseUrl)) throw new Error("model_endpoint_unavailable");
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) throw new Error("model_endpoint_unavailable");
  const local = runtime.localAllowed && runtime.origins.includes(url.origin);
  if (!local && url.protocol !== "https:") throw new Error("model_endpoint_unavailable");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !allowedModelAddress(host, local)) throw new Error("model_endpoint_unavailable");
  if (!local && (host === "localhost" || /\.(localhost|local|internal)$/.test(host))) throw new Error("model_endpoint_unavailable");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return { baseUrl: url.toString().replace(/\/$/, ""), origin: url.origin, providerClass: local ? "local" : "cloud", runtimeAttestationFingerprint: modelRuntimeRevision(runtime) };
}

/** Same-host means loopback. A private LAN endpoint is remote disclosure. */
export function allowedModelAddress(address: string, local: boolean): boolean {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split(".").map(Number);
    if (local) return a === 127;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const value = ipv6Number(address);
  if (local) return value === BigInt(1);
  const within = (base: string, bits: bigint) => value >> (BigInt(128) - bits) === ipv6Number(base) >> (BigInt(128) - bits);
  return within("2000::", BigInt(3)) && !within("2001::", BigInt(23))
    && !within("2001:db8::", BigInt(32)) && !within("2002::", BigInt(16)) && !within("3fff::", BigInt(20));
}

function ipv6Number(address: string): bigint {
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const [head, tail] = canonical.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const pieces = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return pieces.reduce((value: bigint, piece: string) => (value << BigInt(16)) | BigInt(`0x${piece}`), BigInt(0));
}

export async function resolveModelEndpoint(endpoint: ModelEndpoint) {
  const hostname = new URL(endpoint.baseUrl).hostname.replace(/^\[|\]$/g, "");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
    : await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("model_endpoint_unavailable")), 10_000); }),
      ]).finally(() => { if (timeout) clearTimeout(timeout); });
  if (!addresses.length || addresses.some(row => !allowedModelAddress(row.address, endpoint.providerClass === "local"))) throw new Error("model_endpoint_unavailable");
  return addresses[0];
}

/** An SDK-compatible fetch which resolves afresh, pins the connection, checks
 * live consent immediately before sending, and never follows a redirect. */
export function createPinnedModelFetch(endpoint: ModelEndpoint, authorize: () => Promise<boolean>): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    if (request.method !== "POST" || target.origin !== endpoint.origin || target.username || target.password
      || target.hash || target.search || modelRuntimeRevision() !== endpoint.runtimeAttestationFingerprint) throw new Error("model_endpoint_unavailable");
    const bodyParts: Uint8Array[] = []; let bodySize = 0;
    const reader = request.body?.getReader();
    if (reader) for (;;) {
      const item = await reader.read(); if (item.done) break;
      bodySize += item.value.length;
      if (bodySize > 2_000_000) { await reader.cancel(); throw new Error("model_request_too_large"); }
      bodyParts.push(item.value);
    }
    const body = Buffer.concat(bodyParts);
    const address = await resolveModelEndpoint(endpoint);
    if (request.signal.aborted || !(await authorize())) throw new Error("copilot_authority_unavailable");
    const headers = Object.fromEntries(request.headers);
    for (const key of ["host", "connection", "transfer-encoding", "content-length", "proxy-authorization"]) delete headers[key];
    headers["accept-encoding"] = "identity";
    headers["content-length"] = String(body.length);
    return await new Promise<Response>((resolve, reject) => {
      const client = target.protocol === "https:" ? https : http;
      const req = client.request(target, {
        method: "POST", headers, agent: false,
        lookup: (_host, _options, callback) => {
          const finish = (error: Error | null) => {
            if (_options.all) (callback as unknown as (error: Error | null, addresses: { address: string; family: number }[]) => void)(error, [address]);
            else callback(error, address.address, address.family);
          };
          void authorize().then(ok => finish(ok ? null : new Error("copilot_authority_unavailable")),
            () => finish(new Error("copilot_authority_unavailable")));
        },
      }, res => {
        if (!res.statusCode || (res.statusCode >= 300 && res.statusCode < 400) || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
          res.destroy(); req.destroy(); reject(new Error("model_endpoint_unavailable")); return;
        }
        let size = 0; const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) { res.destroy(); req.destroy(); reject(new Error("model_response_too_large")); }
          else chunks.push(chunk);
        });
        res.on("error", () => reject(new Error("model_endpoint_unavailable")));
        res.on("end", () => {
          try {
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) if (value && !["transfer-encoding", "connection", "content-length", "set-cookie"].includes(key)) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
            const bytes = res.statusCode === 204 || res.statusCode === 205 ? null : Buffer.concat(chunks);
            resolve(new Response(bytes, { status: res.statusCode, headers: responseHeaders }));
          } catch { reject(new Error("model_endpoint_unavailable")); }
        });
      });
      const deadline = setTimeout(() => req.destroy(new Error("model_timeout")), 120_000);
      const abort = () => req.destroy(new Error("model_request_aborted"));
      request.signal.addEventListener("abort", abort, { once: true });
      req.on("close", () => { clearTimeout(deadline); request.signal.removeEventListener("abort", abort); });
      req.on("error", () => reject(new Error("model_endpoint_unavailable")));
      req.setTimeout(120_000, () => req.destroy(new Error("model_timeout")));
      req.end(body);
    });
  };
}
