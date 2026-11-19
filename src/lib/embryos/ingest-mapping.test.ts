import { describe, expect, it } from "vitest";
import register from "../../../docs/route-register.json";
import { TABLE_CONFIGURATION_KEYS, VCF_TRANSPORT_KEYS } from "./ingest-configure";
import {
  BUILD_CHALLENGE_KEYS,
  COLUMN_CHALLENGE_KEYS,
  TRANSPORT_KEYS,
  buildChallengeResponse,
  columnChallengeResponse,
  decideResult,
  inspectHeader,
  inspectResult,
  neutralColumnLabel,
  readDecisionBody,
  readInspectBody,
  transportResponse,
} from "./ingest-mapping";

/**
 * The boundary of `api.embryo-ingest-mapping` (ADR 0037): the in-memory
 * header rule, the closed request bodies and the closed responses. Synthetic
 * header cells only; `PRIVATE_` marks what must never leave.
 */
function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://inherit.example/api/embryo-ingest/x/mapping", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("inspectHeader", () => {
  it("refuses a forbidden column first, before the header rule or the plan", () => {
    expect(inspectHeader({ headerColumns: ["Embryo", "Chromosome", "Position", "Genotype", "Gender"] }))
      .toEqual({ kind: "terminal", branch: "header" });
    expect(inspectHeader({ headerColumns: ["Karyotype"] })).toEqual({ kind: "terminal", branch: "header" });
  });

  it("names a header that is not a table, and a plan with no column left, as their own terminal branches", () => {
    expect(inspectHeader({ headerColumns: ["Well", "Plate", "PRIVATE_NOTE"] })).toEqual({ kind: "terminal", branch: "format" });
    expect(inspectHeader({ headerColumns: ["Embryo", "Chromosome", "Position"] })).toEqual({ kind: "terminal", branch: "mapping" });
  });

  it("answers a complete header with its column count and locus kind only", () => {
    expect(inspectHeader({ headerColumns: ["Sample", "SNP", "Genotype", "PRIVATE_NOTE"] }))
      .toEqual({ kind: "complete", columnCount: 4, locus: "rsid" });
  });

  it("answers an ambiguous header with neutral indexes and canonical candidates, never a cell", () => {
    const inspection = inspectHeader({ headerColumns: ["Embryo", "Chromosome", "Position", "Genotype", "Call", "PRIVATE_NOTE"] });
    expect(inspection).toEqual({ kind: "columns", columnCount: 6, locus: "chrom-pos", decisions: [
      { columnIndex: 3, candidateFields: ["genotype"] }, { columnIndex: 4, candidateFields: ["genotype"] }] });
    expect(JSON.stringify(inspection)).not.toMatch(/PRIVATE|Genotype|Call|Embryo/);
  });

  it("zeroizes the submitted copy whatever it decides", () => {
    for (const headerColumns of [["Sex"], ["Embryo", "SNP", "Call"], ["Well"]]) {
      const body = { headerColumns: [...headerColumns] };
      inspectHeader(body);
      expect(body.headerColumns).toEqual([]);
    }
  });
});

describe("readInspectBody", () => {
  it("accepts the two closed fields", async () => {
    expect(await readInspectBody(post({ headerColumns: ["Embryo"], nonce: "sealed.token" })))
      .toEqual({ ok: true, body: { headerColumns: ["Embryo"], nonce: "sealed.token" } });
  });

  it("refuses an oversized body as the body, counting what arrives", async () => {
    expect(await readInspectBody(post({ headerColumns: ["Embryo"], nonce: "x".repeat(70_000) }))).toEqual({ ok: false, issues: ["body"] });
    expect(await readInspectBody(post({ headerColumns: ["Embryo"], nonce: "n" }, { "content-length": "65537" })))
      .toEqual({ ok: false, issues: ["body"] });
  });

  it("names only closed fields", async () => {
    expect(await readInspectBody(post({ headerColumns: "Embryo", nonce: 3 }))).toEqual({ ok: false, issues: ["headerColumns", "nonce"] });
    expect(await readInspectBody(post({ headerColumns: ["Embryo"], nonce: "n", rows: [["PRIVATE_A"]] }))).toEqual({ ok: false, issues: ["body"] });
    expect(await readInspectBody(post("[]"))).toEqual({ ok: false, issues: ["body"] });
  });
});

describe("readDecisionBody", () => {
  const ID = "K".repeat(43);
  it("reads exactly one of the two closed shapes", async () => {
    expect(await readDecisionBody(post({ challengeId: ID, mappings: [{ columnIndex: 0, field: "embryo" }], nonce: "n" })))
      .toEqual({ kind: "columns", challengeId: ID, mappings: [{ columnIndex: 0, field: "embryo" }], nonce: "n" });
    expect(await readDecisionBody(post({ challengeId: ID, referenceBuild: "unknown", nonce: "n" })))
      .toEqual({ kind: "build", challengeId: ID, referenceBuild: "unknown", nonce: "n" });
  });

  it.each([
    [{ challengeId: ID, nonce: "n" }],
    [{ challengeId: ID, referenceBuild: "GRCh38", mappings: [{ columnIndex: 0, field: "embryo" }], nonce: "n" }],
    [{ challengeId: ID, referenceBuild: "b37", nonce: "n" }],
    [{ challengeId: ID, mappings: [{ columnIndex: -1, field: "embryo" }], nonce: "n" }],
    [{ challengeId: ID, mappings: [{ columnIndex: 0, field: "Embryo" }], nonce: "n" }],
    [{ challengeId: ID, referenceBuild: "GRCh38", nonce: "n", inferenceAgreement: 0.99 }],
    [{ challengeId: ID, referenceBuild: "GRCh38", nonce: "n", inferenceMatchCount: 1000 }],
  ])("reads %j as nothing", async (body) => {
    expect(await readDecisionBody(post(body))).toBeNull();
  });
});

describe("the closed responses", () => {
  const expiresAt = "2026-10-16T12:00:00.000Z";

  it("labels a column only by its number", () => {
    expect(neutralColumnLabel(0)).toBe("Column 1");
    expect(neutralColumnLabel(127)).toBe("Column 128");
  });

  it("answers each branch with exactly its registered keys", async () => {
    const columns = await columnChallengeResponse({ challengeId: "c", decisions: [{ columnIndex: 2, candidateFields: ["genotype"] }],
      expiresAt, nonce: "n" });
    expect(Object.keys(await columns.json()).sort()).toEqual([...COLUMN_CHALLENGE_KEYS].sort());
    const build = await buildChallengeResponse({ challengeId: "c", expiresAt, nonce: "n" });
    expect(Object.keys(await build.json()).sort()).toEqual([...BUILD_CHALLENGE_KEYS].sort());
    const transport = await transportResponse({ build: "GRCh38", challenge: "c", revision: 2, completionNonce: "n", csrfToken: "t" });
    expect(Object.keys(await transport.json()).sort()).toEqual([...TRANSPORT_KEYS].sort());
    for (const response of [columns, build, transport]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("blocks a transport that would carry any other key", async () => {
    const response = await transportResponse({ build: "GRCh38", challenge: "c", revision: 2, completionNonce: "n", csrfToken: "t",
      header: "PRIVATE_NOTE" } as never);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("PRIVATE_NOTE");
  });

  it("reads only the closed database outcomes", () => {
    const cohortId = "a0000000-0000-4000-8000-000000000001";
    expect(inspectResult.safeParse({ status: "terminal", branch: "header", cohortId, ingestRevision: 1 }).success).toBe(true);
    expect(inspectResult.safeParse({ status: "terminal", branch: "build_unknown", cohortId, ingestRevision: 1 }).success).toBe(false);
    expect(decideResult.safeParse({ status: "terminal", branch: "build_unknown", cohortId, ingestRevision: 1 }).success).toBe(true);
    expect(decideResult.safeParse({ status: "terminal", branch: "header", cohortId, ingestRevision: 1 }).success).toBe(false);
    for (const value of [{ status: "challenge", kind: "columns", revision: 0, expiresAt },
      { status: "challenge", kind: "sex", revision: 3, expiresAt }, { status: "transport", build: "hg19", revision: 3 },
      { status: "transport", build: "GRCh38", revision: 3, challenge: "leak" }, { status: "resolved", kind: "build" }]) {
      expect(inspectResult.safeParse(value).success, JSON.stringify(value)).toBe(false);
      expect(decideResult.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });
});

/**
 * The register change the owner decided on 16 October 2026 ("Token rotation
 * in the embryo mapping responses"), pinned against what the route sends:
 * every mapping answer carries the next operation nonce, the answer that
 * leaves nothing to decide carries the transport challenge exactly as the VCF
 * configure response does, a decision answers 200 rather than an empty 204,
 * and the session CSRF rule is unchanged.
 */
describe("the registered mapping responses", () => {
  type Branch = { status: number; body: Record<string, unknown>; unknownFields: string };
  const contracts = register.responseContracts as unknown as Record<string, Record<string, unknown>>;
  const challenge = contracts["pgt-mapping-challenge-v1"] as Record<string, Branch>;
  const decision = contracts["embryo-ingest-decision-v1"] as Record<string, { status: number; schemaFrom?: string;
    oneOfBodies?: { schemaFrom: string }[] }>;

  it("registers exactly the keys each branch of the route sends, each a closed 200", () => {
    expect(Object.keys(challenge.columns.body).sort()).toEqual([...COLUMN_CHALLENGE_KEYS].sort());
    expect(Object.keys(challenge.build.body).sort()).toEqual([...BUILD_CHALLENGE_KEYS].sort());
    expect(Object.keys(challenge.transport.body).sort()).toEqual([...TRANSPORT_KEYS].sort());
    for (const branch of [challenge.columns, challenge.build, challenge.transport]) {
      expect(branch.status).toBe(200);
      expect(branch.unknownFields).toBe("forbidden");
    }
  });

  it("carries the next operation nonce in every branch, and the transport where nothing is left to decide", () => {
    expect(challenge.columns.body.nonce).toMatch(/^the-next-operation-nonce/);
    expect(challenge.build.body.nonce).toMatch(/^the-next-operation-nonce/);
    expect(challenge.transport.body.completionNonce).toMatch(/^the-next-operation-nonce/);
    // The VCF configure response's pattern: the same five values, under `kind`.
    expect(Object.keys(challenge.transport.body).filter((key) => key !== "kind").sort()).toEqual([...VCF_TRANSPORT_KEYS].sort());
  });

  it("answers a nonterminal decision with 200 and a body, never an empty 204", () => {
    expect(decision.columnMappingAccepted.status).toBe(200);
    expect(decision.columnMappingAccepted.oneOfBodies!.map((body) => body.schemaFrom)).toEqual([
      "responseContracts.pgt-mapping-challenge-v1.build.body", "responseContracts.pgt-mapping-challenge-v1.transport.body"]);
    expect(decision.buildAccepted.status).toBe(200);
    expect(decision.buildAccepted.schemaFrom).toBe("responseContracts.pgt-mapping-challenge-v1.transport.body");
    expect((decision.buildUnknown as unknown as Branch).status).toBe(422);
  });

  it("registers the table configure answer as the one inspection nonce, bound to the configure route", () => {
    const configured = (contracts["embryo-table-configuration-v1"] as Record<string, Branch>).configured;
    expect(Object.keys(configured.body)).toEqual([...TABLE_CONFIGURATION_KEYS]);
    expect(register.responseContractBindings.routes["api.embryo-ingest-configure"]).toContain("embryo-table-configuration-v1");
  });

  it("leaves the session CSRF rule as it was: required for completion, not for the mapping route", () => {
    expect(register.mutationSecurityBindings.csrfTransport.requiredFor)
      .toBe("every-state-changing-method-including-a-body-forbidden-route-except-api.embryo-ingest-chunk-as-declared-by-its-policy.requestAuthority");
    const route = (id: string) => register.routes.find((entry) => entry.id === id) as unknown as Record<string, unknown>;
    expect(route("api.embryo-ingest-complete").requestContract).toMatchObject({ requiredHeader: "X-Inherit-CSRF-bound-to-the-upload-session" });
    expect(JSON.stringify(route("api.embryo-ingest-mapping"))).not.toMatch(/requiredHeader/);
  });
});
