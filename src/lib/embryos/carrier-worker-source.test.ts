import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QC_THRESHOLDS } from "./qc-policy";

const sql = readFileSync("supabase/migrations/20261002132000_embryo_observed_carrier_producer.sql", "utf8");
describe("the reviewed carrier producer's generated policy adapters", () => {
  it("pins the complete existing QC authority and generates its constants without a second policy", () => {
    const source = readFileSync("src/lib/embryos/qc-policy.ts", "utf8");
    const pin = sql.match(/qc-policy-source-sha256: ([0-9a-f]{64})/)?.[1];
    expect(pin).toBe(createHash("sha256").update(source).digest("hex"));
    const generated = sql.match(/\$qc_policy\$\n select '([^']+)'::jsonb;/)?.[1];
    expect(JSON.parse(generated!)).toEqual(QC_THRESHOLDS);
  });
  it("embeds the exact committed empty registry rather than activating a synthetic condition", () => {
    const generated = sql.match(/\$compiled_registry\$([\s\S]+?)\$compiled_registry\$/)?.[1];
    expect(JSON.parse(generated!)).toEqual(JSON.parse(readFileSync("data/embryo/allowed_conditions.json", "utf8")));
    expect(JSON.parse(generated!).conditions).toEqual([]);
  });
  it("preserves the complete generic claimant except for excluding the operation-specific embryo queue", () => {
    const prior = readFileSync("supabase/migrations/20260930231000_path_b_normalization.sql", "utf8")
      .split("create or replace function private.claim_worker_job_v2", 2)[1]
      .split("as $$", 2)[1].split("$$;", 1)[0];
    const next = sql.split("as $generic$", 2)[1].split("$generic$;", 1)[0]
      .replace("  and w.kind<>'score_embryo'\n", "");
    expect(next).toBe(prior);
  });
});
