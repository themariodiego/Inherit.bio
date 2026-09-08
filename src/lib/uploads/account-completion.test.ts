import { describe, expect, it } from "vitest";
import { accountCompletionBody, isAdultOnUtcDate } from "./account-completion";

const today = new Date("2026-09-06T00:00:00.000Z");
describe("initial adult account declaration", () => {
  it.each([
    ["2008-09-06", true], ["2008-09-07", false], ["2008-09-05", true],
    ["1990-01-01", true], ["2027-01-01", false], ["2026-09-06", false],
    ["2000-02-29", true], ["2001-02-29", false], ["2000-04-31", false],
    ["2000-00-01", false], ["2000-13-01", false], ["2000-01-00", false],
    ["2000-1-01", false], ["01/01/2000", false], ["", false],
    ["2000-01-01T00:00:00Z", false],
  ])("validates %s as an exact calendar date and completed age", (date, adult) => {
    expect(isAdultOnUtcDate(date, today)).toBe(adult);
  });
  it("uses the UTC date instead of the browser timezone", () => {
    expect(isAdultOnUtcDate("2008-09-06", new Date("2026-09-05T23:30:00-01:00"))).toBe(true);
    expect(isAdultOnUtcDate("2008-09-06", new Date("2026-09-06T00:30:00+01:00"))).toBe(false);
    expect(isAdultOnUtcDate("1990-01-01", new Date("invalid"))).toBe(false);
  });
  it("does not advance a leap-day birthday before March in a non-leap year", () => {
    expect(isAdultOnUtcDate("2008-02-29", new Date("2026-02-28T23:59:59Z"))).toBe(false);
    expect(isAdultOnUtcDate("2008-02-29", new Date("2026-03-01T00:00:00Z"))).toBe(true);
  });
  it("accepts only the birth date and presentation, never authority or consent overrides", () => {
    const body = { dateOfBirth: "1990-01-01", presentationToken: "x".repeat(100) };
    expect(accountCompletionBody.safeParse(body).success).toBe(true);
    for (const key of ["accountId", "subjectId", "age", "isAdult", "jurisdiction", "consent", "grants"]) {
      expect(accountCompletionBody.safeParse({ ...body, [key]: true }).success).toBe(false);
    }
    expect(accountCompletionBody.safeParse({ dateOfBirth: body.dateOfBirth }).success).toBe(false);
  });
});
