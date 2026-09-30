import assert from "node:assert/strict";

export const EMBRYO_BROWSER_JOURNEYS = Object.freeze({
  "embryo-ingest": "embryo-ingest-journey.spec.ts",
  "embryo-mixed-qc": "embryo-mixed-qc-journey.spec.ts",
});
type FileCases = { project: string; file: string; cases: number };

/** Both real journeys need an empty split queue. Native partitions must put
 * them in separate fresh jobs; this never changes native case assignment. */
export function assertEmbryoJourneyPartition(rows: readonly FileCases[], full: boolean): void {
  const projects = Object.keys(EMBRYO_BROWSER_JOURNEYS);
  const files: string[] = Object.values(EMBRYO_BROWSER_JOURNEYS);
  const journeys = rows.filter(row => projects.includes(row.project) || files.includes(row.file));
  for (const row of journeys) {
    assert(EMBRYO_BROWSER_JOURNEYS[row.project as keyof typeof EMBRYO_BROWSER_JOURNEYS] === row.file
      && row.cases === 1, "Each embryo project requires its exact single real journey");
  }
  assert((full ? journeys.length === 2 : journeys.length <= 1),
    "Each fresh native partition permits at most one embryo journey");
  if (full) assert.deepEqual(journeys.map(row => row.project).sort(), projects.sort(),
    "Both real embryo journeys must be inventoried and executed");
}

export function assertEmbryoCiShard(shard: number | null, env: Readonly<Record<string, string | undefined>>): void {
  assert(env.CI !== "true" || shard !== null,
    "The two embryo journeys require separate fresh native CI partitions; unsharded CI is unsupported");
}
