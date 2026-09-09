import type { PreparedReportCallPage } from "./report-call-pages";

export const PREPARED_REPORT_MAX_ROWS = 8192;
export const PREPARED_REPORT_MAX_BYTES = 8_388_608;
export const PREPARED_REPORT_MAX_PAGES = 64;

export class PreparedReportEvidenceLimitError extends Error {
  readonly code = "selected_evidence_limit";
  constructor(readonly limit: "rows" | "bytes" | "pages") {
    super("selected_evidence_limit"); this.name = "PreparedReportEvidenceLimitError";
  }
}

/** One budget per purpose, shared across every selected-locus chunk and both
 * call streams. Pass validated projected pages BEFORE retaining their rows.
 * Bytes are the sum of UTF-8 JSON {sourceLine,call} envelopes, not a total RSS
 * estimate. Empty pages count too. No page/row references or clones are kept;
 * an over-budget page is refused whole and permanently fails this budget. */
export function createPreparedReportEvidenceBudget(): { consume(page: PreparedReportCallPage): void } {
  let rows = 0, bytes = 0, pages = 0;
  let failure: PreparedReportEvidenceLimitError | undefined;
  function refuse(limit: PreparedReportEvidenceLimitError["limit"]): never {
    failure = new PreparedReportEvidenceLimitError(limit); throw failure;
  }
  return {
    consume(page) {
      if (failure) throw failure;
      if (pages >= PREPARED_REPORT_MAX_PAGES) refuse("pages");
      const pageRows = page.variants.length + page.observations.length;
      if (pageRows > PREPARED_REPORT_MAX_ROWS - rows) refuse("rows");
      let pageBytes = 0;
      for (const stream of [page.variants, page.observations]) for (const row of stream) {
        pageBytes += Buffer.byteLength(JSON.stringify(row), "utf8");
        if (pageBytes > PREPARED_REPORT_MAX_BYTES - bytes) refuse("bytes");
      }
      // Commit counters only after the entire page fits. Never truncate a page
      // or let a later caller continue from an accepted prefix after refusal.
      pages++; rows += pageRows; bytes += pageBytes;
    },
  };
}
