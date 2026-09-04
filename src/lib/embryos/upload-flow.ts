/**
 * The `/embryos/upload` flow as a pure reducer (design §2.2; brief lines
 * 374-377, 980-991, 1083; X6.1). The component renders whatever screen the
 * state names and dispatches the reader's answers; nothing here touches the
 * network, a cookie or device storage, and the free-text answer to "Who did
 * the testing?" is not part of the state at all — the input holds it and
 * nothing reads it (design §2.2: "Inherit does not keep this name.").
 *
 * Five steps, shown one question per screen so that no screen carries
 * more than seven interactive elements or more than one primary action
 * (`SCREEN_BUDGET`):
 *
 *   step 1: tested → who → sent        step 2: situation → basis
 *   then `unavailable` — the honest terminal while
 *   `EMBRYO_INGEST_AVAILABLE` is false (design §10). Two answers end the
 *   flow on their own screen instead: "No" to the first question and
 *   "A PDF report only" to the third.
 */
import type { Basis, SentAnswer, TestedAnswer, UploadSituation } from "@/copy/embryos/upload";

export type Screen = "tested" | "who" | "sent" | "situation" | "basis" | "unavailable";

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
    case "who":
    case "sent":
      return 1;
    case "situation":
    case "basis":
      return 2;
    case "unavailable":
      return null;
  }
}

/** The screen's own ending, when an answer closes the flow there. */
export function flowEnd(state: FlowState): "no-testing" | "pdf" | null {
  if (state.screen === "tested" && state.tested === "no") return "no-testing";
  if (state.screen === "sent" && state.sent === "pdf-only") return "pdf";
  return null;
}

/** Whether the screen's one primary action is offered. */
export function canContinue(state: FlowState): boolean {
  if (flowEnd(state)) return false;
  switch (state.screen) {
    case "tested":
      return state.tested === "yes" || state.tested === "unsure";
    case "who":
      return true;
    case "sent":
      return state.sent !== null && state.sent !== "pdf-only";
    case "situation":
      return state.situation !== null && state.attested;
    case "basis":
      return state.basis !== null;
    case "unavailable":
      return false;
  }
}

const NEXT: Readonly<Record<Screen, Screen | null>> = {
  tested: "who",
  who: "sent",
  sent: "situation",
  situation: "basis",
  basis: "unavailable",
  unavailable: null,
};

const PREVIOUS: Readonly<Record<Screen, Screen | null>> = {
  tested: null,
  who: "tested",
  sent: "who",
  situation: "sent",
  basis: "situation",
  unavailable: "basis",
};

export function reduceFlow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "answer-tested":
      return state.screen === "tested" ? { ...state, tested: event.answer } : state;
    case "answer-sent": {
      if (state.screen !== "sent") return state;
      const next = { ...state, sent: event.answer };
      // The secondary link is an answer and a step in one.
      return event.answer === "unknown" ? { ...next, screen: "situation" } : next;
    }
    case "choose-situation":
      if (state.screen !== "situation") return state;
      // A new choice needs its own attestation.
      return state.situation === event.situation ? state : { ...state, situation: event.situation, attested: false };
    case "attest":
      return state.screen === "situation" && state.situation !== null ? { ...state, attested: event.attested } : state;
    case "choose-basis":
      return state.screen === "basis" ? { ...state, basis: event.basis } : state;
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

/**
 * The most interactive elements any state of a screen renders (X6.1: at
 * most seven per step, one primary). The component's render is pinned to
 * these counts by its unit test, and the browser suite measures them.
 */
export const SCREEN_BUDGET: Readonly<Record<Screen, { interactives: number; primaries: 1 }>> = {
  tested: { interactives: 4, primaries: 1 }, // three answers + Continue, or three answers + the way back
  who: { interactives: 3, primaries: 1 }, // the input + Back + Continue
  sent: { interactives: 7, primaries: 1 }, // four options + the secondary link + Back + Continue (or the letter link)
  situation: { interactives: 5, primaries: 1 }, // two options + one checkbox + Back + Continue
  basis: { interactives: 6, primaries: 1 }, // four options + Back + Continue
  unavailable: { interactives: 3, primaries: 1 }, // the letter link + Back + the way back to Embryos
};

export const MAXIMUM_INTERACTIVES_PER_SCREEN = 7;
