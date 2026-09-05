// Renders each template to HTML (node environment) and asserts key strings.
// createElement instead of JSX so the file stays .test.ts per repo convention.
import { createElement } from "react";
import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";
import { ReportReadyEmail } from "./report-ready";
import { ResearchDigestEmail } from "./research-digest";
import { AdultSubjectInvitationEmail } from "./adult-subject-invitation";
import { CoParentInvitationEmail } from "./co-parent-invitation";
import { EmbryoUploadNoticeEmail } from "./embryo-upload-notice";
import { RecordKeyAddendumEmail } from "./record-key-addendum";
import { EmbryoDispositionNoticeEmail } from "./embryo-disposition-notice";
import { CohortRestrictionNoticeEmail } from "./cohort-restriction-notice";
import { EmbryoDraftExpiredEmail } from "./embryo-draft-expired";
import { mailSubject, renderMail, type MailTemplate } from "@/lib/email";

const ATTRIBUTION =
  "Inherit · an open-source project created by Plus Bio for the public good";
const DISCLAIMER = "Informational, not medical advice.";

describe("abandoned embryo upload notice", () => {
  it("states all three terminal facts without a key, source label or genetic finding", async () => {
    const mail = { id: "embryo-ingest-abandoned", payload: {} } as const;
    const html = await renderMail(mail);
    expect(mailSubject(mail)).toBe("The embryo upload did not complete");
    expect(html).toContain("The upload did not complete.");
    expect(html).toContain("No genetic source file from this upload is");
    expect(html).toContain("retained by Inherit.");
    expect(html).toContain("Every Record Key Card issued for this upload is invalid");
    expect(html).not.toMatch(/Embryo [0-9]|closing date|record_key|rs[0-9]+/);
  });
});

describe("report-ready email", () => {
  it("keeps the ready notice, dashboard link and footers without a combined report total", async () => {
    const html = await render(
      createElement(ReportReadyEmail, {
        reportCount: 12,
        dashboardUrl: "https://example.test/dashboard",
      }),
    );
    expect(html).toContain("Your reports are ready");
    expect(html).toContain("your genome file");
    expect(html).toContain("You can view your reports and their limits on your dashboard.");
    expect(html).not.toMatch(/\b\d[\d,]* reports?\b/);
    expect(html).toContain("https://example.test/dashboard");
    expect(html).toContain(ATTRIBUTION);
    expect(html).toContain(DISCLAIMER);
  });

  it.each([0, 1, 162])("accepts legacy payload count %i without rendering an unclassified quantity", async (reportCount) => {
    const html = await render(
      createElement(ReportReadyEmail, {
        reportCount,
        dashboardUrl: "https://example.test/d",
      }),
    );
    expect(html).toContain("Your reports are ready");
    expect(html).toContain("https://example.test/d");
    expect(html).not.toMatch(/\b\d[\d,]* reports?\b/);
  });
});

describe("research-digest email", () => {
  it("renders entries, manage-preferences link, and footer lines", async () => {
    const html = await render(
      createElement(ResearchDigestEmail, {
        entries: [
          {
            title: "Caffeine metabolism",
            summary: "A CYP1A2 report.",
            url: "https://example.test/r/caffeine",
          },
          {
            title: "Lactase persistence",
            summary: "An MCM6 report.",
            url: "https://example.test/r/lactase",
          },
        ],
        manageUrl: "https://example.test/settings/email",
      }),
    );
    expect(html).toContain("Caffeine metabolism");
    expect(html).toContain("A CYP1A2 report.");
    expect(html).toContain("https://example.test/r/lactase");
    expect(html).toContain("Manage email preferences");
    expect(html).toContain("https://example.test/settings/email");
    expect(html).toContain(ATTRIBUTION);
    expect(html).toContain(DISCLAIMER);
  });
});

describe("adult-subject invitation email", () => {
  it("states the no-access boundary and renders the one-time review link", async () => {
    const html = await render(
      createElement(AdultSubjectInvitationEmail, {
        invitationUrl: "https://example.test/withdraw/opaque-token",
      }),
    );
    expect(html).toContain("No genetic file has been added");
    expect(html).toContain("no access to your genetic data");
    expect(html).toContain("https://example.test/withdraw/opaque-token");
    expect(html).toContain("30 days");
    expect(html).toContain(ATTRIBUTION);
    expect(html).toContain(DISCLAIMER);
  });
});

// React's server renderer separates adjacent text and expression children
// with an empty comment; the helper removes it so sentences can be asserted
// whole. Mail clients ignore the comment.
function stripMarkers(html: string): string {
  return html.replace(/<!-- -->/g, "");
}

async function renderHtml(element: Parameters<typeof render>[0]): Promise<string> {
  return stripMarkers(await render(element));
}

// Embryo-purpose mails (contract §7). A Record Key is 20 characters over the
// Crockford alphabet; no mail body may ever contain one, and no body may
// carry an address (checked as the absence of "@").
const recordKeyShape = /[0-9A-HJKMNP-TV-Z]{20}/;
// A 43-character base64url delivery token, shaped like the real one but with
// no run that could read as a Record Key.
const fragment = `${"a".repeat(21)}-${"b".repeat(21)}`;
const invitationUrl = `https://example.test/withdraw/request#${fragment}`;

function expectSafeBody(html: string) {
  expect(html).toContain(ATTRIBUTION);
  expect(html).toContain(DISCLAIMER);
  expect(html).not.toContain("@");
  expect(html).not.toMatch(recordKeyShape);
}

describe("co-parent invitation email", () => {
  it("explains the empty state, the two statements, refusal, and the 30-day expiry", async () => {
    const html = await renderHtml(createElement(CoParentInvitationEmail, { invitationUrl }));
    expect(html).toContain("You were named as a genetic parent");
    expect(html).toContain("Nothing has been uploaded yet");
    expect(html).toContain("no access to any data of yours");
    expect(html).toContain("your own Inherit account and two signed statements");
    expect(html).toContain("Refusing is one click");
    expect(html).toContain("30 days");
    expect(html).toContain("nothing is kept");
    expect(html).toContain("Review the invitation");
    expectSafeBody(html);
  });

  it("links to the fragment URL and nowhere else", async () => {
    const html = await renderHtml(createElement(CoParentInvitationEmail, { invitationUrl }));
    expect(html).toContain(`href="${invitationUrl}"`);
    expect(html.match(/href="/g)).toHaveLength(1);
  });
});

describe("embryo upload notice email", () => {
  it("states what was stored and what was not, with a withdraw link when given", async () => {
    const html = await renderHtml(
      createElement(EmbryoUploadNoticeEmail, { embryoCount: 3, withdrawUrl: invitationUrl }),
    );
    expect(html).toContain("Embryos were added to Inherit");
    expect(html).toContain("3 embryo records were added on Inherit");
    expect(html).toContain("What was stored: 3 embryo records, added today.");
    expect(html).toContain("What was not stored: no results, and no laboratory labels.");
    expect(html).toContain(`href="${invitationUrl}"`);
    expect(html).toContain("Review your options");
    expectSafeBody(html);
  });

  it("renders one record in the singular and no link without a withdraw URL", async () => {
    const html = await renderHtml(createElement(EmbryoUploadNoticeEmail, { embryoCount: 1 }));
    expect(html).toContain("1 embryo record was added on Inherit");
    expect(html).toContain("What was stored: 1 embryo record, added today.");
    expect(html).not.toContain("Review your options");
    expect(html).not.toContain("href=");
    expectSafeBody(html);
  });
});

describe("record key addendum email", () => {
  it("date-changed names the embryo and the new closing date in words", async () => {
    const html = await renderHtml(
      createElement(RecordKeyAddendumEmail, {
        kind: "date-changed",
        displayLabel: "Embryo 2",
        closingDateIso: "2028-09-05",
        closingDateWords: "5 September 2028",
      }),
    );
    expect(html).toContain("The claim period on your Record Key changed");
    expect(html).toContain("The closing date for Embryo 2 on your Record Key Card is now 5 September 2028 (2028-09-05).");
    expect(html).toContain("The date printed on the card no longer applies.");
    expect(html).not.toContain("href=");
    expectSafeBody(html);
  });

  it("no-source says no genetic file was kept for the embryo", async () => {
    const html = await renderHtml(
      createElement(RecordKeyAddendumEmail, { kind: "no-source", displayLabel: "Embryo 4" }),
    );
    expect(html).toContain("One embryo has no genetic file");
    expect(html).toContain("No genetic file was kept for Embryo 4.");
    expect(html).toContain("cannot be used to claim anything");
    expect(html).not.toContain("href=");
    expectSafeBody(html);
  });

  it("card-invalidated cancels the cards and renders no date", async () => {
    const html = await renderHtml(
      createElement(RecordKeyAddendumEmail, { kind: "card-invalidated", embryoCount: 3 }),
    );
    expect(html).toContain("Every Record Key you were sent was cancelled");
    expect(html).toContain("The Record Key Cards for 3 embryo records are no longer valid");
    expect(html).toContain("Destroy any printed copies.");
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(html).not.toMatch(/\b(?:19|20)\d{2}\b/);
    expect(html).not.toMatch(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );
    expect(html).not.toContain("href=");
    expectSafeBody(html);
  });

  it("card-invalidated reads in the singular for one record", async () => {
    const html = await renderHtml(
      createElement(RecordKeyAddendumEmail, { kind: "card-invalidated", embryoCount: 1 }),
    );
    expect(html).toContain("The Record Key Card for 1 embryo record is no longer valid");
  });
});

describe("embryo disposition notice email", () => {
  const base = {
    displayLabel: "Embryo 3",
    effectiveAt: "2027-03-12T10:15:00+00:00",
    retentionExpiresAt: "2028-09-05T10:15:00.123456+00:00",
  } as const;

  it.each(["stored", "transferred", "donated", "discarded"] as const)(
    "states the %s disposition in plain words with the deletion date in words",
    async (disposition) => {
      const html = await renderHtml(
        createElement(EmbryoDispositionNoticeEmail, { ...base, disposition }),
      );
      expect(html).toContain("A change to one embryo record");
      expect(html).toContain(`Embryo 3 was recorded as ${disposition} on 12 March 2027.`);
      expect(html).toContain("will be deleted on 5 September 2028");
      // Dates are rendered in words only: no raw timestamp reaches the reader.
      expect(html).not.toContain("T10:15");
      expect(html).not.toContain("2027-03-12");
      expect(html).not.toContain("href=");
      expectSafeBody(html);
    },
  );

  it("says what each disposition means for the Record Key Card", async () => {
    const stored = await renderHtml(
      createElement(EmbryoDispositionNoticeEmail, { ...base, disposition: "stored" }),
    );
    expect(stored).toContain("any Record Key Card for it still works");
    const transferred = await renderHtml(
      createElement(EmbryoDispositionNoticeEmail, { ...base, disposition: "transferred" }),
    );
    expect(transferred).toContain("a replacement card is available");
    const discarded = await renderHtml(
      createElement(EmbryoDispositionNoticeEmail, { ...base, disposition: "discarded" }),
    );
    expect(discarded).toContain("Any Record Key Card for it no longer works.");
  });
});

describe("cohort restriction notice email", () => {
  it("states that results are unreadable and source files go within 7 days", async () => {
    const html = await renderHtml(
      createElement(CohortRestrictionNoticeEmail, { embryoCount: 2 }),
    );
    expect(html).toContain("Embryo data will be deleted");
    expect(html).toContain("A genetic parent withdrew 2 embryo records from Inherit.");
    expect(html).toContain("Derived results for these embryos are already unreadable.");
    expect(html).toContain("The source files are deleted within 7 days.");
    expect(html).toContain("no further analysis will run");
    expect(html).not.toContain("href=");
    expectSafeBody(html);
  });
});

describe("embryo draft expired email", () => {
  it("is a terminal notice with nothing uploaded, nothing kept, and no link", async () => {
    const html = await renderHtml(createElement(EmbryoDraftExpiredEmail));
    expect(html).toContain("An embryo upload expired");
    expect(html).toContain("closed after 30 days");
    expect(html).toContain("Nothing was uploaded, and nothing is kept.");
    expect(html).toContain("no longer works");
    expect(html).not.toContain("href=");
    expectSafeBody(html);
  });
});

// The subject map and the render map in src/lib/email.ts, checked against the
// contract's subjects for every embryo-purpose template and kind.
const embryoMails: ReadonlyArray<{ mail: MailTemplate; subject: string; heading: string }> = [
  {
    mail: { id: "co-parent-invitation", payload: { invitationUrl } },
    subject: "You were named as a genetic parent on Inherit",
    heading: "You were named as a genetic parent",
  },
  {
    mail: { id: "embryo-upload-notice", payload: { embryoCount: 2 } },
    subject: "Embryo records were added on Inherit",
    heading: "Embryos were added to Inherit",
  },
  {
    mail: {
      id: "record-key-addendum",
      payload: {
        kind: "date-changed",
        displayLabel: "Embryo 1",
        closingDateIso: "2028-09-05",
        closingDateWords: "5 September 2028",
      },
    },
    subject: "The closing date on your Record Key Card changed",
    heading: "The claim period on your Record Key changed",
  },
  {
    mail: { id: "record-key-addendum", payload: { kind: "no-source", displayLabel: "Embryo 1" } },
    subject: "No genetic file was kept for one embryo",
    heading: "One embryo has no genetic file",
  },
  {
    mail: { id: "record-key-addendum", payload: { kind: "card-invalidated", embryoCount: 2 } },
    subject: "Your Record Key Cards are no longer valid",
    heading: "Every Record Key you were sent was cancelled",
  },
  {
    mail: {
      id: "embryo-disposition-notice",
      payload: {
        displayLabel: "Embryo 1",
        disposition: "stored",
        effectiveAt: "2027-03-12T10:15:00Z",
        retentionExpiresAt: "2028-09-05T10:15:00Z",
      },
    },
    subject: "A disposition was recorded for one embryo record",
    heading: "A change to one embryo record",
  },
  {
    mail: { id: "cohort-restriction-notice", payload: { embryoCount: 2 } },
    subject: "Embryo records were withdrawn and are being deleted",
    heading: "Embryo data will be deleted",
  },
  {
    mail: { id: "embryo-draft-expired", payload: {} },
    subject: "An embryo upload draft expired",
    heading: "An embryo upload expired",
  },
];

describe("embryo mail subjects and render map", () => {
  it.each(embryoMails)("$mail.id yields the contract subject within 78 characters", ({ mail, subject }) => {
    expect(mailSubject(mail)).toBe(subject);
    expect(subject.length).toBeLessThanOrEqual(78);
  });

  it.each(embryoMails)("$mail.id renders through the template map", async ({ mail, heading }) => {
    const html = stripMarkers(await renderMail(mail));
    expect(html).toContain(heading);
    expectSafeBody(html);
  });

  it("keeps the existing subjects unchanged", () => {
    expect(mailSubject({ id: "report-ready", payload: { reportCount: 1, dashboardUrl: "https://example.test/d" } }))
      .toBe("Your Inherit reports are ready");
    expect(mailSubject({ id: "adult-subject-invitation", payload: { invitationUrl } }))
      .toBe("You were invited to Inherit");
  });
});
