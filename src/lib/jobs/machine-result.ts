import "server-only";

/**
 * The one success body every machine job endpoint returns.
 *
 * `docs/route-register.json#responseContracts.machine-job-result-v1` binds
 * seven routes — `jobs.run`, `jobs.annotation-refresh`,
 * `jobs.research-publish`, `jobs.research-refresh`, `jobs.retention`,
 * `jobs.retention-cron` and `jobs.mail` — to `{status:"complete", outcome}`
 * with `unknownFields: "forbidden"`, and it names what may never leave:
 *
 *   targetJobRowObjectRecipientDocumentTemplateSubjectCohortFileAccount
 *   ErrorFreeTextOrPrivateCounts: "never-returned"
 *
 * D-086 recorded one route breaking that rule. Six were. The mail and
 * retention drains returned `processed`, `failed` and `pending` — a count of
 * how many people are queued for mail, readable by anything holding the
 * shared jobs secret; annotation-refresh returned batch sizes and a free-text
 * note; research-publish returned the template slug it had just published;
 * research-refresh returned each source's outcome object and, on failure, the
 * raw `Error.message`, which is exactly the "error free text" the contract
 * forbids.
 *
 * So the shape lives here rather than at six call sites. A job says whether
 * it ran, and whether anything failed while it ran. It does not say what it
 * touched, for whom, or how much of it there was.
 *
 * The counters are NOT deleted from the routes — they still drive control
 * flow and the outcome below, and the unit suites still assert them, but they
 * are asserted where they are true (the calls the drain actually made) rather
 * than read back out of an HTTP body that must not carry them.
 */

/** The register's three outcomes, in the order it lists them. */
export type JobOutcome = "no_work" | "completed" | "completed_with_failures";

/**
 * `private-no-store-no-referrer`, the contract's header line. A job result is
 * not user data, so this is not the `authenticatedUserData` profile; it is
 * the narrower set the contract names, plus the anti-sniffing and anti-framing
 * headers every response in this codebase carries.
 */
export const MACHINE_JOB_RESULT_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};

/**
 * The outcome for a drain that completed `done` units of work and failed
 * `failed` of them.
 *
 * `no_work` means nothing was due — the distinction the register draws, and
 * the only one a caller needs: an empty queue is not an error, and a cron
 * monitor watching for `completed_with_failures` should not fire on it.
 * A run with any failure reports `completed_with_failures` whether or not
 * anything else succeeded, because a partial drain that lost a row is not a
 * clean run.
 */
export function jobOutcome(work: { done: number; failed: number }): JobOutcome {
  if (work.failed > 0) return "completed_with_failures";
  return work.done > 0 ? "completed" : "no_work";
}

/** The contract body, with the contract's headers. Never takes a count. */
export function machineJobResult(outcome: JobOutcome): Response {
  return Response.json(
    { status: "complete", outcome },
    { headers: { ...MACHINE_JOB_RESULT_HEADERS } },
  );
}

/** `machineJobResult(jobOutcome(work))`, the form every drain uses. */
export function machineJobDrained(work: { done: number; failed: number }): Response {
  return machineJobResult(jobOutcome(work));
}
