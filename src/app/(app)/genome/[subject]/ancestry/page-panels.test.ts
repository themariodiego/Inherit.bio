import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";
import { ANCESTRY_NOT_GENERATED, ANCESTRY_OFF, NEANDERTHAL_BODY, NOTHING_READ } from "@/copy/ancestry";
import type { OwnReportChoicesPanel } from "@/lib/uploads/own-report-purpose";

/**
 * The ancestry page's panels as they render, with no database: only the data
 * and auth loaders are doubled, and every result component is the real one.
 * This is the fast local proof of what `e2e/genome-data-empty.spec.ts` and
 * `e2e/ancestry-revocation.spec.ts` read in a browser, in both states of the
 * TEST-LOCAL flag (the browser suite runs with it set):
 *
 * - flag set: four ancestry panels (regions, mother's line, father's line and
 *   the Neanderthal card) each say the page's no-result state for itself;
 * - flag unset (production): the regions and both lines say it, and the
 *   Neanderthal card says only its production sentence.
 *
 * Each panel is found by its own identity, so a missing panel and an extra
 * sentence anywhere on the page both fail.
 */
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), own: vi.fn(), choices: vi.fn() }));
vi.mock("@/lib/family/subject-route", () => ({ resolveSubjectRoute: mocks.resolve }));
vi.mock("@/lib/family/access", () => ({ viewerMaySee: () => true }));
vi.mock("@/lib/family/shared-ancestry-results", () => ({ loadSharedAncestrySnapshot: vi.fn() }));
vi.mock("@/lib/ancestry/own-results", () => ({ loadAncestryResultSnapshot: mocks.own }));
vi.mock("@/lib/genome/input-sources", () => ({ loadInputSources: async () => [] }));
vi.mock("@/lib/genome/load", () => ({ getSubjectFileCount: async () => 1, hasFileInPreparation: async () => false }));
vi.mock("@/lib/uploads/prepare-own-report-choices", () => ({ loadOwnReportChoicesPanel: mocks.choices }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/components/subjects/subject-bar", () => ({ SubjectBar: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); }, redirect: () => { throw new Error("gate"); } }));

const subjectId = "79130000-0000-4000-8000-000000000001";
const props = { params: Promise.resolve({ subject: "me" }) } as Parameters<typeof Page>[0];
function choicesPanel(ancestryGranted: boolean): OwnReportChoicesPanel {
  const choice = (purposeKey: "reports.monogenic" | "reports.polygenic" | "ancestry", granted: boolean) => ({
    purposeKey, label: purposeKey, description: "", granted, grantId: granted ? subjectId : null, revokeNonce: granted ? "revoke-nonce" : null,
    artifact: { key: `consent.${purposeKey}`, version: 1, body: "" }, token: "token", statementKeys: [], reconsent: null });
  return { kind: "ready", files: [{ id: subjectId, label: "File 1" }], view: { kind: "ready", subjectId, choices: [
    choice("reports.monogenic", false), choice("reports.polygenic", true), choice("ancestry", ancestryGranted)] } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({ kind: "ok", user: { id: "viewer" }, subject: { routeSegment: "me", displayLabel: "You" },
    dataSubjectId: subjectId, person: null, domain: { label: "My Genome", href: "/genome" } });
  // No stored result: the loader's real empty shape.
  mocks.own.mockResolvedValue({ rows: [], neanderthal: [], confirm: async () => [] });
});
afterEach(() => { vi.unstubAllEnvs(); });

/** Each ancestry panel by its own identity, in page order. */
const PANELS = [
  { name: "regions", open: 'data-testid="admixture"' },
  { name: "mother's line", open: 'data-testid="mtdna"' },
  { name: "father's line", open: 'data-testid="ydna"' },
  { name: "Neanderthals", open: 'id="neanderthal"' },
] as const;
type PanelName = (typeof PANELS)[number]["name"];
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
/** The markup of each panel, from its own opening tag to the next panel's (the last to the sources section). */
function panels(html: string): Record<PanelName, string> {
  const starts = PANELS.map(panel => {
    expect(occurrences(html, panel.open), `${panel.name} renders once`).toBe(1);
    return html.indexOf(panel.open);
  });
  expect(starts, "the panels render in page order").toEqual([...starts].sort((a, b) => a - b));
  const end = html.indexOf('aria-labelledby="sources-heading"');
  expect(end).toBeGreaterThan(starts.at(-1)!);
  return Object.fromEntries(PANELS.map((panel, index) => [panel.name, html.slice(starts[index], starts[index + 1] ?? end)])) as Record<PanelName, string>;
}

const STATES = [
  { absence: "nothing-read", choices: { kind: "hidden" } as OwnReportChoicesPanel, sentence: NOTHING_READ, slot: null },
  { absence: "permission-off", choices: choicesPanel(false), sentence: ANCESTRY_OFF, slot: 'data-slot="ancestry-off"' },
  { absence: "not-generated", choices: choicesPanel(true), sentence: ANCESTRY_NOT_GENERATED, slot: 'data-slot="ancestry-not-generated"' },
] as const;
const ALL_SENTENCES = [NOTHING_READ, ANCESTRY_OFF, ANCESTRY_NOT_GENERATED];
const ALL_SLOTS = ['data-slot="ancestry-off"', 'data-slot="ancestry-not-generated"'];

it.each(STATES.flatMap(state => [
  { ...state, flag: "1", saying: ["regions", "mother's line", "father's line", "Neanderthals"] as PanelName[] },
  { ...state, flag: "", saying: ["regions", "mother's line", "father's line"] as PanelName[] },
]))("$absence with INHERIT_TEST_JURISDICTION=$flag: exactly the panels $saying say it for themselves", async ({ choices, sentence, slot, flag, saying }) => {
  vi.stubEnv("INHERIT_TEST_JURISDICTION", flag);
  mocks.choices.mockResolvedValue(choices);
  const html = renderToStaticMarkup(await Page(props));
  const byPanel = panels(html);
  for (const panel of PANELS) {
    const says = saying.includes(panel.name), text = byPanel[panel.name];
    expect(occurrences(text, sentence), `${panel.name} ${says ? "says" : "does not say"} the state sentence`).toBe(says ? 1 : 0);
    if (slot) {
      expect(occurrences(text, slot), `${panel.name} ${says ? "has" : "has no"} the state's slot`).toBe(says ? 1 : 0);
      expect(occurrences(text, 'href="/genome/me/reports"'), `${panel.name} links to this subject's Reports page`).toBe(says ? 1 : 0);
    }
    for (const other of ALL_SENTENCES.filter(entry => entry !== sentence)) expect(occurrences(text, other), panel.name).toBe(0);
  }
  // Nothing outside those panels says it, and no other state's words or slot appear anywhere.
  expect(occurrences(html, sentence)).toBe(saying.length);
  if (slot) expect(occurrences(html, slot)).toBe(saying.length);
  for (const other of ALL_SLOTS.filter(entry => entry !== slot)) expect(occurrences(html, other)).toBe(0);
  // Production: the Neanderthal card says its production sentence and nothing else; TEST-LOCAL never says it.
  expect(occurrences(byPanel.Neanderthals, NEANDERTHAL_BODY)).toBe(flag === "" ? 1 : 0);
  expect(occurrences(html, NEANDERTHAL_BODY)).toBe(flag === "" ? 1 : 0);
  expect(html).not.toContain("data-figure-kind");
});
