import { describe, expect, it } from "vitest";
import { adultCutoff, adultOnRecord } from "./adult-on-record";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-14T00:00:00.000Z");

const database = (rows: { id: string; date_of_birth: string | null }[], error = false) =>
  ({
    from: () => ({
      select: () => ({
        in: (_column: string, ids: string[]) => ({
          data: error ? null : rows.filter((row) => ids.includes(row.id)),
          error: error ? { message: "denied" } : null,
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("the adult cutoff (D-102)", () => {
  it("is the UTC calendar date eighteen years back, matching the SQL's own arithmetic", () => {
    expect(adultCutoff(NOW)).toBe("2008-09-14");
    expect(adultCutoff(new Date("2026-01-01T23:59:59.000Z"))).toBe("2008-01-01");
    // Late UTC on the last day of a month: the date is the UTC one, never the
    // local one, because the SQL reads `timezone('UTC', clock_timestamp())`.
    expect(adultCutoff(new Date("2026-02-28T23:30:00.000Z"))).toBe("2008-02-28");
  });
});

describe("who is an adult on record", () => {
  it("counts a birthday exactly eighteen years ago as adult, and the day after as not", async () => {
    const answer = await adultOnRecord(
      database([
        { id: A, date_of_birth: "2008-09-14" },
        { id: B, date_of_birth: "2008-09-15" },
      ]),
      [A, B],
      NOW,
    );
    expect(answer.get(A)).toBe(true);
    expect(answer.get(B)).toBe(false);
  });

  it("answers false for a profile with no date and for one with no row at all", async () => {
    const answer = await adultOnRecord(database([{ id: A, date_of_birth: null }]), [A, B], NOW);
    expect(answer.get(A)).toBe(false);
    expect(answer.get(B)).toBe(false);
  });

  it("answers false for everyone asked about when the read fails", async () => {
    const answer = await adultOnRecord(database([], true), [A, B], NOW);
    expect([...answer.values()]).toEqual([false, false]);
  });

  it("collapses the database's three states to two, which is the whole point", async () => {
    // `birthDateState` in SQL is missing | adult | underage. The sentence this
    // decides must not tell a reader which of the two non-adult answers
    // applies, so the two are indistinguishable here by construction.
    const missing = await adultOnRecord(database([{ id: A, date_of_birth: null }]), [A], NOW);
    const underage = await adultOnRecord(database([{ id: A, date_of_birth: "2015-01-01" }]), [A], NOW);
    expect(missing.get(A)).toBe(underage.get(A));
  });

  it("asks about nobody when given nobody", async () => {
    expect((await adultOnRecord(database([{ id: A, date_of_birth: "1990-01-01" }]), [], NOW)).size).toBe(0);
  });
});
