import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Page, { generateMetadata } from "./page";
import { NO_CLASSIFIED_POSITIONS } from "@/copy/family/health-picture";
import { CARRIER_STATUS_H1 } from "@/copy/genome/carrier";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";

/**
 * `/genome/[subject]/carrier` reads the account's own `self` record and no
 * other: a Family handle, a record held for another adult, a Path B record,
 * a refused jurisdiction and a Tier-2 gate all answer as an unknown record,
 * before the carrier reader is asked anything.
 */
const m = vi.hoisted(() => ({ resolve: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/family/subject-route", () => ({ resolveSubjectRoute: m.resolve }));
vi.mock("@/lib/family/own-carrier-read", () => ({ readOwnCarrierView: m.read }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/components/subjects/subject-bar", () => ({ SubjectBar: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not_found"); } }));

const SUBJECT = "88110000-0000-4000-8000-000000000001";
const own = { kind: "ok", user: { id: "viewer" }, subject: { routeSegment: "me", displayLabel: "You", subjectClass: "self" },
  dataSubjectId: SUBJECT, person: null, domain: { label: "My Genome", href: "/genome/me" }, displayLabel: "You" };
const props = { params: Promise.resolve({ subject: "me" }) } as Parameters<typeof Page>[0];

beforeEach(() => {
  vi.clearAllMocks();
  m.resolve.mockResolvedValue(own);
  m.read.mockResolvedValue({ kind: "unavailable", fileCount: 1 });
});

it("asks for the one purpose the page reads, and reads the own self record with the viewer's account", async () => {
  const html = renderToStaticMarkup(await Page(props));
  expect(m.resolve).toHaveBeenCalledWith("me", { anyOf: ["reports.monogenic"] });
  expect(m.read).toHaveBeenCalledExactlyOnceWith({ admin: true }, SUBJECT, "viewer");
  expect(html).toContain(`<h1 class="display">${CARRIER_STATUS_H1}</h1>`);
  expect(html).toContain(NO_CLASSIFIED_POSITIONS);
  expect(html).toContain(NOT_DIAGNOSTIC);
  expect(await generateMetadata(props)).toEqual({ title: `You · ${CARRIER_STATUS_H1}` });
});

it.each([
  ["a Family handle", { ...own, person: { counterpartAccountId: "other" } }],
  ["a record held for another adult", { ...own, subject: { ...own.subject, subjectClass: "other_adult" } }],
  ["a Path B record", { ...own, pathB: { subjectId: SUBJECT, purposes: ["reports.monogenic"], label: "Them" } }],
  ["an unknown record", { kind: "not-found" }],
  ["a refused jurisdiction", { kind: "jurisdiction", decision: {} }],
  ["the Tier-2 gate", { kind: "gate", personSegment: "s-x" }],
])("%s answers as an unknown record and reads nothing", async (_name, context) => {
  m.resolve.mockResolvedValue(context);
  await expect(Page(props)).rejects.toThrow("not_found");
  expect(m.read).not.toHaveBeenCalled();
  expect(await generateMetadata(props)).toEqual({ title: CARRIER_STATUS_H1 });
});
