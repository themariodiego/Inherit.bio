/**
 * The Tier-2 gate of the Embryo domain (design §1.5; brief lines 968-972).
 * One gate per session, at the domain boundary, never remembered on the
 * device. The checkbox label, the session sentence and the error status are
 * the same strings Family ships, read from their one home; the heading, the
 * body and the primary action are this domain's.
 */
import {
  GATE_CHECKBOX_LABEL,
  GATE_ERROR_STATUS,
  GATE_HEADING,
  GATE_SESSION_NOTE,
} from "@/copy/family/person";
import { COUNSELLOR_NO_ROUTE } from "@/copy/reports/strings";

export { GATE_CHECKBOX_LABEL, GATE_ERROR_STATUS, GATE_HEADING, GATE_SESSION_NOTE };

/** The one primary action on the gate (design §1.5). */
export const GATE_BUTTON = "Show my embryos";

export const GATE_BODY =
  "What a file says about one embryo also says something about the others, and about both genetic parents. You cannot take a result back once you have read it.";

/** Counsellor routing renders the no-route sentence until data/counsellors/directory.json exists (brief line 972). */
export { COUNSELLOR_NO_ROUTE };
