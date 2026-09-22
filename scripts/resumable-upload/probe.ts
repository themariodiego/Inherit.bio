import { DECLARED_BYTES, MAX_PROVIDER_REQUESTS, PREVIEW_APP, PREVIEW_PROJECT, PREVIEW_STORAGE,
  REQUEST_TIMEOUT_MS, RUN_TIMEOUT_MS, TUS_PATH, refuse, validateCredentials, validateGrant, validateLocation, validateTarget, type ProbeGrant } from "./contract";
import { request, type ProbeFetch, type ProbeResponse } from "./http";
import { type ProbeReceipt, type ProbeStage, type SafeHeaders } from "./receipt";

type ProbeOptions = { project: unknown; appOrigin: unknown; optIn: unknown; credentials: unknown };
type Dependencies = { fetch: ProbeFetch; now?: () => number; save: (receipt: ProbeReceipt) => Promise<void> };
const isEmptyUpload = (response: SafeHeaders) => response.status === 200 && response.offset === 0
  && response.length === DECLARED_BYTES && response.tusVersion === "1.0.0";

/** Diagnostic only: one app issuance, an empty POST, three HEAD observations,
 * then DELETE and HEAD in finally. There is no file, PATCH or finalization API. */
export async function probeEmptyUpload(options: ProbeOptions, dependencies: Dependencies): Promise<ProbeReceipt> {
  validateTarget(options.project, options.appOrigin, options.optIn);
  const now = dependencies.now ?? Date.now;
  const credentials = validateCredentials(options.credentials, now());
  const deadline = performance.now() + RUN_TIMEOUT_MS;
  const receipt: ProbeReceipt = { schemaVersion: 1, previewProject: PREVIEW_PROJECT,
    startedAt: new Date(now()).toISOString(), finishedAt: null, declaredBytes: DECLARED_BYTES,
    sourceBytesSent: 0, patchRequests: 0, appIssuanceRequests: 0, providerRequests: 0, events: [],
    issuedUploadId: null,
    conclusion: "running", cleanup: "not-created", failurePhase: null,
    physicalFragmentCleanupProven: false, appIntegrationProven: false, capacityProven: false };
  let phase: ProbeStage = "issuance", grant: ProbeGrant | undefined, location: string | undefined;
  const stop = () => { receipt.failurePhase ??= phase; receipt.conclusion = "probe-stopped"; };
  async function event(response: ProbeResponse) {
    receipt.events.push({ stage: phase, at: new Date(now()).toISOString(), response: response.safe });
    await dependencies.save(receipt);
    return response;
  }
  async function provider(stage: ProbeStage, method: "POST" | "HEAD" | "DELETE", token?: string,
    extra: Record<string, string> = {}) {
    phase = stage;
    if (!grant || receipt.providerRequests >= MAX_PROVIDER_REQUESTS) refuse();
    const cleanup = stage === "terminate-empty-live-grant" || stage === "head-after-termination";
    const remaining = () => deadline - performance.now() - (cleanup ? 0 : 2 * REQUEST_TIMEOUT_MS);
    if (remaining() <= 0) refuse();
    receipt.providerRequests++;
    // A process can stop before fetch resolves. Persist conservative creation
    // uncertainty first; never leave the last receipt claiming nothing exists.
    if (method === "POST") await dependencies.save(receipt);
    const headers: Record<string, string> = { "Tus-Resumable": "1.0.0", apikey: credentials.anonKey, ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    return request(dependencies.fetch, method === "POST" ? `${PREVIEW_STORAGE}${TUS_PATH}` : location ?? refuse(),
      { method, headers }, false, remaining());
  }
  try {
    await dependencies.save(receipt);
    receipt.appIssuanceRequests = 1;
    await dependencies.save(receipt);
    const issued = await event(await request(dependencies.fetch, `${PREVIEW_APP}/api/files/upload-session`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: PREVIEW_APP,
        "Sec-Fetch-Site": "same-origin", Cookie: credentials.sessionCookie,
        "x-vercel-protection-bypass": credentials.protectionBypass },
      body: JSON.stringify({ subjectId: "me", declaredFormat: "VCF", sizeBytes: DECLARED_BYTES, sha256: null }),
    }, true, deadline - performance.now() - 2 * REQUEST_TIMEOUT_MS));
    if (issued.safe.status !== 201) refuse();
    grant = validateGrant(issued.json, credentials, now());
    receipt.issuedUploadId = grant.uploadId;
    const metadata = Object.entries({ bucketName: grant.bucket, objectName: grant.stagingKey,
      contentType: "application/octet-stream" }).map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`).join(",");
    receipt.cleanup = "creation-outcome-uncertain";
    const created = await provider("create-empty", "POST", grant.uploadToken,
      { "Upload-Length": String(DECLARED_BYTES), "Upload-Metadata": metadata, "x-upsert": "false" });
    // Retain a validated handle before persistence can fail, so finally can terminate it.
    if (created.safe.status === 201) {
      try { location = validateLocation(created.location, grant); receipt.cleanup = "unconfirmed"; }
      catch { await event(created); refuse(); }
    }
    await event(created);
    if (!location || created.safe.tusVersion !== "1.0.0") refuse();
    if (!isEmptyUpload((await event(await provider("head-live-grant", "HEAD", grant.uploadToken))).safe)) refuse();
    let readable = false;
    for (const [stage, token] of [["head-no-bearer", undefined], ["head-anonymous-bearer", credentials.anonKey]] as const) {
      const observed = (await event(await provider(stage, "HEAD", token))).safe;
      if (observed.status === 200) { if (!isEmptyUpload(observed)) refuse(); readable = true; }
      else if (![400, 401, 403, 404].includes(observed.status)) refuse();
    }
    receipt.conclusion = readable ? "offset-readable-without-upload-authority" : "no-offset-read-demonstrated";
  } catch { stop(); }
  finally {
    if (location && grant) {
      let deleted = false;
      try { const result = await provider("terminate-empty-live-grant", "DELETE", grant.uploadToken);
        deleted = result.safe.status === 204; await event(result); if (!deleted) refuse();
      } catch { stop(); }
      try { const result = await provider("head-after-termination", "HEAD", grant.uploadToken);
        if (deleted && result.safe.status === 404) receipt.cleanup = "protocol-termination-acknowledged";
        await event(result); if (result.safe.status !== 404) refuse();
      } catch { stop(); }
    }
    receipt.finishedAt = new Date(now()).toISOString();
    await dependencies.save(receipt).catch(() => refuse());
  }
  return receipt;
}
