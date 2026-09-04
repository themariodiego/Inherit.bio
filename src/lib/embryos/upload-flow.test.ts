import { describe, expect, it } from "vitest";
import { EMBRYO_INGEST_AVAILABLE } from "@/copy/embryos/upload";
import {
  INITIAL_FLOW,
  MAXIMUM_INTERACTIVES_PER_SCREEN,
  SCREEN_BUDGET,
  SHELL_INTERACTIVES,
  advancesOnChoice,
  asksWho,
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

const TO_SENT: FlowEvent[] = [{ type: "answer-tested", answer: "yes" }, { type: "continue" }];
const TO_SITUATION: FlowEvent[] = [...TO_SENT, { type: "answer-sent", answer: "one-file-columns" }];
const TO_BASIS: FlowEvent[] = [
  ...TO_SITUATION,
  { type: "choose-situation", situation: "own-embryos" },
  { type: "attest", attested: true },
  { type: "continue" },
];

/**
 * The upload flow's reducer (design §2.2; brief lines 374-377, 980-991,
 * 1083; X6.1): "No" ends the flow on the first screen, the second question
 * appears once the first is answered, the four options and the four bases
 * are actions, a PDF lands on its own refusal screen, the attestation gates
 * step 2, every path ends on the honest terminal while ingest is
 * unavailable, and no screen exceeds the X6.1 budget once the shell's own
 * controls are counted.
 */
describe("the upload flow", () => {
  it("starts on the first question with nothing answered, the second question hidden and no way back", () => {
    expect(INITIAL_FLOW.screen).toBe("tested");
    expect(asksWho(INITIAL_FLOW)).toBe(false);
    expect(canContinue(INITIAL_FLOW)).toBe(false);
    expect(reduceFlow(INITIAL_FLOW, { type: "back" })).toBe(INITIAL_FLOW);
    expect(reduceFlow(INITIAL_FLOW, { type: "continue" })).toBe(INITIAL_FLOW);
  });

  it('ends on "No" with no continue and no second question; "Yes" and "I’m not sure" ask who and go on', () => {
    const no = run([{ type: "answer-tested", answer: "no" }]);
    expect(flowEnd(no)).toBe("no-testing");
    expect(asksWho(no)).toBe(false);
    expect(canContinue(no)).toBe(false);
    expect(run([{ type: "continue" }], no).screen).toBe("tested");
    for (const answer of ["yes", "unsure"] as const) {
      const asked = run([{ type: "answer-tested", answer }]);
      expect(asksWho(asked)).toBe(true);
      expect(flowEnd(asked)).toBeNull();
      const state = reduceFlow(asked, { type: "continue" });
      expect(state.screen).toBe("sent");
      expect(stepOf(state.screen)).toBe(1);
    }
  });

  it("holds nothing from the free-text question", () => {
    const state = run(TO_SENT);
    expect(Object.keys(state)).toEqual(["screen", "tested", "sent", "situation", "attested", "basis"]);
  });

  it("treats the four options and the secondary link as actions: a PDF lands on its refusal, the rest go to step 2", () => {
    const sent = run(TO_SENT);
    expect(advancesOnChoice("sent")).toBe(true);
    expect(canContinue(sent)).toBe(false);
    const pdf = reduceFlow(sent, { type: "answer-sent", answer: "pdf-only" });
    expect(pdf.screen).toBe("pdf-end");
    expect(flowEnd(pdf)).toBe("pdf");
    expect(stepOf(pdf.screen)).toBe(1);
    expect(canContinue(pdf)).toBe(false);
    expect(reduceFlow(pdf, { type: "continue" })).toBe(pdf);
    expect(reduceFlow(pdf, { type: "back" }).screen).toBe("sent");
    for (const answer of ["per-embryo-file", "one-file-columns", "zip-folder", "unknown"] as const) {
      const state = reduceFlow(sent, { type: "answer-sent", answer });
      expect(state.screen).toBe("situation");
      expect(state.sent).toBe(answer);
      expect(stepOf(state.screen)).toBe(2);
    }
  });

  it("gates step 2 on the chosen situation's own attestation and resets it on a new choice", () => {
    const situation = run(TO_SITUATION);
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

  it("treats each basis as an action to its named screen, then reaches the honest terminal, from which Back returns", () => {
    const basis = run(TO_BASIS);
    expect(basis.screen).toBe("basis");
    expect(advancesOnChoice("basis")).toBe(true);
    expect(canContinue(basis)).toBe(false);
    const named = reduceFlow(basis, { type: "choose-basis", basis: "donor-gamete-anonymous" });
    expect(named.screen).toBe("basis-named");
    expect(named.basis).toBe("donor-gamete-anonymous");
    expect(stepOf(named.screen)).toBe(2);
    expect(canContinue(named)).toBe(true);
    expect(reduceFlow(named, { type: "back" }).screen).toBe("basis");
    const terminal = reduceFlow(named, { type: "continue" });
    expect(terminal.screen).toBe("unavailable");
    expect(stepOf(terminal.screen)).toBeNull();
    expect(canContinue(terminal)).toBe(false);
    expect(reduceFlow(terminal, { type: "continue" })).toBe(terminal);
    expect(reduceFlow(terminal, { type: "back" }).screen).toBe("basis-named");
  });

  it("keeps every answer when walking back and forward", () => {
    const forward = run([...TO_BASIS, { type: "choose-basis", basis: "parent-deceased" }]);
    const back = run([{ type: "back" }, { type: "back" }, { type: "back" }, { type: "back" }], forward);
    expect(back.screen).toBe("tested");
    expect(back).toMatchObject({ tested: "yes", sent: "one-file-columns", situation: "own-embryos", attested: true, basis: "parent-deceased" });
    const again = run(
      [{ type: "continue" }, { type: "answer-sent", answer: "zip-folder" }, { type: "continue" }, { type: "choose-basis", basis: "parent-deceased" }],
      back,
    );
    expect(again.screen).toBe("basis-named");
    expect(again.sent).toBe("zip-folder");
  });

  it("ignores an answer meant for another screen", () => {
    expect(reduceFlow(INITIAL_FLOW, { type: "answer-sent", answer: "zip-folder" })).toBe(INITIAL_FLOW);
    expect(reduceFlow(INITIAL_FLOW, { type: "choose-basis", basis: "parent-deceased" })).toBe(INITIAL_FLOW);
    expect(reduceFlow(INITIAL_FLOW, { type: "choose-situation", situation: "own-embryos" })).toBe(INITIAL_FLOW);
    const sent = run(TO_SENT);
    expect(reduceFlow(sent, { type: "answer-tested", answer: "no" })).toBe(sent);
  });

  it("stays within X6.1 on every screen once the shell's two persistent controls are counted, with at most one primary", () => {
    expect(MAXIMUM_INTERACTIVES_PER_SCREEN).toBe(7);
    expect(SHELL_INTERACTIVES).toBe(2);
    for (const [screen, budget] of Object.entries(SCREEN_BUDGET)) {
      expect(budget.interactives + SHELL_INTERACTIVES, screen).toBeLessThanOrEqual(MAXIMUM_INTERACTIVES_PER_SCREEN);
      expect(budget.primaries, screen).toBeLessThanOrEqual(1);
    }
  });

  it("ends on the unavailable screen exactly while ingest is unavailable", () => {
    // Flipping the flag without building the later steps must fail here.
    expect(EMBRYO_INGEST_AVAILABLE).toBe(false);
  });
});
