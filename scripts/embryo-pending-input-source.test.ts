import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const text = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
describe("pending embryo input source boundaries", () => {
  it("keeps the service-only native reader atomic, read-only and inclusive of unlanded work", () => {
    const sql = text("supabase/migrations/20261011010251_embryo_pending_input_read.sql");
    expect(sql).toContain("stable security invoker");
    expect(sql).toContain("current_user is distinct from 'service_role'");
    expect(sql).toContain("auth.jwt()->>'role' is distinct from 'service_role'");
    for (const relation of ["embryo_cohorts", "embryos", "subjects", "embryo_participant_sets", "subject_principals",
      "embryo_ingest_sessions", "genome_files", "worker_jobs", "embryo_qc", "embryo_ingest_chunks", "embryo_ingest_fragments"])
      expect(sql).toContain(`public.${relation}`);
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|for update|for share)\b/iu);
    expect(sql).not.toContain("source_publication_state='published'");
    expect(sql).toContain("grant execute on function public.read_pending_embryo_input_v1(uuid,uuid,uuid) to service_role");
  });
  it("retains actor/foreign selection and full co-parent jurisdiction before metadata; derived reads stay behind state gates", () => {
    const page = text("src/app/(app)/embryos/[embryoId]/page.tsx");
    expect(page.indexOf("if (!context.found) notFound();")).toBeLessThan(page.indexOf("const cohortDecision"));
    expect(page).toContain('if (permits(cohortDecision) && cohort.status === "upload_pending" && embryo.status === "pending")');
    expect(page.indexOf("const cohortDecision")).toBeLessThan(page.indexOf("pendingInput = await readPendingEmbryoInput"));
    expect(page.indexOf('case "complete":')).toBeLessThan(page.indexOf("savedCoverage = await loadSavedCarrierLibraryCoverage"));
    expect(page).toContain("if (pendingInputReadFailed)");
    expect(page).toContain("{READ_FAILED_SENTENCE}");
  });
  it("places the optional real finalized callback before file selection while preserving original worker/publication checks", () => {
    const source = text("e2e/participant-c-journey.ts");
    expect(source.indexOf("await options.beforeFile")).toBeGreaterThan(source.indexOf("await signStatements(page, FINALIZE_BUTTON, owner)"));
    expect(source.indexOf("await options.beforeFile")).toBeLessThan(source.indexOf(".setInputFiles(path.resolve(fixture))"));
    expect(source).toContain('expect(reserved.data!.map(row => row.status)).toEqual(["pending", "pending"])');
    expect(source).toContain('finalize: "^/api/embryo-cohorts$"');
    expect(source).toContain("const parsed = readUploadReceipt(body)");
    expect(source).toContain("expect(actualFinalization.cohortId).toBe(finalizedCohort.data.id)");
    expect(source).toContain("await runtime.runWorker(cohortId)");
    expect(source).toContain("allPartsCurrent: true, pendingOrdinals: 0, pendingVariants: 0");
  });
  it("captures only a genuine empty page without changing QC/result/state, with exact whole bag before and after", () => {
    const provider = text("e2e/density-embryo-empty-state-fixtures.ts");
    expect(provider).toContain("await withEmbryoJourney(input.environment");
    expect(provider).toContain("await seedParticipantC(");
    expect(provider).toContain("await scope.ownerPage.context().newPage()");
    expect(provider).toContain('toHaveAttribute("data-state", "empty")');
    expect(provider).toContain("expect(await pendingBag(scope.cohortId)).toBe(before)");
    expect(provider).not.toMatch(/\.(insert|update|upsert)\(|setContent\(|route\.fulfill/u);
    expect(provider).toContain("finally { await readPage.close(); }");
    expect(provider).toContain("finally { await journey.closeCoParent(); }");
  });
});
