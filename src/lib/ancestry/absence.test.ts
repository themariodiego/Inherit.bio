import { describe, expect, it } from "vitest";
import type { OwnReportChoicesPanel, OwnReportPurpose } from "@/lib/uploads/own-report-purpose";
import { ancestryAbsence } from "./absence";

type Ready = Extract<OwnReportChoicesPanel, { kind: "ready" }>;
const SUBJECT = "79140000-0000-4000-8000-000000000001";

function choice(purposeKey: OwnReportPurpose, granted: boolean,
  reconsent: Ready["view"]["choices"][number]["reconsent"] = null) {
  return { purposeKey, label: purposeKey, description: "", granted, grantId: granted ? SUBJECT : null,
    artifact: { key: `consent.${purposeKey}`, version: 2, body: "" }, token: "token", statementKeys: [], reconsent };
}

/** The section the Reports page renders, with one prepared file and the three choices. */
function ready(ancestry: ReturnType<typeof choice> | null): Ready {
  const choices = [choice("reports.monogenic", true), choice("reports.polygenic", true), ...(ancestry ? [ancestry] : [])];
  return { kind: "ready", files: [{ id: SUBJECT, label: "File 1" }], view: { kind: "ready", subjectId: SUBJECT, choices } };
}

describe("why the ancestry page has nothing to show", () => {
  it("no file processed: the Reports page shows no choices section, so nothing has been read", () => {
    expect(ancestryAbsence({ kind: "hidden" })).toBe("nothing-read");
  });

  it("file processed and Ancestry off: the section reads \"Ancestry · Off\", so the page says it is off", () => {
    expect(ancestryAbsence(ready(choice("ancestry", false)))).toBe("permission-off");
  });

  it("is off, too, while a changed Ancestry permission waits to be agreed again", () => {
    // The Reports page shows this as "Ancestry · Off" with the re-consent
    // notice beside the control, so "turn it on in Choose your reports" is
    // still where the person goes.
    const pending = choice("ancestry", false, { signedVersion: 1, changes: [{ version: 2, summary: "Changed." }] });
    expect(ancestryAbsence(ready(pending))).toBe("permission-off");
  });

  it("file processed and Ancestry on: the page is not told it is off", () => {
    expect(ancestryAbsence(ready(choice("ancestry", true)))).toBe("nothing-read");
  });

  it("never claims Ancestry is off when the section could not load or has no Ancestry choice", () => {
    expect(ancestryAbsence({ kind: "files-unavailable" })).toBe("nothing-read");
    expect(ancestryAbsence(ready(null))).toBe("nothing-read");
  });

  it("reads only the Ancestry choice, not the report choices beside it", () => {
    const panel = ready(choice("ancestry", true));
    panel.view.choices = panel.view.choices.map(entry => entry.purposeKey === "ancestry" ? entry : { ...entry, granted: false });
    expect(ancestryAbsence(panel)).toBe("nothing-read");
  });
});
