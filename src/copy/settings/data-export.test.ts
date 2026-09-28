import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DATA_EXPORT_BODY,
  DATA_EXPORT_BUTTON,
  DATA_EXPORT_HEADING,
  DATA_EXPORT_LEGAL_AUDIT,
  EXPORT_CHATS_EMPTY,
  EXPORT_LEGAL_AUDIT_DESCRIPTION,
  exportLegalAuditNote,
} from "./data-export";

/**
 * F4, 26 Sep 2026: `/settings/data` promised legal audit records, and a real
 * production export had none. The sentence is a promise about the archive's
 * scope, so each class it names is held against a member the export route
 * writes, and the one it cannot carry yet is named as missing.
 */
const route = readFileSync("src/app/api/export/route.ts", "utf8");
const page = readFileSync("src/app/(app)/settings/data/page.tsx", "utf8");

describe("the export's own description of what it holds", () => {
  it("names only classes the archive writes", () => {
    const promised: [claim: string, member: string][] = [
      ["your uploads", "originals/"],
      ["the DNA variants we found", "variants/"],
      ["your results", '"reports.json"'],
      ["your saved chats", '"chats.json"'],
      ["your consent and permission records", '"subject-record.json"'],
      ["your birth date", '"subject-record.json"'],
      ["the country you chose", '"subject-record.json"'],
    ];
    for (const [claim, member] of promised) {
      expect(DATA_EXPORT_BODY, claim).toContain(claim);
      expect(route, `${claim} is written as ${member}`).toContain(member);
    }
  });

  /**
   * 28 Sep 2026: the archive gained `legal-audit.json`, so the sentence that
   * said legal audit records were missing went in the same change, as this
   * test required. What replaces it promises only the person's own actions and
   * says that records not naming who acted are left out - which today is
   * every record, so the file is empty and must say why.
   */
  it("says the legal audit file holds only what the person did, and that the archive writes it", () => {
    expect(DATA_EXPORT_BODY.toLowerCase()).not.toContain("audit");
    expect(DATA_EXPORT_LEGAL_AUDIT)
      .toBe("It has a legal audit file of what you did yourself. Records that don't say who acted are left out.");
    expect(route).toContain('"legal-audit.json"');
    expect(EXPORT_LEGAL_AUDIT_DESCRIPTION).toContain("what you did yourself");
    expect(EXPORT_LEGAL_AUDIT_DESCRIPTION).toContain("do not say who acted are left out");
    // The file's own note names the day attribution began, says what is left
    // out, and says an empty list is not "nothing happened".
    const note = exportLegalAuditNote("28 September 2026");
    expect(note).toContain("since 28 September 2026");
    expect(note).toContain("Records from before then do not say who acted");
    expect(note).toContain("Records of what other people or the service did are left out");
    expect(note).toContain("not because nothing happened");
  });

  it("is the copy the page renders, with nothing written inline beside it", () => {
    for (const name of ["DATA_EXPORT_HEADING", "DATA_EXPORT_BODY", "DATA_EXPORT_LEGAL_AUDIT", "DATA_EXPORT_BUTTON"]) {
      expect(page, name).toContain(`{${name}}`);
    }
    expect(page).not.toContain("legal audit records, and saved chats");
    expect([DATA_EXPORT_HEADING, DATA_EXPORT_BUTTON]).toEqual(["Export everything", "Download export"]);
  });

  it("says the chat history is empty rather than that nothing is stored", () => {
    expect(EXPORT_CHATS_EMPTY).toBe("Your chat history has no saved Copilot conversations.");
    expect(EXPORT_CHATS_EMPTY).not.toMatch(/not stored|server-side/);
  });
});
