import { describe, expect, it, vi } from "vitest";
import { probeEmptyUpload } from "./probe";
import { PREVIEW_APP, PREVIEW_STORAGE, TUS_PATH } from "./contract";
import { grant, ids, location, NOW, options } from "./fixtures";
import { probeExitStatus, receiptSchema, serializeReceipt, type ProbeReceipt } from "./receipt";

const head = (status = 200, extra = {}) => new Response(null, { status, headers: {
  "Tus-Resumable": "1.0.0", ...(status === 200 ? { "Upload-Offset": "0", "Upload-Length": "512" } : {}), ...extra } });
function responses() { return [Response.json(grant(), { status: 201 }),
  new Response(null, { status: 201, headers: { Location: location, "Tus-Resumable": "1.0.0" } }),
  head(), head(400), head(), head(204), head(404)]; }
function harness(queue: (Response | Error)[] = responses()) {
  const saved: ProbeReceipt[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (!url || !init.method) throw new Error("missing request contract");
    const next = queue.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch, saved, now: () => NOW, save: async (value: ProbeReceipt) => { saved.push(JSON.parse(serializeReceipt(value))); } };
}

describe("empty provider diagnostic", () => {
  it("performs exactly one issuance and six provider calls, with no file bytes, redirects, or retries", async () => {
    const h = harness(), input = options();
    const result = await probeEmptyUpload(input, h);
    expect(result).toMatchObject({ appIssuanceRequests: 1, providerRequests: 6, sourceBytesSent: 0, patchRequests: 0,
      conclusion: "offset-readable-without-upload-authority", cleanup: "protocol-termination-acknowledged",
      physicalFragmentCleanupProven: false, appIntegrationProven: false, capacityProven: false, failurePhase: null });
    expect(h.fetch.mock.calls.map(call => call[1].method)).toEqual(["POST", "POST", "HEAD", "HEAD", "HEAD", "DELETE", "HEAD"]);
    const [url, issuance] = h.fetch.mock.calls[0];
    expect(url).toBe(`${PREVIEW_APP}/api/files/upload-session`);
    expect(JSON.parse(issuance.body as string)).toEqual({ subjectId: "me", declaredFormat: "VCF", sizeBytes: 512, sha256: null });
    expect(new Headers(issuance.headers).get("cookie")).toBe(input.credentials.sessionCookie);
    for (const [index, [url, init]] of h.fetch.mock.calls.entries()) {
      expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store"); expect(init.signal).toBeInstanceOf(AbortSignal);
      if (!index) continue;
      expect(Object.hasOwn(init, "body")).toBe(false);
      expect(url).toBe(index === 1 ? `${PREVIEW_STORAGE}${TUS_PATH}` : location);
      expect(new Headers(init.headers).has("cookie")).toBe(false);
      expect(new Headers(init.headers).has("x-vercel-protection-bypass")).toBe(false);
    }
    const createHeaders = new Headers(h.fetch.mock.calls[1][1].headers);
    expect(createHeaders.get("upload-length")).toBe("512"); expect(createHeaders.get("x-upsert")).toBe("false");
    expect(createHeaders.get("upload-metadata")).toBe(`bucketName Z2Vub21lcw==,objectName ${Buffer.from(ids.staging).toString("base64")},contentType YXBwbGljYXRpb24vb2N0ZXQtc3RyZWFt`);
    expect(new Headers(h.fetch.mock.calls[3][1].headers).has("authorization")).toBe(false);
    expect(new Headers(h.fetch.mock.calls[4][1].headers).get("authorization")).toBe(`Bearer ${input.credentials.anonKey}`);
    const serialized = JSON.stringify(h.saved);
    for (const secret of [location, grant().uploadToken, input.credentials.sessionCookie, input.credentials.anonKey,
      input.credentials.protectionBypass, ids.staging]) expect(serialized).not.toContain(secret);
    expect(result.issuedUploadId).toBe(ids.upload);
    expect(probeExitStatus(result)).toBe(2);
  });

  it("does not infer broad security from refused anonymous HEADs", async () => {
    const queue = responses(); queue[4] = head(403);
    const result = await probeEmptyUpload(options(), harness(queue));
    expect(result.conclusion).toBe("no-offset-read-demonstrated");
    expect(result.capacityProven).toBe(false);
    expect(probeExitStatus(result)).toBe(0);
    expect(probeExitStatus({ ...result, finishedAt: null })).toBe(1);
  });

  it.each(["live HEAD", "no-bearer HEAD", "anonymous HEAD"])("terminates once after a failing %s, without retries", async stage => {
    const failAt = ["live HEAD", "no-bearer HEAD", "anonymous HEAD"].indexOf(stage) + 2;
    const h = harness([...responses().slice(0, failAt), new Error(`secret ${location} ${grant().uploadToken}`), head(204), head(404)]);
    const result = await probeEmptyUpload(options(), h);
    expect(result.conclusion).toBe("probe-stopped"); expect(result.cleanup).toBe("protocol-termination-acknowledged");
    expect(h.fetch.mock.calls.slice(-2).map(call => call[1].method)).toEqual(["DELETE", "HEAD"]);
    expect(h.fetch).toHaveBeenCalledTimes(failAt + 3);
    expect(serializeReceipt(result)).not.toContain("secret");
  });

  it("still terminates if receipt persistence fails after creation", async () => {
    const h = harness([responses()[0], responses()[1], head(204), head(404)]);
    const save = h.save;
    h.save = async receipt => { if (receipt.events.length === 2) throw new Error("private detail"); await save(receipt); };
    const result = await probeEmptyUpload(options(), h);
    expect(result.failurePhase).toBe("create-empty"); expect(result.cleanup).toBe("protocol-termination-acknowledged");
    expect(h.fetch.mock.calls.map(call => call[1].method)).toEqual(["POST", "POST", "DELETE", "HEAD"]);
  });

  it("durably records a conservative creation attempt before invoking the provider", async () => {
    const h = harness(), original = h.fetch;
    let beforeIssuance: ProbeReceipt | undefined, beforeCreation: ProbeReceipt | undefined;
    const fetch = async (url: string, init: RequestInit) => {
      if (url === `${PREVIEW_STORAGE}${TUS_PATH}`) {
        beforeCreation = h.saved.at(-1);
      } else if (url === `${PREVIEW_APP}/api/files/upload-session`) {
        beforeIssuance = h.saved.at(-1);
      }
      return original(url, init);
    };
    const result = await probeEmptyUpload(options(), { ...h, fetch });
    expect(result.conclusion).toBe("offset-readable-without-upload-authority");
    expect(h.fetch).toHaveBeenCalledTimes(7);
    expect(beforeIssuance?.appIssuanceRequests).toBe(1);
    expect(beforeCreation).toMatchObject({ providerRequests: 1, cleanup: "creation-outcome-uncertain", issuedUploadId: ids.upload });
  });

  it("does not create an upload if the pre-attempt receipt cannot be saved", async () => {
    const h = harness([responses()[0]]), original = h.save;
    h.save = async receipt => {
      if (receipt.cleanup === "creation-outcome-uncertain") throw new Error("private disk detail");
      await original(receipt);
    };
    await expect(probeEmptyUpload(options(), h)).rejects.toThrow(/^probe_contract_refused$/);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("records uncertainty and makes no guessed cleanup request if POST or its Location is uncertain", async () => {
    for (const response of [new Error("timeout"), new Response(null, { status: 201, headers: { Location: "https://inherit.bio/private" } })]) {
      const h = harness([responses()[0], response]);
      const result = await probeEmptyUpload(options(), h);
      expect(result.cleanup).toBe("creation-outcome-uncertain"); expect(result.conclusion).toBe("probe-stopped");
      expect(h.fetch).toHaveBeenCalledTimes(2);
    }
  });

  it.each(["1", "-1", "0x0", "9007199254740992"])("rejects unexpected live offset %s and terminates", async offset => {
    const h = harness([responses()[0], responses()[1], head(200, { "Upload-Offset": offset }), head(204), head(404)]);
    const result = await probeEmptyUpload(options(), h);
    expect(result.conclusion).toBe("probe-stopped"); expect(result.cleanup).toBe("protocol-termination-acknowledged");
  });

  it("rejects the wrong live length and ambiguous anonymous responses", async () => {
    for (const badHead of [head(200, { "Upload-Length": "513" }), head(500)]) {
      const h = harness([responses()[0], responses()[1], head(), head(400), badHead, head(204), head(404)]);
      const result = await probeEmptyUpload(options(), h);
      expect(result.conclusion).toBe("probe-stopped"); expect(result.failurePhase).toBe("head-anonymous-bearer");
    }
  });

  it("does not claim termination if DELETE fails even when HEAD is absent", async () => {
    const queue: (Response | Error)[] = responses(); queue[5] = new Error("private failure");
    const h = harness(queue), result = await probeEmptyUpload(options(), h);
    expect(result.cleanup).toBe("unconfirmed"); expect(result.failurePhase).toBe("terminate-empty-live-grant");
    expect(probeExitStatus(result)).toBe(1);
    expect(h.fetch).toHaveBeenCalledTimes(7);
  });

  it("does not claim termination from DELETE alone", async () => {
    const queue = responses(); queue[6] = head();
    const result = await probeEmptyUpload(options(), harness(queue));
    expect(result.cleanup).toBe("unconfirmed"); expect(result.failurePhase).toBe("head-after-termination");
  });

  it("rejects extra receipt fields instead of persisting a leaked credential", async () => {
    const receipt = await probeEmptyUpload(options(), harness());
    expect(() => serializeReceipt({ ...receipt, uploadToken: "do-not-write" } as ProbeReceipt)).toThrow();
    expect(receiptSchema.safeParse({ ...receipt, physicalFragmentCleanupProven: true }).success).toBe(false);
    for (const issuedUploadId of [location, grant().uploadToken, "not-a-uuid"]) {
      expect(receiptSchema.safeParse({ ...receipt, issuedUploadId }).success).toBe(false);
    }
  });

  it("refuses an invalid target before any network or receipt write", async () => {
    const h = harness();
    await expect(probeEmptyUpload({ ...options(), appOrigin: "https://inherit.bio" }, h)).rejects.toThrow("probe_contract_refused");
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.saved).toEqual([]);
  });
});
