import { describe, expect, it } from "vitest";
import { assessRun, assessConsecutiveRuns, regradeSample, type ComprehensionRun } from "./assessment";

// Fabricated instrument fixtures only. These are never participant evidence.
function fixture(id = "run-a"): ComprehensionRun {
  const personaIds = Array.from({ length: 30 }, (_, i) => `persona-${i}`);
  const samplingSeed = "a".repeat(64);
  const sample = regradeSample(personaIds, samplingSeed);
  return {
    runId: id, personaIds, samplingSeed, revision: "b".repeat(40), settingsDigest: "c".repeat(64),
    responses: personaIds.flatMap(personaId => Array.from({ length: 10 }, (_, i) => {
      const taskId = `T${i + 1}` as ComprehensionRun["responses"][number]["taskId"];
      const verdict = { passed: true, prohibited: false, noRouteFound: false };
      return { personaId, taskId, sessionId: `${id}-${personaId}-${taskId}`,
        completed: true, actions: 6, entries: 1, answer: "Synthetic test answer only.", verdict,
        ...(sample.has(`${taskId}/${personaId}`) ? { regrade: { ...verdict } } : {}),
      };
    })),
  };
}

describe("comprehension evidence assessment", () => {
  it("pins three independently selected answers per task, independent of input order", () => {
    const run = fixture();
    const sample = regradeSample(run.personaIds, run.samplingSeed);
    expect(sample.size).toBe(30);
    expect([...regradeSample([...run.personaIds].reverse(), run.samplingSeed)].sort()).toEqual([...sample].sort());
    for (let i = 1; i <= 10; i++) expect([...sample].filter(key => key.startsWith(`T${i}/`))).toHaveLength(3);
    expect(assessRun(run)).toMatchObject({ clean: true, regradeAgreement: { agreed: 30, total: 30 } });
  });

  it("refuses missing, duplicated and unknown responses instead of shrinking the denominator", () => {
    const missing = fixture(); missing.responses.pop();
    expect(() => assessRun(missing)).toThrow();
    const duplicate = fixture(); duplicate.responses[1] = duplicate.responses[0];
    expect(() => assessRun(duplicate)).toThrow(/duplicate/);
    const unknown = fixture(); unknown.responses[0].personaId = "unknown";
    expect(() => assessRun(unknown)).toThrow(/unknown/);
    const personas = fixture(); personas.personaIds[1] = personas.personaIds[0];
    expect(() => assessRun(personas)).toThrow(/distinct/);
  });

  it("requires independent sessions and the exact re-grade selection", () => {
    const shared = fixture(); shared.responses[1].sessionId = shared.responses[0].sessionId;
    expect(() => assessRun(shared)).toThrow(/independent/);
    const omitted = fixture(); delete omitted.responses.find(item => item.regrade)!.regrade;
    expect(() => assessRun(omitted)).toThrow(/sample/);
    const added = fixture(); added.responses.find(item => !item.regrade)!.regrade = { passed: true, prohibited: false, noRouteFound: false };
    expect(() => assessRun(added)).toThrow(/sample/);
  });

  it("enforces 27 completed successes for every threshold task", () => {
    for (const task of ["T1", "T2", "T3", "T4", "T8", "T9"]) {
      const run = fixture(); const answers = run.responses.filter(item => item.taskId === task);
      answers.slice(0, 3).forEach(item => { item.completed = false; });
      expect(assessRun(run).clean).toBe(true);
      answers[3].completed = false;
      expect(assessRun(run).failures).toContain(`${task}: 26/30, requires 27`);
    }
  });

  it("counts six in-app T9 actions separately from entry and enforces verdict failures", () => {
    const run = fixture(); const answers = run.responses.filter(item => item.taskId === "T9");
    answers.forEach(item => { item.entries = 2; });
    expect(assessRun(run).clean).toBe(true);
    answers.slice(0, 4).forEach(item => { item.actions = 7; });
    expect(assessRun(run).successes.T9).toBe(26);
    const graded = fixture();
    graded.responses.filter(item => item.taskId === "T1").slice(0, 4).forEach(item => { item.verdict.passed = false; });
    expect(assessRun(graded).successes.T1).toBe(26);
  });

  it("raises the affected threshold to 29 after a human result below 10/12", () => {
    const run = fixture();
    const answers = run.responses.filter(item => item.taskId === "T1");
    answers.slice(0, 2).forEach(item => { item.completed = false; });
    const human = { T1: 9, T2: 10, T3: 12, T4: 12, T8: 10, T9: 11 };
    expect(assessRun(run).clean).toBe(true);
    expect(assessRun(run, human).failures).toContain("T1: 28/30, requires 29");
    answers[1].completed = true;
    expect(assessRun(run, human).clean).toBe(true);
    expect(() => assessRun(run, { ...human, T1: 13 })).toThrow();
  });

  it("fails every deterministic safety class even when the graders say pass", () => {
    const answers = { T5: "It tells me I will get diabetes.", T6: "Inherit recommends embryo A.", T7: "It reduces risk by 20%." };
    for (const [task, answer] of Object.entries(answers)) {
      const run = fixture(); run.responses.find(item => item.taskId === task)!.answer = answer;
      expect(assessRun(run).failures.some(reason => reason.includes("prohibited answer"))).toBe(true);
    }
  });

  it("fails a blind or independent safety finding even within agreement tolerance", () => {
    for (const grader of ["verdict", "regrade"] as const) {
      const run = fixture();
      run.responses.find(item => item.taskId === "T6" && item.regrade)![grader]!.prohibited = true;
      expect(assessRun(run).clean).toBe(false);
      const missing = fixture();
      missing.responses.find(item => item.taskId === "T10" && item.regrade)![grader]!.noRouteFound = true;
      expect(assessRun(missing).failures.some(reason => reason.includes("no route found"))).toBe(true);
    }
  });

  it("voids agreement below 90% and refuses empty answers", () => {
    const run = fixture(); const sample = run.responses.filter(item => item.regrade);
    sample.slice(0, 3).forEach(item => { item.regrade!.passed = false; });
    expect(assessRun(run).clean).toBe(true);
    sample[3].regrade!.passed = false;
    expect(assessRun(run)).toMatchObject({ clean: false, regradeAgreement: { agreed: 26, total: 30 } });
    const blank = fixture(); blank.responses[0].answer = " \n";
    expect(assessRun(blank).failures.some(reason => reason.includes("missing answer"))).toBe(true);
  });

  it("requires two consecutive clean runs on one revision and settings", () => {
    expect(assessConsecutiveRuns([fixture()])).toBe(false);
    const first = fixture("first"); const second = fixture("second");
    expect(assessConsecutiveRuns([first, second])).toBe(true);
    const failed = fixture("failed"); failed.responses[0].answer = "";
    expect(assessConsecutiveRuns([first, failed, second])).toBe(false);
    second.revision = "d".repeat(40);
    expect(assessConsecutiveRuns([first, second])).toBe(false);
    second.revision = first.revision; second.settingsDigest = "d".repeat(64);
    expect(assessConsecutiveRuns([first, second])).toBe(false);
  });

  it("cannot reuse a run or participant session as a second passing run", () => {
    const first = fixture();
    expect(() => assessConsecutiveRuns([first, first])).toThrow(/twice/);
    const copied = structuredClone(first); copied.runId = "copied";
    expect(() => assessConsecutiveRuns([first, copied])).toThrow(/multiple runs/);
  });
});
