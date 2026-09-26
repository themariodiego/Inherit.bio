import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DATA_EXPORT_BODY,
  DATA_EXPORT_BUTTON,
  DATA_EXPORT_HEADING,
  DATA_EXPORT_NOT_YET_INCLUDED,
  EXPORT_CHATS_EMPTY,
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

  it("says plainly that legal audit records are not included, and never claims them", () => {
    expect(DATA_EXPORT_BODY.toLowerCase()).not.toContain("audit");
    expect(DATA_EXPORT_NOT_YET_INCLUDED).toBe("Legal audit records are not in it yet.");
    // If the archive gains them, this sentence has to go in the same change.
    expect(route).not.toMatch(/legal[-_]audit/);
  });

  it("is the copy the page renders, with nothing written inline beside it", () => {
    for (const name of ["DATA_EXPORT_HEADING", "DATA_EXPORT_BODY", "DATA_EXPORT_NOT_YET_INCLUDED", "DATA_EXPORT_BUTTON"]) {
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
