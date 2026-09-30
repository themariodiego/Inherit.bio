import { describe, expect, it } from "vitest";
import bindings from "./bindings.json";
import { routeMatcher, taskCompleted, type BoundTask } from "./completion";

const task = (id: string) => bindings.tasks.find(candidate => candidate.id === id) as unknown as BoundTask;

describe("mechanical task completion from bound surfaces", () => {
  it("matches bound routes segment by segment and restricts report slugs to the bound set", () => {
    expect(routeMatcher("/genome/[subject]/ancestry").test("/genome/me/ancestry")).toBe(true);
    expect(routeMatcher("/genome/[subject]/ancestry").test("/genome/me/ancestry/extra")).toBe(false);
    const reports = routeMatcher("/genome/[subject]/reports/[slug]", task("T1").templateSlugs);
    expect(reports.test("/genome/me/reports/type-2-diabetes-tcf7l2-rs7903146")).toBe(true);
    expect(reports.test("/genome/me/reports/caffeine-metabolism-cyp1a2")).toBe(false);
    expect(() => routeMatcher("/a/(b)")).toThrow("Unsupported");
  });

  it("completes T1 and T3 only on one of their own bound reports", () => {
    const t1 = task("T1"), t3 = task("T3");
    expect(taskCompleted(t1, { paths: ["/overview", "/genome/me/reports"] })).toBe(false);
    expect(taskCompleted(t1, { paths: ["/overview", "/genome/me/reports/type-2-diabetes-pparg-pro12ala"] })).toBe(true);
    expect(taskCompleted(t3, { paths: ["/genome/me/reports/type-2-diabetes-pparg-pro12ala"] })).toBe(false);
    expect(taskCompleted(t3, { paths: ["/genome/me/reports/vkorc1-rs9923231-one-position"] })).toBe(true);
  });

  it("does not count the entry page as reaching a bound surface", () => {
    expect(taskCompleted(task("T2"), { paths: ["/overview"] })).toBe(false);
    expect(taskCompleted(task("T2"), { paths: ["/overview", "/genome/me/ancestry"] })).toBe(true);
    expect(taskCompleted(task("T4"), { paths: ["/overview", "/family/invite"] })).toBe(true);
  });

  it("requires T8's deletion to exist in the database, whatever the path", () => {
    expect(taskCompleted(task("T8"), { paths: ["/settings/data"] })).toBe(false);
    expect(taskCompleted(task("T8"), { paths: ["/settings/data"], accountDeletionScheduled: false })).toBe(false);
    expect(taskCompleted(task("T8"), { paths: ["/overview"], accountDeletionScheduled: true })).toBe(true);
  });

  it("completes T9 at the review offering withdrawal, never from the mailed link alone or with an account", () => {
    const t9 = task("T9");
    expect(taskCompleted(t9, { paths: ["/", "/legal/appeals", "/withdraw/request"], accountCreated: false })).toBe(false);
    expect(taskCompleted(t9, { paths: ["/", "/legal/appeals", "/withdraw/request", "/withdraw/session"], accountCreated: false })).toBe(true);
    expect(taskCompleted(t9, { paths: ["/", "/legal/appeals", "/withdraw/session"], accountCreated: true })).toBe(false);
    expect(taskCompleted(t9, { paths: ["/", "/legal/appeals", "/withdraw/session"] })).toBe(false);
  });

  it("completes T10 on either public future-person surface without an account", () => {
    const t10 = task("T10");
    expect(taskCompleted(t10, { paths: ["/"], accountCreated: false })).toBe(false);
    expect(taskCompleted(t10, { paths: ["/", "/legal/future-person"], accountCreated: false })).toBe(true);
    expect(taskCompleted(t10, { paths: ["/", "/future-person/claim"], accountCreated: true })).toBe(false);
  });
});
