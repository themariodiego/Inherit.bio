import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLAIMANT_CONTACT_KEEP_DAYS, CLAIMANT_DELETION_DAYS, CLAIMANT_RIGHTS_COPY as COPY } from "@/copy/rights/claimant-rights";
import { ClaimantRights } from "./claimant-rights";
import { CLAIMANT_DELETE_CONTROL, CLAIMANT_PAGE } from "../../../e2e/fixtures/claimant-record-page-text";

/**
 * G5.4 for the future adult: the claimed record's page states its retention
 * in days and a contact of last resort, and the days are the ones the code
 * enforces, within the Charter's promise.
 */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const render = (deletion: { csrf: string; nonce: string } | null) => renderToStaticMarkup(createElement(ClaimantRights,
  { csrf: "c".repeat(64), recoveryNonce: "r".repeat(40), analysisNonce: "a".repeat(40), deletion }));

describe("the claimed record's rights page", () => {
  it("states the retention in days: kept until asked, then deleted within 30 days and its DNA data within 7", () => {
    // Owner decision 2026-10-16 ("Claimant retention stated in days (G5.4)"):
    // the temporary contact sentence now states its 730 days.
    expect(COPY.retention(30, 7, 730)).toBe("Your record stays until you ask to delete it. Once you ask, we delete it "
      + "within 30 days, and its DNA data within 7 days. We keep the contact address you gave us for at most 730 days "
      + "after your claim was approved. Deleting it does not delete your record. "
      + "Keep a Recovery Key so you can start a new claim later with fresh identity documents.");
    for (const deletion of [null, { csrf: "d".repeat(64), nonce: "n".repeat(40) }]) {
      const html = render(deletion);
      expect(html).toContain('data-slot="claimant-retention"');
      expect(text(html)).toContain(COPY.retention(30, 7, 730));
    }
  });
  it("states the temporary contact's 730 days, the number the database enforces", () => {
    expect(CLAIMANT_CONTACT_KEEP_DAYS).toBe(730);
    const html = text(render(null));
    expect(html).toContain("for at most 730 days after your claim was approved");
    expect(html).not.toMatch(/expires separately|24 months/);
    const migration = fs.readFileSync("supabase/migrations/20261016175000_future_person_claimant_contact_730_days.sql", "utf8");
    expect(migration).toContain("create function private.future_person_claimed_unbound_days_v1()\n"
      + "returns integer language sql immutable set search_path='' as $$ select 730 $$;");
    expect(migration).toContain("$new$contact_expiry:=v_now+make_interval(hours=>24*private.future_person_claimed_unbound_days_v1());$new$");
    expect(migration).toContain("$new$and t.fixed_deadline=c.created_at+make_interval(hours=>24*private.future_person_claimed_unbound_days_v1()))$new$");
    const register = fs.readFileSync("docs/retention.md", "utf8").split("\n")
      .find(line => line.startsWith("| `future-person.claimed-unbound-24mo` |"))!;
    expect(register).toContain("Exactly 730 days");
    expect(register).not.toMatch(/24 months|24-month/);
  });
  it("gives the registered contact of last resort once, with or without the delete control", () => {
    expect(COPY.contact).toBe("If this page does not work, or you need help with your rights, write to privacy@inherit.bio.");
    for (const deletion of [null, { csrf: "d".repeat(64), nonce: "n".repeat(40) }]) {
      const html = render(deletion);
      expect(html).toContain('data-slot="claimant-contact"');
      expect(text(html)).toContain(COPY.contact);
      expect(text(html).match(/privacy@inherit\.bio/g)).toHaveLength(1);
      expect(text(html)).not.toMatch(/@(?!inherit\.bio)/);
    }
  });
  it("states only the days the code enforces, and nothing past the Charter's 30 days", () => {
    expect(CLAIMANT_DELETION_DAYS).toEqual({ complete: 30, source: 7 });
    // future-person.claimant-reverification-until-request: no maximum before a
    // request. The native rights view answers exactly null.
    expect(fs.readFileSync("src/lib/future-person/rights.ts", "utf8")).toContain("retentionMaximumDays:z.null()");
    const custody = fs.readFileSync("supabase/migrations/20260930233000_future_person_claim_custody.sql", "utf8");
    expect(custody).toContain("'retentionMaximumDays',null");
    // The delete request: the class's row at 7 days for the source, and the
    // plan's completion deadline at 30 days.
    const erasure = fs.readFileSync("supabase/migrations/20260930245000_future_person_claimant_erasure.sql", "utf8");
    expect(erasure).toContain("values('future-person.claimant-reverification-until-request','subject',s.id,1,"
      + "s.lifecycle_revision,v_embryo.disposition_revision,v_now+interval '7 days','active',v_now)");
    expect(erasure).toContain("'sourceDeadline',v_now+interval '7 days','completionDeadline',v_now+interval '30 days'");
    expect(erasure).toContain("or r.fixed_deadline is distinct from r.created_at+interval '7 days'");
    // A later successor keeps both deadlines exactly (it only appends after them).
    const successor = fs.readFileSync("supabase/migrations/20261001036000_claimed_provenance_last_consumer.sql", "utf8");
    expect(successor).toContain("$successor_2_0$'completionDeadline',v_now+interval '30 days',");
    const charter = fs.readFileSync("content/legal/charter.future-person/v1.md", "utf8");
    expect(charter).toContain("Right 3. You can have it deleted completely, and we will do it within 30 days.");
    expect(CLAIMANT_DELETION_DAYS.complete).toBeLessThanOrEqual(30);
    expect(CLAIMANT_DELETION_DAYS.source).toBeLessThanOrEqual(CLAIMANT_DELETION_DAYS.complete);
  });
  it("no longer leaves the retention without a number of days", () => {
    const html = text(render(null));
    expect(html).toMatch(/within 30 days/);
    expect(html).toMatch(/within 7 days/);
  });
  it("shows the export button only when the server presents its TEST-LOCAL action, with the plain registered label", () => {
    // Owner decision 2026-10-22: a plain label only, with no new notice text.
    expect(COPY.exportLabel).toBe("Export my claimed record");
    const without = render(null);
    expect(without).not.toContain('data-slot="claimant-export"');
    expect(text(without)).not.toContain(COPY.exportLabel);
    const withExport = renderToStaticMarkup(createElement(ClaimantRights, { csrf: "c".repeat(64), recoveryNonce: "r".repeat(40),
      analysisNonce: "a".repeat(40), deletion: null, exportAction: { csrf: "e".repeat(64), nonce: "x".repeat(40) } }));
    expect(withExport.match(/data-slot="claimant-export"/g)).toHaveLength(1);
    expect(withExport).toMatch(/<button[^>]*data-slot="claimant-export"[^>]*>Export my claimed record<\/button>/u);
    // The label is the only text the action adds; the nonce never renders.
    expect(text(withExport).replace(COPY.exportLabel, "").replace(/\s+/g, " ").trim()).toBe(text(without).trim());
    expect(withExport).not.toContain("x".repeat(40));
  });
  it("renders exactly the words the claimed-record browser journey asserts, and no delete words without a delete control", () => {
    // e2e/future-person-claimed-record-journey.spec.ts asserts these strings
    // on /withdraw/session; this holds the rendered component to the same text,
    // so a copy change fails here before it reaches a hosted browser run.
    const slot = (html: string, name: string) => text(html.match(new RegExp(`data-slot="${name}">([^<]*)</p>`, "u"))?.[1] ?? "").trim();
    const closed = render(null), open = render({ csrf: "d".repeat(64), nonce: "n".repeat(40) });
    for (const html of [closed, open]) {
      expect(slot(html, "claimant-retention")).toBe(CLAIMANT_PAGE.retention);
      expect(slot(html, "claimant-contact")).toBe(CLAIMANT_PAGE.contact);
      expect(html).toMatch(new RegExp(`<h1[^>]*>${CLAIMANT_PAGE.heading}</h1>`, "u"));
      for (const value of [CLAIMANT_PAGE.intro, CLAIMANT_PAGE.recoveryLegend, CLAIMANT_PAGE.recoveryAcknowledgement, CLAIMANT_PAGE.recoveryButton])
        expect(text(html)).toContain(value);
    }
    // Owner decision 2026-10-22, "How G5.4's claimant delete is proven": the
    // standard app presents no delete control, so none of its words render.
    for (const value of Object.values(CLAIMANT_DELETE_CONTROL)) {
      expect(text(closed)).not.toContain(value);
      expect(text(open)).toContain(value);
    }
  });
});
