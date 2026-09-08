/** Independent of process execution so a zero/skip/retry JSON report cannot
 * accidentally turn a failed or narrowed browser run into the standard gate. */
type Result = { retry?: number; status?: string };
type Test = { results?: Result[] };
type Spec = { tests?: Test[] };
type Suite = { specs?: Spec[]; suites?: Suite[] };
export type E2EReport = { suites?: Suite[] };

export function verifyE2EReport(report: E2EReport): number {
  const results: Result[] = [];
  const collect = (suites: Suite[]) => {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) results.push(...(test.results ?? []));
      }
      collect(suite.suites ?? []);
    }
  };
  collect(report.suites ?? []);
  const skipped = results.filter(result => result.status === "skipped").length;
  const retried = results.filter(result => (result.retry ?? 0) > 0).length;
  const nonPassing = results.filter(result => result.status !== "passed").length;
  if (!results.length || skipped || retried || nonPassing) {
    throw new Error(`E2E contract failed: ${results.length} result(s), ${skipped} skipped, ${retried} retried, ${nonPassing} non-passing.`);
  }
  return results.length;
}
