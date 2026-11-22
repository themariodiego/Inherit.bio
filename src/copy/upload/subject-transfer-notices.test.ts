import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUBJECT_TRANSFER_NOTICES } from "./subject-transfer-notices";

/**
 * The record transfer's notices as the owner approved them on 22 November
 * 2026 ("The transfer notices are approved, with one added line, and the
 * transfer is switched on", docs/protocol/decisions.md): every string as
 * listed in docs/evidence/uploader-hand-over-20261122/transfer-wording.md,
 * and one added line in the two emails to the person who now holds the
 * record, after the sentence about files and before the closing sentence. No
 * other wording changes anywhere.
 */

const LINE = "Any download copy of this record has stopped working. You can make a new one.";

/** The approved strings, verbatim from the wording file, before the added line. */
const APPROVED = {
  "subject-transfer-new-owner": {
    subject: "A DNA record is now in your Inherit account",
    heading: "This record is now yours",
    body: "You moved a DNA record that someone else added for you into your own Inherit account. The files you confirmed are now yours, and so are the results you kept. The person who added them can no longer see anything about it. If you did not do this, change your password now.",
    closing: "If you did not do this, change your password now.",
    files: "The files you confirmed are now yours, and so are the results you kept.",
  },
  "withdrawal-transfer-new-owner": {
    subject: "A DNA record is now in your Inherit account",
    heading: "This record is now yours",
    body: "The person who added your DNA file to Inherit has withdrawn their permission. The record and the files you confirmed are now in your own account. Files you had not confirmed have been deleted. They can no longer see anything about it. You do not need to do anything.",
    closing: "You do not need to do anything.",
    files: "Files you had not confirmed have been deleted.",
  },
  "subject-transfer-former-owner": {
    subject: "A DNA record you added has moved on Inherit",
    heading: "Your access to a record has ended",
    body: "The person you added a DNA file for has moved the record into their own Inherit account. You can no longer see the record, its files or anything made from them. Your conversations about it have been deleted. You do not need to do anything.",
  },
  "withdrawal-transfer-former-owner": {
    subject: "Your permission on Inherit has ended",
    heading: "Your permission has ended",
    body: "You withdrew your permission for a DNA file you added for someone else. They hold the record in their own account, so it is now theirs, with the files they confirmed. Files they had not confirmed have been deleted. You can no longer see anything about it. If you did not do this, change your password now.",
  },
  "subject-transfer-access-revoked": {
    subject: "A record shared with you on Inherit has moved",
    heading: "Your access to a record has ended",
    body: "Your access to a DNA record that was shared with you has ended. The person it is about now holds it in their own Inherit account. You can no longer see it or anything made from it. You do not need to do anything.",
  },
} as const;
const NEW_OWNER = ["subject-transfer-new-owner", "withdrawal-transfer-new-owner"] as const;

const root = path.resolve(__dirname, "../../..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [full] : [];
  });
}

describe("the transfer notices, as approved on 22 November 2026", () => {
  it("are the five kinds, each with its approved subject and heading", () => {
    expect(Object.keys(SUBJECT_TRANSFER_NOTICES).sort()).toEqual(Object.keys(APPROVED).sort());
    for (const [kind, approved] of Object.entries(APPROVED)) {
      const copy = SUBJECT_TRANSFER_NOTICES[kind as keyof typeof SUBJECT_TRANSFER_NOTICES];
      expect(copy.subject, kind).toBe(approved.subject);
      expect(copy.heading, kind).toBe(approved.heading);
    }
  });

  it.each(NEW_OWNER)("%s gains the added line once, after the sentence about files and just before its closing sentence", kind => {
    const { body } = SUBJECT_TRANSFER_NOTICES[kind];
    const approved = APPROVED[kind];
    expect(body.split(LINE).length - 1).toBe(1);
    expect(body.endsWith(` ${LINE} ${approved.closing}`)).toBe(true);
    expect(body.indexOf(approved.files)).toBeGreaterThanOrEqual(0);
    expect(body.indexOf(approved.files)).toBeLessThan(body.indexOf(LINE));
    // Without the line, the body is the approved text, word for word.
    expect(body.replace(` ${LINE}`, "")).toBe(approved.body);
  });

  it("leaves the other three kinds exactly as approved, with no added line", () => {
    for (const kind of ["subject-transfer-former-owner", "withdrawal-transfer-former-owner", "subject-transfer-access-revoked"] as const) {
      const copy = SUBJECT_TRANSFER_NOTICES[kind];
      expect(copy.body, kind).toBe(APPROVED[kind].body);
      expect(`${copy.subject} ${copy.heading} ${copy.body}`, kind).not.toContain("download");
    }
  });

  it("puts the line nowhere else: no other copy, email or page carries it", () => {
    const carriers = [...files(path.join(root, "src"))]
      .filter(file => readFileSync(file, "utf8").includes("download copy of this record"))
      .map(file => path.relative(root, file));
    expect(carriers).toEqual(["src/copy/upload/subject-transfer-notices.ts"]);
    // In that file: once in each of the two bodies (its header comment quotes it across lines).
    const source = readFileSync(path.join(root, "src/copy/upload/subject-transfer-notices.ts"), "utf8");
    expect(source.split(LINE).length - 1).toBe(2);
  });
});
