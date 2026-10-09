import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { claimIntakeBody, claimIntakeIssues, sealClaimIntake } = await import("./claim-intake");
const { decryptSecret } = await import("@/lib/crypto");

afterAll(() => {
  vi.unstubAllEnvs();
});

/** 28 September 2026, midday UTC. */
const NOW = Date.UTC(2026, 8, 28, 12);
const schema = claimIntakeBody(() => NOW);

const RECORD_KEY = "0123456789ABCDEFGHJK";
const RECOVERY_KEY = "MNPQRSTVWXYZ01234567";

const identity = {
  claimantName: "Ada Example",
  contactEmail: "claimant@e2e.local",
  affirmed: true,
};

const bodies = {
  "record-key": { mode: "record-key", recordKey: RECORD_KEY, claimantDateOfBirth: "2000-01-31", ...identity },
  "claimant-recovery-key": { mode: "claimant-recovery-key", recoveryKey: RECOVERY_KEY, claimantDateOfBirth: "2000-01-31", ...identity },
  "keyless-start": {
    mode: "keyless-start",
    childDateOfBirth: "2008-09-28",
    childPlaceOfBirth: "Leeds",
    parentNames: ["Parent One", "Parent Two"],
    ...identity,
  },
} as const;

function issuesOf(body: unknown): string[] {
  const parsed = schema.safeParse(body);
  return parsed.success ? [] : claimIntakeIssues(parsed.error);
}

/** AES-256-GCM laid out as iv (12), tag (16), text. */
function open(key: Buffer, blob: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8");
}

describe("closed-future-person-claim-intake-v1: three closed bodies", () => {
  it.each(Object.entries(bodies))("accepts a complete %s body", (_mode, body) => {
    expect(issuesOf(body)).toEqual([]);
  });

  it.each(Object.entries(bodies))("refuses a %s body with a field the register does not list", (_mode, body) => {
    expect(issuesOf({ ...body, embryoId: "e" })).toEqual(["body"]);
  });

  it("refuses a field that belongs to another mode", () => {
    expect(issuesOf({ ...bodies["record-key"], recoveryKey: RECOVERY_KEY })).toEqual(["body"]);
    expect(issuesOf({ ...bodies["keyless-start"], recordKey: RECORD_KEY })).toEqual(["body"]);
  });

  it("refuses an unknown mode and a missing one", () => {
    expect(issuesOf({ ...bodies["record-key"], mode: "embryo-id" })).toEqual(["mode"]);
    const withoutMode: Record<string, unknown> = { ...bodies["record-key"] };
    delete withoutMode.mode;
    expect(issuesOf(withoutMode)).toEqual(["mode"]);
  });

  it("needs the affirmation to be exactly true", () => {
    expect(issuesOf({ ...bodies["record-key"], affirmed: false })).toEqual(["affirmed"]);
    expect(issuesOf({ ...bodies["record-key"], affirmed: "true" })).toEqual(["affirmed"]);
  });

  it.each([
    ["lower case", RECORD_KEY.toLowerCase()],
    ["one short", RECORD_KEY.slice(1)],
    ["one long", `${RECORD_KEY}0`],
    ["a letter the alphabet leaves out", `${RECORD_KEY.slice(1)}I`],
    ["dashes", "01234-56789-ABCDE-FGHJK"],
  ])("refuses a key written with %s", (_label, key) => {
    expect(issuesOf({ ...bodies["record-key"], recordKey: key })).toEqual(["recordKey"]);
    expect(issuesOf({ ...bodies["claimant-recovery-key"], recoveryKey: key })).toEqual(["recoveryKey"]);
  });

  it("accepts a claimant on their 18th birthday and refuses one a day younger", () => {
    expect(issuesOf({ ...bodies["record-key"], claimantDateOfBirth: "2008-09-28" })).toEqual([]);
    expect(issuesOf({ ...bodies["record-key"], claimantDateOfBirth: "2008-09-29" })).toEqual(["claimantDateOfBirth"]);
  });

  it("counts a 29 February birth as turning 18 on 1 March", () => {
    const leapBorn = { ...bodies["record-key"], claimantDateOfBirth: "2008-02-29" };
    const onFeb28 = claimIntakeBody(() => Date.UTC(2026, 1, 28, 23, 59)).safeParse(leapBorn);
    const onMar1 = claimIntakeBody(() => Date.UTC(2026, 2, 1, 0, 0)).safeParse(leapBorn);
    expect(onFeb28.success).toBe(false);
    expect(onMar1.success).toBe(true);
  });

  it.each(["2000-02-30", "2000-13-01", "31/01/2000", "1899-12-31", "2000-1-31", ""])(
    "refuses a date that is not a real YYYY-MM-DD: %s",
    (date) => {
      expect(issuesOf({ ...bodies["record-key"], claimantDateOfBirth: date })).toEqual(["claimantDateOfBirth"]);
      expect(issuesOf({ ...bodies["keyless-start"], childDateOfBirth: date })).toEqual(["childDateOfBirth"]);
    },
  );

  it("refuses a keyless birth date after today", () => {
    expect(issuesOf({ ...bodies["keyless-start"], childDateOfBirth: "2026-09-28" })).toEqual([]);
    expect(issuesOf({ ...bodies["keyless-start"], childDateOfBirth: "2026-09-29" })).toEqual(["childDateOfBirth"]);
  });

  it("takes one to four parent names", () => {
    expect(issuesOf({ ...bodies["keyless-start"], parentNames: [] })).toEqual(["parentNames"]);
    expect(issuesOf({ ...bodies["keyless-start"], parentNames: ["A B", "C D", "E F", "G H"] })).toEqual([]);
    expect(issuesOf({ ...bodies["keyless-start"], parentNames: ["A B", "C D", "E F", "G H", "I J"] })).toEqual(["parentNames"]);
    expect(issuesOf({ ...bodies["keyless-start"], parentNames: ["A B", "x"] })).toEqual(["parentNames"]);
  });

  it("counts a name in code points, so any script gets the same room", () => {
    expect(issuesOf({ ...bodies["record-key"], claimantName: "\u{20000}".repeat(120) })).toEqual([]);
    expect(issuesOf({ ...bodies["record-key"], claimantName: "\u{20000}".repeat(121) })).toEqual(["claimantName"]);
    expect(issuesOf({ ...bodies["record-key"], claimantName: " A " })).toEqual(["claimantName"]);
  });

  it("refuses a control character in a name", () => {
    expect(issuesOf({ ...bodies["record-key"], claimantName: "Ada\u0000Example" })).toEqual(["claimantName"]);
    expect(issuesOf({ ...bodies["keyless-start"], childPlaceOfBirth: "Leeds\u007f" })).toEqual(["childPlaceOfBirth"]);
  });

  it("normalizes the contact and holds it to 254 bytes", () => {
    const parsed = schema.parse({ ...bodies["record-key"], contactEmail: "  Claimant@E2E.local " });
    expect(parsed.contactEmail).toBe("claimant@e2e.local");
    expect(issuesOf({ ...bodies["record-key"], contactEmail: "not an address" })).toEqual(["contactEmail"]);
    const domain = (last: number) => `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(last)}.invalid`;
    expect(issuesOf({ ...bodies["record-key"], contactEmail: `${"a".repeat(64)}@${domain(52)}` })).toEqual([]);
    expect(issuesOf({ ...bodies["record-key"], contactEmail: `${"a".repeat(64)}@${domain(54)}` })).toEqual(["contactEmail"]);
  });

  it("names fields and never echoes a value", () => {
    const secretName = "Zyxwvut Qponmlk";
    const issues = issuesOf({ ...bodies["record-key"], claimantName: `${secretName}\u0001`, recordKey: "secret-key-value" });
    expect(issues).toEqual(["claimantName", "recordKey"]);
    expect(JSON.stringify(issues)).not.toContain(secretName);
    expect(JSON.stringify(issues)).not.toContain("secret-key-value");
  });

  it("answers a body that is not an object with the whole-body issue", () => {
    expect(issuesOf(null)).toEqual(["body"]);
    expect(issuesOf("record-key")).toEqual(["body"]);
    expect(issuesOf([bodies["record-key"]])).toEqual(["body"]);
  });
});

describe("future-person-claim-intake-privacy-v1: the sealed intake", () => {
  it.each([
    ["record-key", RECORD_KEY],
    ["claimant-recovery-key", RECOVERY_KEY],
  ] as const)("keeps a %s only as its SHA-256", (mode, key) => {
    const sealed = sealClaimIntake(schema.parse(bodies[mode]));
    expect(sealed.mode).toBe(mode);
    expect(sealed.keyHash).toBe(crypto.createHash("sha256").update(key).digest("hex"));
    expect(sealed.identifier).toBe(key);
    expect(sealed.identityCiphertext.includes(Buffer.from(key))).toBe(false);
    expect(sealed.wrappedDataKey.includes(Buffer.from(key))).toBe(false);
  });

  it("keys a keyless start by the contact and stores no key hash", () => {
    const sealed = sealClaimIntake(schema.parse(bodies["keyless-start"]));
    expect(sealed.keyHash).toBeNull();
    expect(sealed.identifier).toBe("claimant@e2e.local");
  });

  it.each(Object.keys(bodies) as (keyof typeof bodies)[])(
    "seals the %s identity under a key made for this claim, which only the deployment key opens",
    (mode) => {
      const body = schema.parse(bodies[mode]);
      const sealed = sealClaimIntake(body);
      for (const plain of ["Ada Example", "claimant@e2e.local", "Leeds", "Parent One", "2000-01-31"]) {
        expect(sealed.identityCiphertext.includes(Buffer.from(plain))).toBe(false);
      }
      const dataKey = Buffer.from(decryptSecret(sealed.wrappedDataKey), "base64");
      expect(dataKey).toHaveLength(32);
      const identity = JSON.parse(open(dataKey, sealed.identityCiphertext)) as Record<string, unknown>;
      expect(identity.version).toBe(1);
      expect(identity.claimantName).toBe("Ada Example");
      expect(identity.contactEmail).toBe("claimant@e2e.local");
      // Exactly the reviewer's fields: never the key, the mode or the affirmation.
      expect(Object.keys(identity).sort()).toEqual(
        mode === "keyless-start"
          ? ["childDateOfBirth", "childPlaceOfBirth", "claimantName", "contactEmail", "parentNames", "version"]
          : ["claimantDateOfBirth", "claimantName", "contactEmail", "version"],
      );
      for (const key of [RECORD_KEY, RECOVERY_KEY]) expect(JSON.stringify(identity)).not.toContain(key);
      if (mode === "keyless-start") {
        expect(identity).toMatchObject({ childDateOfBirth: "2008-09-28", childPlaceOfBirth: "Leeds", parentNames: ["Parent One", "Parent Two"] });
      } else {
        expect(identity.claimantDateOfBirth).toBe("2000-01-31");
      }
    },
  );

  it("never reuses a data key", () => {
    const body = schema.parse(bodies["record-key"]);
    const first = sealClaimIntake(body);
    const second = sealClaimIntake(body);
    expect(decryptSecret(first.wrappedDataKey)).not.toBe(decryptSecret(second.wrappedDataKey));
    expect(first.identityCiphertext.equals(second.identityCiphertext)).toBe(false);
  });

  it("fits the database's size bounds", () => {
    const longest = schema.parse({
      ...bodies["keyless-start"],
      claimantName: "\u{20000}".repeat(120),
      childPlaceOfBirth: "\u{20000}".repeat(160),
      parentNames: Array.from({ length: 4 }, () => "\u{20000}".repeat(120)),
      contactEmail: `${"a".repeat(64)}@${"b".repeat(180)}.inv`,
    });
    const sealed = sealClaimIntake(longest);
    expect(sealed.identityCiphertext.length).toBeGreaterThanOrEqual(29);
    expect(sealed.identityCiphertext.length).toBeLessThanOrEqual(16384);
    expect(sealed.wrappedDataKey.length).toBeGreaterThanOrEqual(29);
    expect(sealed.wrappedDataKey.length).toBeLessThanOrEqual(256);
  });
});
