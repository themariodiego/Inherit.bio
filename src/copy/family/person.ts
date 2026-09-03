/**
 * `/family/[person]` — one adult's own results (design §2.2; brief §5 §5.8,
 * §3 §7.2, X9.2). Every user-visible string of that page, and of the Tier-2
 * gate that stands in front of the whole domain, lives here.
 *
 * Export names carry the readability role; short roles use only registered
 * plain words. The strings the brief quotes ship character-for-character.
 */
import { LAYER_LABELS } from "@/copy/reports/strings";
import type { FindingLayer } from "@/lib/genome/taxonomy";

/**
 * The h1 is the surface name, not the person's name: the subject bar and the
 * breadcrumb carry identity (decisions.md, W6). It is the same string as the
 * Overview's Family box label.
 */
export const PERSON_H1 = "Individual risks";

/** The section headings, in render order. Three h2s under one h1. */
export const REPORTS_HEADING = "Reports";
export const ANCESTRY_HEADING = "Ancestry";
export const PERMISSIONS_HEADING = "Permissions";

/** The link to the permissions screen, whose words are that screen's h1. */
export const PERMISSIONS_LINK = PERMISSIONS_HEADING;

// ---------------------------------------------------------------------------
// The Tier-2 gate (brief line 968): one gate per session, at the domain
// boundary, never remembered on the device.
// ---------------------------------------------------------------------------

export const GATE_HEADING = "Before you look";

/** Character-for-character; the checkbox is labelled exactly this. */
export const GATE_CHECKBOX_LABEL =
  "I understand this can tell me something I can’t un-know.";

/** Character-for-character; the session scope is stated on screen. */
export const GATE_SESSION_NOTE = "You won’t be asked again until you sign out.";

/** The one primary action on the gate. */
export const GATE_BUTTON = "Show what’s shared";

export const GATE_BODY =
  "What another adult shares can also say something about you, and about people you are related to. You cannot take a result back once you have read it.";

/** The gate refused to record the acknowledgement; the page shows no result. */
export const GATE_ERROR_STATUS = "That did not save. Please try again.";

// ---------------------------------------------------------------------------
// The states of §1.4.
// ---------------------------------------------------------------------------

/** Character-for-character (brief line 368). */
export function noFileYet(name: string): string {
  return `${name} hasn’t added a file yet. There is nothing to show.`;
}

/** One line per layer the person has not shared; the layer itself is absent. */
export function notShared(name: string, layer: FindingLayer): string {
  return `${name} has not shared ${LAYER_LABELS[layer]} with you.`;
}

/** A granted layer whose reports this person's file does not reach. */
export function noneCovered(name: string, layer: FindingLayer): string {
  return `${name}’s file covers none of the ${LAYER_LABELS[layer]} reports.`;
}

/** Nothing at all is shared yet: the page says so once and fetches nothing. */
export function waitingToShare(name: string): string {
  return `Waiting for ${name} to share`;
}

export function nothingSharedYet(name: string): string {
  return `${name} has not shared anything with you yet. You will see nothing here until they do.`;
}

/** Sharing is paused; either side can resume it (design §2.4). */
export const PAUSED_BODY =
  "Sharing with this person is paused. Nothing about them shows here until one of you resumes it.";

/**
 * The §5.5 baseline sentence, once per page. The positive form
 * ("Compared against: women, 35 to 44") cannot render today: no demographics
 * row and no sex- or age-banded risk model exists, so a positive form would
 * be invented.
 */
export const BASELINE_ABSENT =
  "No baseline: Inherit does not know this person’s sex and age band.";

/** Character-for-character (brief line 1924); rendered beside the Copilot link. */
export const COPILOT_LOCAL_ONLY =
  "For anyone’s genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit.";

export const ASK_ABOUT_THIS_LINK = "Ask about this";

/** The list of shared reports carries the person's own coverage, never a merged one. */
export function reportsLede(name: string): string {
  return `These reports were resolved from ${name}’s own file. Nothing here is merged with yours.`;
}
