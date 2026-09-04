/**
 * The `/embryos/upload` flow as a pure reducer (design §2.2; brief lines
 * 374-377, 980-991, 1083; X6.1). The component renders whatever screen the
 * state names and dispatches the reader's answers; nothing here touches the
 * network, a cookie or device storage, and the free-text answer to "Who did
 * the testing?" is not part of the state at all — the input holds it and
 * nothing reads it (design §2.2: "Inherit does not keep this name.").
 *
 * Five steps, cut into screens so that no screen carries more than five
 * interactive elements of its own (`SCREEN_BUDGET`): X6.1 caps a flow step
 * at seven in the first viewport on the repository's measurement basis,
 * and the signed-in shell contributes two persistent controls to that
 * count (the global search button on every viewport and, on desktop, the
 * attribution link), so five is what a step's own content may use.
 *
 *   step 1: tested (the first question; the second appears once it is
 *           answered) → sent (the four options and the secondary link,
 *           each an action) → pdf-end (the refusal, when a PDF was chosen)
 *   step 2: situation → basis (four actions) → basis-named (the chosen
 *           basis's own screen)
 *   then `unavailable` — the honest terminal while
 *   `EMBRYO_INGEST_AVAILABLE` is false (design §10). "No" to the first
 *   question ends the flow on that screen.
 */
import type { Basis, SentAnswer, TestedAnswer, UploadSituation } from "@/copy/embryos/upload";

export type Screen = "tested" | "sent" | "pdf-end" | "situation" | "basis" | "basis-named" | "unavailable";

export interface FlowState {
  screen: Screen;
  tested: TestedAnswer | null;
  /** `unknown` is the secondary link ("I don’t know — let me upload it and you tell me"). */
  sent: SentAnswer | "unknown" | null;
  situation: UploadSituation | null;
  /** The attestation checkbox of the chosen situation. */
  attested: boolean;
  basis: Basis | null;
}

export const INITIAL_FLOW: FlowState = {
  screen: "tested",
  tested: null,
  sent: null,
  situation: null,
  attested: false,
  basis: null,
};

export type FlowEvent =
  | { type: "answer-tested"; answer: TestedAnswer }
  | { type: "answer-sent"; answer: SentAnswer | "unknown" }
  | { type: "choose-situation"; situation: UploadSituation }
  | { type: "attest"; attested: boolean }
  | { type: "choose-basis"; basis: Basis }
  | { type: "continue" }
  | { type: "back" };

/** The step each screen belongs to; the terminal screen has none. */
export function stepOf(screen: Screen): 1 | 2 | null {
  switch (screen) {
    case "tested":
    case "sent":
    case "pdf-end":
      return 1;
    case "situation":
    case "basis":
    case "basis-named":
      return 2;
    case "unavailable":
      return null;
  }
}

/** The screen's own ending, when an answer closes the flow there. */
export function flowEnd(state: FlowState): "no-testing" | "pdf" | null {
  if (state.screen === "tested" && state.tested === "no") return "no-testing";
  if (state.screen === "pdf-end") return "pdf";
  return null;
}

/** Whether the first screen's second question (the free text) is shown. */
export function asksWho(state: FlowState): boolean {
  return state.screen === "tested" && (state.tested === "yes" || state.tested === "unsure");
}

/** Whether the screen offers a Continue action, and whether it is enabled. */
export function canContinue(state: FlowState): boolean {
  switch (state.screen) {
    case "tested":
      return state.tested === "yes" || state.tested === "unsure";
    case "situation":
      return state.situation !== null && state.attested;
    case "basis-named":
      return state.basis !== null;
    case "sent":
    case "pdf-end":
    case "basis":
    case "unavailable":
      return false;
  }
}

/** The screens whose choices are actions: choosing one moves on at once. */
export function advancesOnChoice(screen: Screen): boolean {
  return screen === "sent" || screen === "basis";
}

const NEXT: Readonly<Record<Screen, Screen | null>> = {
  tested: "sent",
  sent: null, // a choice decides: pdf-end or situation
  "pdf-end": null,
  situation: "basis",
  basis: null, // a choice decides: basis-named
  "basis-named": "unavailable",
  unavailable: null,
};

const PREVIOUS: Readonly<Record<Screen, Screen | null>> = {
  tested: null,
  sent: "tested",
  "pdf-end": "sent",
  situation: "sent",
  basis: "situation",
  "basis-named": "basis",
  unavailable: "basis-named",
};

export function reduceFlow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "answer-tested":
      return state.screen === "tested" ? { ...state, tested: event.answer } : state;
    case "answer-sent": {
      if (state.screen !== "sent") return state;
      const next: Screen = event.answer === "pdf-only" ? "pdf-end" : "situation";
      return { ...state, sent: event.answer, screen: next };
    }
    case "choose-situation":
      if (state.screen !== "situation") return state;
      // A new choice needs its own attestation.
      return state.situation === event.situation ? state : { ...state, situation: event.situation, attested: false };
    case "attest":
      return state.screen === "situation" && state.situation !== null ? { ...state, attested: event.attested } : state;
    case "choose-basis":
      return state.screen === "basis" ? { ...state, basis: event.basis, screen: "basis-named" } : state;
    case "continue": {
      const next = NEXT[state.screen];
      return canContinue(state) && next ? { ...state, screen: next } : state;
    }
    case "back": {
      const previous = PREVIOUS[state.screen];
      return previous ? { ...state, screen: previous } : state;
    }
  }
}

/** X6.1's cap for a flow step, on the repository's measurement basis. */
export const MAXIMUM_INTERACTIVES_PER_SCREEN = 7;

/**
 * The persistent controls the signed-in shell adds to every first viewport
 * on that basis (src/components/site/app-shell.tsx): the global search
 * button, and on desktop the attribution link beneath the side rail.
 */
export const SHELL_INTERACTIVES = 2;

/**
 * The most interactive elements any state of a screen renders of its own
 * (never more than the cap less the shell's two), and whether it carries a
 * primary action: a screen of equal choices carries none (brief line 928:
 * at most one primary per viewport). The component's render is pinned to
 * these counts by its unit test, and the browser suite measures them with
 * the shell present.
 */
export const SCREEN_BUDGET: Readonly<Record<Screen, { interactives: number; primaries: 0 | 1 }>> = {
  tested: { interactives: 5, primaries: 1 }, // three answers + the free-text input + Continue; or three answers + the way back
  sent: { interactives: 5, primaries: 0 }, // the four options and the secondary link, each an action of equal weight
  "pdf-end": { interactives: 3, primaries: 1 }, // the letter link + Back + the way back to Embryos
  situation: { interactives: 5, primaries: 1 }, // two options + one checkbox + Back + Continue
  basis: { interactives: 5, primaries: 0 }, // four options of equal weight, each an action, + Back
  "basis-named": { interactives: 2, primaries: 1 }, // Back + Continue
  unavailable: { interactives: 3, primaries: 1 }, // the letter link + Back + the way back to Embryos
};
