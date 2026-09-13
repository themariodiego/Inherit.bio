import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jobOutcome, machineJobDrained, machineJobResult, MACHINE_JOB_RESULT_HEADERS } from "./machine-result";

const CONTRACT = "machine-job-result-v1";
const register = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "docs/route-register.json"), "utf8"),
) as {
  routes: { id: string; path: string; successResponseContract?: string }[];
  responseContracts: Record<string, { body?: Record<string, { const?: string; enum?: string[] }> }>;
};

const bound = register.routes.filter((route) => route.successResponseContract === CONTRACT);

/**
 * D-100, closed 2026-09-13: this held one exception, `jobs.run`, which the
 * register carried as `disposition: "kept"` while `/api/jobs/run` did not
 * exist. The operator retired the route rather than build it, and corrections
 * item 12 corrected the brief that described it, so the exception has nothing
 * left to exempt and the sweep now covers every bound route with no carve-out.
 * A route appearing here without a file means one was deleted without the
 * register being told.
 */

function routeFile(routePath: string): string {
  return path.join(process.cwd(), "src/app", routePath, "route.ts");
}

/** The arguments of the `open`-th call, by counting brackets from its paren. */
function callArguments(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "(") depth++;
    else if (source[index] === ")") {
      depth--;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error("unbalanced call");
}

describe("machine-job-result-v1", () => {
  it("returns the register's exact body, with nothing added", async () => {
    const contract = register.responseContracts[CONTRACT];
    expect(contract.body?.status?.const).toBe("complete");
    for (const outcome of contract.body?.outcome?.enum ?? []) {
      const response = machineJobResult(outcome as "no_work");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "complete", outcome });
    }
    // `unknownFields: "forbidden"` is only true if the body has exactly two.
    expect(Object.keys(await machineJobResult("completed").json())).toEqual(["status", "outcome"]);
  });

  it("says nothing was due, something ran, or something failed", () => {
    expect(jobOutcome({ done: 0, failed: 0 })).toBe("no_work");
    expect(jobOutcome({ done: 3, failed: 0 })).toBe("completed");
    expect(jobOutcome({ done: 0, failed: 1 })).toBe("completed_with_failures");
    // A partial drain that lost a row is not a clean run, however much of the
    // rest of it succeeded.
    expect(jobOutcome({ done: 24, failed: 1 })).toBe("completed_with_failures");
  });

  it("carries the contract's private-no-store-no-referrer headers", () => {
    const response = machineJobDrained({ done: 1, failed: 0 });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    for (const [name, value] of Object.entries(MACHINE_JOB_RESULT_HEADERS)) {
      expect(response.headers.get(name), name).toBe(value);
    }
  });

  // Six, not seven: `jobs.run` was retired from the register on 2026-09-13
  // (D-100, and corrections item 12 for the brief that described it). Every
  // route named here now has a file, which is what let the sweep below drop
  // its one exemption.
  it("binds the six job routes the register lists, or this sweep is vacuous", () => {
    expect(bound.map((route) => route.id).sort()).toEqual([
      "jobs.annotation-refresh",
      "jobs.mail",
      "jobs.research-publish",
      "jobs.research-refresh",
      "jobs.retention",
      "jobs.retention-cron",
    ]);
  });

  /**
   * D-086 was filed against one route. Six of the seven were returning job
   * internals: `processed`/`failed`/`pending` from the mail and retention
   * drains, batch sizes and a free-text note from annotation-refresh, the
   * published template's slug and its subscriber count from research-publish,
   * and per-source outcome objects with raw `Error.message` text from
   * research-refresh. A helper alone would not have kept them in line, so
   * this reads the files: under these routes a 2xx JSON body may only come
   * from `machine-job-result.ts`, and any other response must be an error.
   */
  it("lets no job route write its own success body", () => {
    const offences: string[] = [];
    for (const route of bound) {
      const file = routeFile(route.path);
      if (!fs.existsSync(file)) {
        offences.push(`${route.id}: no route file at ${path.relative(process.cwd(), file)}`);
        continue;
      }
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:NextResponse\.json|Response\.json|new Response)\(/g)) {
        const open = match.index! + match[0].length - 1;
        const args = callArguments(source, open);
        if (/status:\s*[45]\d\d/.test(args)) continue;
        offences.push(
          `${route.id}: a non-error response is built in the route — ${match[0]}${args.slice(0, 60)}…`,
        );
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("has every job route import the helper", () => {
    for (const route of bound) {
      const file = routeFile(route.path);
      const source = fs.readFileSync(file, "utf8");
      // The cron adapter returns the retention route's own response verbatim,
      // so it inherits the contract instead of building a body.
      if (route.id === "jobs.retention-cron") {
        expect(source, route.id).toContain("@/app/api/jobs/retention/route");
        continue;
      }
      expect(source, route.id).toContain("@/lib/jobs/machine-result");
    }
  });
});
