import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `docs/acceptance-matrix.md` is the completion measure this project is judged
 * by, and its opening sentence states the count. Nothing recomputed that
 * sentence until 2026-09-21, and by then it had drifted twice: it claimed
 * 30/65 with 35 NO while the column held 38 and 27, having already been
 * corrected once for the same reason. A headline that is maintained by hand
 * records what someone last remembered, not what the table says.
 *
 * So this file recomputes both numbers from the verdict column and compares
 * them with the sentence, in both directions. A headline that leads the table
 * fails, and one that lags it fails too. Every assertion is proved against a
 * planted defect rather than trusted, because a parser that silently matches
 * nothing would pass a file it never read.
 */

const MATRIX = "docs/acceptance-matrix.md";
const document = readFileSync(path.join(process.cwd(), MATRIX), "utf8");

/** The G-rows, which are the only rows the count is taken over. */
const GATE_ROW = /^\| (G\S+) \| [^|]* \| (\w+) \|/gm;

interface Counted {
  total: number;
  yes: number;
  no: number;
  other: { id: string; verdict: string }[];
}

function countVerdicts(markdown: string): Counted {
  const counted: Counted = { total: 0, yes: 0, no: 0, other: [] };
  for (const match of markdown.matchAll(GATE_ROW)) {
    const [, id, verdict] = match;
    counted.total += 1;
    if (verdict === "YES") counted.yes += 1;
    else if (verdict === "NO") counted.no += 1;
    else counted.other.push({ id, verdict });
  }
  return counted;
}

/** The two numbers the opening sentence states, or null when it does not. */
function headlineClaim(markdown: string): { verified: number; outOf: number; stillNo: number } | null {
  const claim = /\*\*(\d+)\/(\d+)\s*\n?verified\*\*, with (\d+) still NO/.exec(markdown);
  if (!claim) return null;
  return { verified: Number(claim[1]), outOf: Number(claim[2]), stillNo: Number(claim[3]) };
}

describe("the acceptance matrix headline and its own column agree", () => {
  it("finds the gate rows at all, so a silent no-match cannot pass", () => {
    const counted = countVerdicts(document);
    expect(counted.total).toBeGreaterThan(60);
    // Planted: a file with no table must not read as a clean count.
    expect(countVerdicts("# Acceptance matrix\n\nNo table here.\n").total).toBe(0);
  });

  it("records exactly one verdict per gate row, and only YES or NO", () => {
    const counted = countVerdicts(document);
    expect(counted.other).toEqual([]);
    expect(counted.yes + counted.no).toBe(counted.total);
    // Planted: a third verdict value is a finding, not a row to skip.
    const planted = countVerdicts("| G9.9 | Something. | PARTIAL | evidence |\n");
    expect(planted.other).toEqual([{ id: "G9.9", verdict: "PARTIAL" }]);
  });

  it("states a headline count that can be read", () => {
    expect(headlineClaim(document)).not.toBeNull();
    // Planted: a headline that stops stating the count fails rather than
    // quietly removing the check along with the sentence.
    expect(headlineClaim("The ledger below is the completion measure.")).toBeNull();
  });

  it("matches the headline to the column, and fails in both directions", () => {
    const counted = countVerdicts(document);
    const claim = headlineClaim(document);
    expect(claim).not.toBeNull();
    expect({ verified: claim!.verified, outOf: claim!.outOf, stillNo: claim!.stillNo })
      .toEqual({ verified: counted.yes, outOf: counted.total, stillNo: counted.no });

    // Planted, the drift that made this file necessary: a headline behind the
    // table, and one ahead of it. Both are the same defect and both must fail.
    const table = "| G1.1 | A. | YES | e |\n| G1.2 | B. | NO | e |\n";
    for (const stale of ["**0/2\nverified**, with 2 still NO", "**2/2\nverified**, with 0 still NO"]) {
      const lagging = countVerdicts(table);
      const claimed = headlineClaim(`${stale}\n\n${table}`);
      expect(claimed).not.toBeNull();
      expect(claimed!.verified === lagging.yes && claimed!.stillNo === lagging.no).toBe(false);
    }
  });

  it("keeps the denominator the 65 G-rows the goal is measured over", () => {
    expect(countVerdicts(document).total).toBe(65);
  });
});
