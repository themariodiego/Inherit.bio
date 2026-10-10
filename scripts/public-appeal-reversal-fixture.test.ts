import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = readFileSync("supabase/tests/public_appeal_evidence_session.sql", "utf8");

describe("independent native appeal fixture document keys", () => {
  it("gives every source, uphold, reversal and information document its own 72-byte wrapped-key fixture", () => {
    const keys = [Buffer.alloc(72, 1).toString("hex"), Buffer.alloc(72, 2).toString("hex")];
    for (const [name, documents] of [["prior_appeal_uphold_probe", 3], ["reversal_genetic_source", 2],
      ["prior_appeal_reverse_probe", 3], ["appeal_information_probe", 2]] as const) {
      const start = fixture.indexOf(`create function pg_temp.${name}(`);
      expect(start).toBeGreaterThan(0);
      const body = fixture.slice(start, fixture.indexOf("end $test$;", start));
      const open = body.slice(body.indexOf("opened:=public.open_public_appeal_document_v1("));
      const argumentsSql = open.slice(0, open.indexOf(");") + 2);
      const material = [...argumentsSql.matchAll(/decode\(repeat\(lpad\(\((\d+)\+ordinal\)::text,2,'0'\),72\),'hex'\)/gu)];
      expect(material).toHaveLength(1);
      expect(argumentsSql).not.toContain("p_capture_clock_fixture");
      for (let ordinal = 1; ordinal <= documents; ordinal++) {
        const byte = String(Number(material[0][1]) + ordinal).padStart(2, "0");
        expect(byte).toMatch(/^[0-9a-f]{2}$/u);
        const key = Buffer.from(byte.repeat(72), "hex");
        expect(key).toHaveLength(72);
        keys.push(key.toString("hex"));
      }
    }
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(keys.length);
    const schema = readFileSync("supabase/migrations/20261009204626_public_appeal_evidence_session.sql", "utf8");
    expect(schema).toContain("create unique index appeal_document_independent_wrapped_key on private.appeal_document_sessions(wrapped_document_key)");
  });
});
