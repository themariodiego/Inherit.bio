import { describe, expect, it } from "vitest";
import {
  CHROMOSOMAL_SEX_VALUES,
  isChromosomalSexValue,
  readDeclaredChromosomalSex,
  xLinkedRoles,
  type DeclaredChromosomalSex,
} from "./chromosomal-sex";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const side = (dataSubjectId: string, chromosomalSex: DeclaredChromosomalSex) => ({
  dataSubjectId,
  chromosomalSex,
});

describe("the declared value (D-031)", () => {
  it("allows exactly what the column's check constraint allows", () => {
    expect([...CHROMOSOMAL_SEX_VALUES]).toEqual(["XX", "XY", "other", "unknown"]);
    for (const value of CHROMOSOMAL_SEX_VALUES) expect(isChromosomalSexValue(value)).toBe(true);
  });

  it("refuses anything else, including the words a form might send", () => {
    for (const value of ["female", "male", "xx", "XX ", "", null, undefined, 1, {}]) {
      expect(isChromosomalSexValue(value)).toBe(false);
    }
  });
});

describe("reading declarations", () => {
  const database = (rows: { subject_id: string; chromosomal_sex: string | null }[], error = false) =>
    ({
      from: () => ({
        select: () => ({
          in: (_column: string, ids: string[]) => ({
            data: error ? null : rows.filter((row) => ids.includes(row.subject_id)),
            error: error ? { message: "denied" } : null,
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  it("answers null for a subject with no row, so an absent declaration is not an unknown one", async () => {
    const declared = await readDeclaredChromosomalSex(database([{ subject_id: A, chromosomal_sex: "XX" }]), [A, B]);
    expect(declared.get(A)).toBe("XX");
    expect(declared.get(B)).toBeNull();
  });

  it("reads a value the column could not hold as no declaration rather than passing it on", async () => {
    const declared = await readDeclaredChromosomalSex(database([{ subject_id: A, chromosomal_sex: "female" }]), [A]);
    expect(declared.get(A)).toBeNull();
  });

  it("degrades a read failure to no declaration for everyone asked about", async () => {
    const declared = await readDeclaredChromosomalSex(database([], true), [A, B]);
    expect([...declared.values()]).toEqual([null, null]);
  });

  it("asks about nobody when given nobody", async () => {
    const declared = await readDeclaredChromosomalSex(database([{ subject_id: A, chromosomal_sex: "XX" }]), []);
    expect(declared.size).toBe(0);
  });
});

describe("choosing the two roles of an X-linked cross", () => {
  it("names the XX person the mother and the XY person the father, in either order", () => {
    expect(xLinkedRoles(side(A, "XX"), side(B, "XY"))).toEqual({ mother: A, father: B });
    expect(xLinkedRoles(side(A, "XY"), side(B, "XX"))).toEqual({ mother: B, father: A });
  });

  it("refuses when either person has declared nothing", () => {
    expect(xLinkedRoles(side(A, null), side(B, "XY"))).toEqual({ refusal: "sex-unknown" });
    expect(xLinkedRoles(side(A, "XX"), side(B, null))).toEqual({ refusal: "sex-unknown" });
    expect(xLinkedRoles(side(A, null), side(B, null))).toEqual({ refusal: "sex-unknown" });
  });

  it("treats a declaration of unknown as a declaration that says nothing", () => {
    expect(xLinkedRoles(side(A, "unknown"), side(B, "XY"))).toEqual({ refusal: "sex-unknown" });
  });

  it("keeps a recorded answer apart from a missing one", () => {
    // "other" is a value someone chose. The split Inherit computes is derived
    // for one XX and one XY parent, so the honest answer is that the pattern
    // is not one Inherit works out — not that nothing was recorded.
    expect(xLinkedRoles(side(A, "other"), side(B, "XY"))).toEqual({
      refusal: "sex-pattern-unsupported",
    });
    expect(xLinkedRoles(side(A, "other"), side(B, "other"))).toEqual({
      refusal: "sex-pattern-unsupported",
    });
  });

  it("refuses two people who declared the same pattern", () => {
    expect(xLinkedRoles(side(A, "XX"), side(B, "XX"))).toEqual({
      refusal: "sex-pattern-unsupported",
    });
    expect(xLinkedRoles(side(A, "XY"), side(B, "XY"))).toEqual({
      refusal: "sex-pattern-unsupported",
    });
  });
});
