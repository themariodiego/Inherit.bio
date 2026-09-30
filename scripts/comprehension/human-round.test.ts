import { describe, expect, it } from "vitest";
import bindings from "./bindings.json";
import { blankRound, facilitatorSheet, protocolQuote, roundSchema, tallyRound, type Round } from "./human-round";

// Fabricated instrument fixtures only. None of these is a human result, and
// nothing here writes docs/comprehension-results-<date>.md.
function round(): Round {
  const value = blankRound();
  value.roundFinished = "2026-09-28";
  for (const session of value.sessions) {
    session.eligibility = { noGeneticsOrMedicalTraining: true, noPriorConsumerGenomics: true, noProjectConnection: true };
    session.consentSigned = true;
    for (const answer of session.answers) {
      answer.completed = true; answer.answer = "Synthetic instrument answer."; answer.actions = 3;
      answer.grade = { passed: true, prohibited: false, noRouteFound: false };
    }
  }
  return value;
}
const answer = (value: Round, participant: number, taskId: string) =>
  value.sessions[participant].answers.find(item => item.taskId === taskId)!;

describe("the human round kit", () => {
  it("reads the opening, closing and every prompt verbatim from the committed protocol and bindings", () => {
    const sheet = facilitatorSheet("P03");
    expect(sheet).toContain(protocolQuote("Opening, read once, verbatim"));
    expect(sheet).toContain(protocolQuote("Closing"));
    expect(protocolQuote("Opening, read once, verbatim")).toMatch(/^Thank you for doing this\./);
    for (const task of bindings.tasks) expect(sheet).toContain(`Read verbatim: "${task.prompt}"`);
    expect(sheet).toContain("- In-app click and submit actions (ceiling 6):");
    const withheld = facilitatorSheet("P03", true);
    expect(withheld).toContain(`Read verbatim: "${bindings.tasks.find(task => task.id === "T6")!.withheldVariant!.prompt}"`);
    expect(() => facilitatorSheet("P13")).toThrow();
  });

  it("starts from a blank template that no tally will accept as a result", () => {
    const blank = blankRound();
    expect(roundSchema.parse(blank).sessions).toHaveLength(12);
    expect(blank.sessions.every(session => session.answers.every(item => item.answer === "" && item.grade === null))).toBe(true);
    expect(() => tallyRound(blank)).toThrow(/not eligible/);
  });

  it("applies each task's threshold, the T9 ceiling and the adjustment rule", () => {
    const value = round();
    expect(tallyRound(value)).toMatchObject({ met: true, raisedSimulatedThresholds: [] });
    answer(value, 0, "T1").grade!.passed = false; answer(value, 1, "T1").completed = false;
    expect(tallyRound(value).tasks.find(task => task.taskId === "T1")).toMatchObject({ successes: 10, met: true });
    answer(value, 2, "T1").answer = "";
    const lower = tallyRound(value);
    expect(lower.tasks.find(task => task.taskId === "T1")).toMatchObject({ successes: 9, met: false });
    expect(lower.raisedSimulatedThresholds).toEqual(["T1: 29/30"]);
    expect(lower.humanSuccesses.T1).toBe(9);
    const t9 = round();
    answer(t9, 0, "T9").actions = 7; answer(t9, 1, "T9").accountCreated = true; answer(t9, 2, "T9").actions = 6;
    expect(tallyRound(t9).tasks.find(task => task.taskId === "T9")).toMatchObject({ successes: 10, met: true });
  });

  it("fails a safety probe on either detection path and T10 on any no-route answer", () => {
    const value = round();
    answer(value, 4, "T5").answer = "It says I am safe.";
    const tally = tallyRound(value);
    expect(tally.tasks.find(task => task.taskId === "T5")).toMatchObject({ prohibited: 1, met: false });
    expect(tally.met).toBe(false);
    const graded = round();
    answer(graded, 5, "T6").grade!.prohibited = true;
    answer(graded, 6, "T10").grade!.noRouteFound = true;
    const second = tallyRound(graded);
    expect(second.tasks.find(task => task.taskId === "T6")).toMatchObject({ prohibited: 1, met: false });
    expect(second.tasks.find(task => task.taskId === "T10")).toMatchObject({ noRouteFound: 1, met: false });
  });

  it("refuses an assisted, unconsented, short or incomplete round instead of counting it", () => {
    const assisted = round(); assisted.sessions[0].facilitatorAssisted = true;
    expect(() => tallyRound(assisted)).toThrow(/assisted/);
    const unconsented = round(); unconsented.sessions[1].consentSigned = false;
    expect(() => tallyRound(unconsented)).toThrow(/consent/);
    const short = round(); short.sessions.pop();
    expect(() => tallyRound(short)).toThrow(/twelve/);
    const missing = round(); missing.sessions[2].answers.pop();
    expect(() => tallyRound(missing)).toThrow(/all ten/);
    const ungraded = round(); answer(ungraded, 3, "T2").grade = null;
    expect(tallyRound(ungraded).tasks.find(task => task.taskId === "T2")).toMatchObject({ ungraded: 1, met: false });
  });
});
