import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = readFileSync("supabase/tests/public_appeal_evidence_session.sql", "utf8");

describe("independent native appeal fixture document keys", () => {
  it("restores a complete live reversal control before waiting within the fixed immutable deadline", () => {
    const start = fixture.indexOf("create function pg_temp.appeal_reversal_clock_fixture(");
    const end = fixture.indexOf("create temporary table appeal_reversal_clock_result", start);
    const clocks = fixture.slice(start, end);
    expect(clocks).toContain("date_trunc('milliseconds',clock_timestamp())+interval '10 seconds'");
    expect(clocks).not.toContain("interval '31 days'");
    expect(clocks).not.toMatch(/disable\s+trigger|session_replication_role|update\s+private\.new_public_appeal_intakes/iu);
    const current = clocks.indexOf("private.public_appeal_reversal_binding_v1(v_case) is distinct from binding");
    const bound = clocks.indexOf("wait_seconds<=0 or wait_seconds>10");
    const wait = clocks.indexOf("perform pg_sleep(wait_seconds)");
    const elapsed = clocks.indexOf("clock_timestamp()<deadline_at");
    const refusal = clocks.indexOf("expired complete original case admitted correction");
    expect(current).toBeGreaterThan(0);
    expect(bound).toBeGreaterThan(current);
    expect(wait).toBeGreaterThan(bound);
    expect(elapsed).toBeGreaterThan(wait);
    expect(refusal).toBeGreaterThan(elapsed);
    expect(clocks).toContain("pg_temp.appeal_reversal_clock_graph(v_case) is distinct from expected");
    expect(clocks).toContain("expired refusal changed a complete case row or outcome/nonce");
    expect(clocks).toContain("clock probe changed original decision or target bags");
  });

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
