import { describe, expect, it } from "vitest";
import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS, INGEST_CHUNK_MAXIMUM_BYTES } from "@/lib/genome/ingest-limits";
import { cohortCreatedBody, cohortFinalizeBody, ingestCookieParts } from "./cohort-create";

/**
 * The response boundary of `POST /api/embryo-cohorts`. The mint returns two
 * credentials alongside the five public values, so the case that matters most
 * here is the one that proves neither credential survives into a body.
 */
const ORIGIN = "https://www.inherit.bio";
const SECRET = "A".repeat(43);
const CHALLENGE = "kZ9Qd3yQ8wq7fF2bN5hT1xV4cR6sJ0mL2pY8uW3aE7g";

function mint(overrides: Record<string, unknown> = {}) {
  return {
    session: "11111111-1111-4111-8111-111111111111",
    uploadId: "22222222-2222-4222-8222-222222222222",
    cookieValue: SECRET,
    challenge: CHALLENGE,
    revision: 1,
    sampleHandles: [
      { ordinal: 0, handle: "handle-zero" },
      { ordinal: 1, handle: "handle-one" },
    ],
    expiresAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
  };
}

function card(embryoId: string, label: string) {
  return {
    embryo_id: embryoId,
    display_label: label,
    record_key: "0123456789ABCDEFGHJK",
    closing_date_iso: "2028-09-21",
    closing_date_state: "provisional_until_terminal_ordinal_resolution" as const,
    date_revision: 1,
  };
}

function cohort(overrides: Record<string, unknown> = {}) {
  return {
    cohort_id: "33333333-3333-4333-8333-333333333333",
    embryo_count: 2,
    recipient_set_revision: 4,
    key_revision: 2,
    caller_state: "delivered_inline",
    cards: [
      card("44444444-4444-4444-8444-444444444444", "Embryo 1"),
      card("55555555-5555-4555-8555-555555555555", "Embryo 2"),
    ],
    ...overrides,
  };
}

describe("the cohort-created body", () => {
  it("builds the register's shape from the one finalize transaction", () => {
    const body = cohortCreatedBody({ cohort: cohort(), ingest: mint() }, ORIGIN);
    expect(body.cohort_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(body.status).toBe("upload_ready");
    expect(body.embryo_count).toBe(2);
    expect(body.upload_session.transport).toBe("embryo-chunks");
    expect(body.upload_session.session).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.upload_session.sampleHandles).toEqual([
      { ordinal: 0, handle: "handle-zero" },
      { ordinal: 1, handle: "handle-one" },
    ]);
    expect(body.record_key_delivery).toEqual({ recipient_set_revision: 4, caller_state: "delivered_inline" });
    expect(body.record_key_cards).toHaveLength(2);
    expect(body.record_key_cards[0].display_label).toBe("Embryo 1");
  });

  /**
   * The one that would be a disclosure rather than a bug. `cookieValue` is
   * the upload session's secret and `challenge` is the mapping challenge;
   * the database stores only a hash of the first and answers the second
   * through the mapping route. A body carrying either would hand a credential
   * to anything that can read the response.
   */
  it("carries neither the upload-session secret nor the mapping challenge", () => {
    const serialized = JSON.stringify(cohortCreatedBody({ cohort: cohort(), ingest: mint() }, ORIGIN));
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(CHALLENGE);
    expect(serialized).not.toContain("cookieValue");
    expect(serialized).not.toContain("challenge");
  });

  /** The register's recipientRule: the caller state decides, not the RPC. */
  it("returns no cards to a caller who is not a Record Key recipient", () => {
    const body = cohortCreatedBody({
      cohort: cohort({ caller_state: "not_a_card_recipient" }),
      ingest: mint(),
    });
    expect(body.record_key_cards).toEqual([]);
    expect(body.record_key_delivery.caller_state).toBe("not_a_card_recipient");
  });

  /** The transport bounds are the deployment's, never the session's. */
  it("reads the three limits from ingest-limits rather than the mint", () => {
    const body = cohortCreatedBody({ cohort: cohort(), ingest: mint() }, ORIGIN);
    expect(body.upload_session.chunkBytes).toBe(INGEST_CHUNK_MAXIMUM_BYTES);
    expect(body.upload_session.maximumChunks).toBe(LIMITS.maximumChunks);
    expect(body.upload_session.maximumInputBytes).toBe(LIMITS.maximumUncompressedInputBytes);
  });

  it("refuses a mint that is missing its cookie value", () => {
    const broken = mint();
    delete (broken as Record<string, unknown>).cookieValue;
    expect(() => cohortCreatedBody({ cohort: cohort(), ingest: broken }, ORIGIN)).toThrow();
  });

  it("refuses a card array the database should never have produced", () => {
    expect(() =>
      cohortCreatedBody({ cohort: cohort({ cards: [{ ...card("66666666-6666-4666-8666-666666666666", "Embryo 1"), leaked: "x" }] }), ingest: mint() }, ORIGIN),
    ).toThrow();
  });
});

describe("the cohort-finalize request body", () => {
  const valid = {
    cohortDraftId: "77777777-7777-4777-8777-777777777777",
    insuranceAcknowledgementId: "88888888-8888-4888-8888-888888888888",
    futurePersonCharterAcknowledgementId: "99999999-9999-4999-8999-999999999999",
    nonce: "sealed.token",
  };

  it("accepts exactly the register's four values", () => {
    expect(cohortFinalizeBody.safeParse(valid).success).toBe(true);
  });

  /**
   * Fifteen fields are `serverAuthoritative` in the register. A body that
   * carried one of them would be a request trying to set something the
   * database decides, so the schema is closed rather than stripping.
   */
  it("refuses a body that tries to set a server-authoritative field", () => {
    for (const extra of ["embryoCount", "uploadClass", "cohortId", "approval"]) {
      expect(cohortFinalizeBody.safeParse({ ...valid, [extra]: 2 }).success, extra).toBe(false);
    }
  });

  it("refuses a draft id that is not a UUID", () => {
    expect(cohortFinalizeBody.safeParse({ ...valid, cohortDraftId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("the ingest cookie parts", () => {
  it("returns the session, its secret and its fixed expiry together", () => {
    const parts = ingestCookieParts({ cohort: cohort(), ingest: mint() });
    expect(parts.session).toBe("11111111-1111-4111-8111-111111111111");
    expect(parts.secret).toBe(SECRET);
    expect(parts.expiresAt.toISOString()).toBe("2026-09-22T12:00:00.000Z");
  });
});
