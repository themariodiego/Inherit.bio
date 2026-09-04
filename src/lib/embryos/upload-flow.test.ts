import { describe, expect, it } from "vitest";
import { EMBRYO_INGEST_AVAILABLE } from "@/copy/embryos/upload";
import {
  INITIAL_FLOW,
  MAXIMUM_INTERACTIVES_PER_SCREEN,
  SCREEN_BUDGET,
  canContinue,
  flowEnd,
  reduceFlow,
  stepOf,
  type FlowEvent,
  type FlowState,
} from "./upload-flow";

function run(events: FlowEvent[], from: FlowState = INITIAL_FLOW): FlowState {
  return events.reduce(reduceFlow, from);
}

/**
 * The upload flow's reducer (design §2.2; brief lines 374-377, 980-991,
 * 1083): "No" ends the flow on the first screen, "A PDF report only" ends
 * it on the third, the attestation gates step 2, every path ends on the
 * honest terminal while ingest is unavailable, and no screen exceeds the
 * X6.1 budget.
 */
describe("the upload flow", () => {
  it("starts on the first question with nothing answered and no way back", () => {
    expect(INITIAL_FLOW.screen).toBe("tested");
    expect(canContinue(INITIAL_FLOW)).toBe(false);
    expect(reduceFlow(INITIAL_FLOW, { type: "back" })).toBe(INITIAL_FLOW);
    expect(reduceFlow(INITIAL_FLOW, { type: "continue" })).toBe(INITIAL_FLOW);
  });

  it('ends on "No" and offers no continue; "Yes" and "I’m not sure" go on', () => {
    const no = run([{ type: "answer-tested", answer: "no" }]);
    expect(flowEnd(no)).toBe("no-testing");
    expect(canContinue(no)).toBe(false);
    expect(run([{ type: "continue" }], no).screen).toBe("tested");
    for (const answer of ["yes", "unsure"] as const) {
      const state = run([{ type: "answer-tested", answer }, { type: "continue" }]);
      expect(state.screen).toBe("who");
      expect(stepOf(state.screen)).toBe(1);
    }
  });

  it("holds nothing from the free-text question and always continues past it", () => {
    const who = run([{ type: "answer-tested", answer: "yes" }, { type: "continue" }]);
    expect(Object.keys(who)).toEqual(["screen", "tested", "sent", "situation", "attested", "basis"]);
    expect(canContinue(who)).toBe(true);
    expect(run([{ type: "continue" }], who).screen).toBe("sent");
  });

  it('ends on "A PDF report only" and continues on the other three', () => {
    const sent = run([{ type: "answer-tested", answer: "yes" }, { type: "continue" }, { type: "continue" }]);
    expect(canContinue(sent)).toBe(false);
    const pdf = reduceFlow(sent, { type: "answer-sent", answer: "pdf-only" });
    expect(flowEnd(pdf)).toBe("pdf");
    expect(canContinue(pdf)).toBe(false);
    expect(reduceFlow(pdf, { type: "continue" }).screen).toBe("sent");
    for (const answer of ["per-embryo-file", "one-file-columns", "zip-folder"] as const) {
      const state = run([{ type: "answer-sent", answer }, { type: "continue" }], sent);
      expect(state.screen).toBe("situation");
      expect(stepOf(state.screen)).toBe(2);
    }
    // Changing the mind after PDF un-ends the screen.
    expect(flowEnd(reduceFlow(pdf, { type: "answer-sent", answer: "zip-folder" }))).toBeNull();
  });

  it("treats the secondary link as an answer that moves on at once", () => {
    const sent = run([{ type: "answer-tested", answer: "yes" }, { type: "continue" }, { type: "continue" }]);
    const state = reduceFlow(sent, { type: "answer-sent", answer: "unknown" });
    expect(state.screen).toBe("situation");
    expect(state.sent).toBe("unknown");
  });

  it("gates step 2 on the chosen situation's own attestation and resets it on a new choice", () => {
    const situation = run([
      { type: "answer-tested", answer: "yes" },
      { type: "continue" },
      { type: "continue" },
      { type: "answer-sent", answer: "one-file-columns" },
      { type: "continue" },
    ]);
    expect(canContinue(situation)).toBe(false);
    // The attestation cannot be ticked before a situation is chosen.
    expect(reduceFlow(situation, { type: "attest", attested: true }).attested).toBe(false);
    const chosen = reduceFlow(situation, { type: "choose-situation", situation: "own-embryos" });
    expect(canContinue(chosen)).toBe(false);
    const attested = reduceFlow(chosen, { type: "attest", attested: true });
    expect(canContinue(attested)).toBe(true);
    const switched = reduceFlow(attested, { type: "choose-situation", situation: "with-genetic-parents-permission" });
    expect(switched.attested).toBe(false);
    expect(canContinue(switched)).toBe(false);
    expect(reduceFlow(attested, { type: "continue" }).screen).toBe("basis");
  });

  it("needs a basis, then reaches the honest terminal, from which Back returns", () => {
    const basis = run([
      { type: "answer-tested", answer: "unsure" },
      { type: "continue" },
      { type: "continue" },
      { type: "answer-sent", answer: "zip-folder" },
      { type: "continue" },
      { type: "choose-situation", situation: "with-genetic-parents-permission" },
      { type: "attest", attested: true },
      { type: "continue" },
    ]);
    expect(basis.screen).toBe("basis");
    expect(canContinue(basis)).toBe(false);
    const chosen = reduceFlow(basis, { type: "choose-basis", basis: "donor-gamete-anonymous" });
    const terminal = reduceFlow(chosen, { type: "continue" });
    expect(terminal.screen).toBe("unavailable");
    expect(stepOf(terminal.screen)).toBeNull();
    expect(canContinue(terminal)).toBe(false);
    expect(reduceFlow(terminal, { type: "continue" })).toBe(terminal);
    expect(reduceFlow(terminal, { type: "back" }).screen).toBe("basis");
  });

  it("keeps every answer when walking back and forward", () => {
    const forward = run([
      { type: "answer-tested", answer: "yes" },
      { type: "continue" },
      { type: "continue" },
      { type: "answer-sent", answer: "per-embryo-file" },
      { type: "continue" },
      { type: "choose-situation", situation: "own-embryos" },
      { type: "attest", attested: true },
      { type: "continue" },
      { type: "choose-basis", basis: "parent-deceased" },
    ]);
    const back = run([{ type: "back" }, { type: "back" }, { type: "back" }, { type: "back" }], forward);
    expect(back.screen).toBe("tested");
    expect(back).toMatchObject({ tested: "yes", sent: "per-embryo-file", situation: "own-embryos", attested: true, basis: "parent-deceased" });
    const again = run([{ type: "continue" }, { type: "continue" }, { type: "continue" }, { type: "continue" }], back);
    expect(again.screen).toBe("basis");
  });

  it("ignores an answer meant for another screen", () => {
    expect(reduceFlow(INITIAL_FLOW, { type: "answer-sent", answer: "zip-folder" })).toBe(INITIAL_FLOW);
    expect(reduceFlow(INITIAL_FLOW, { type: "choose-basis", basis: "parent-deceased" })).toBe(INITIAL_FLOW);
    expect(reduceFlow(INITIAL_FLOW, { type: "choose-situation", situation: "own-embryos" })).toBe(INITIAL_FLOW);
  });

  it("stays within seven interactives and one primary on every screen", () => {
    expect(MAXIMUM_INTERACTIVES_PER_SCREEN).toBe(7);
    for (const [screen, budget] of Object.entries(SCREEN_BUDGET)) {
      expect(budget.interactives, screen).toBeLessThanOrEqual(MAXIMUM_INTERACTIVES_PER_SCREEN);
      expect(budget.primaries, screen).toBe(1);
    }
  });

  it("ends on the unavailable screen exactly while ingest is unavailable", () => {
    // Flipping the flag without building the later steps must fail here.
    expect(EMBRYO_INGEST_AVAILABLE).toBe(false);
  });
});
