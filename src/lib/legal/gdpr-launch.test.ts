import { describe, expect, it } from "vitest";
import { GDPR_LAUNCH, euLaunchOpen, ukLaunchOpen, type GdprContact, type GdprLaunchState } from "./gdpr-launch";
import { EU_EEA_COUNTRY_CODES, pausedCountryCodesFor } from "./service-restrictions";

const contact: GdprContact = {
  name: "Synthetic Representative Ltd",
  postalAddress: "1 Synthetic Street, Synthetic City",
  email: "rep@example.test",
  appointedOn: "2026-10-01",
};
const ready: GdprLaunchState = {
  euRepresentative: contact,
  ukRepresentative: contact,
  dataProtectionOfficer: contact,
  impactAssessmentApprovedOn: "2026-10-01",
  transferReviewApprovedOn: "2026-10-01",
};

describe("the EU and UK launch gate", () => {
  it("is closed today: nothing has been appointed or approved", () => {
    expect(GDPR_LAUNCH).toEqual({
      euRepresentative: null,
      ukRepresentative: null,
      dataProtectionOfficer: null,
      impactAssessmentApprovedOn: null,
      transferReviewApprovedOn: null,
    });
    expect(euLaunchOpen()).toBe(false);
    expect(ukLaunchOpen()).toBe(false);
  });

  it("opens a territory only with its representative, the officer and both approved reviews", () => {
    expect(euLaunchOpen(ready)).toBe(true);
    expect(ukLaunchOpen(ready)).toBe(true);
    for (const missing of ["dataProtectionOfficer", "impactAssessmentApprovedOn", "transferReviewApprovedOn"] as const) {
      expect(euLaunchOpen({ ...ready, [missing]: null })).toBe(false);
      expect(ukLaunchOpen({ ...ready, [missing]: null })).toBe(false);
    }
    expect(euLaunchOpen({ ...ready, euRepresentative: null })).toBe(false);
    expect(ukLaunchOpen({ ...ready, euRepresentative: null })).toBe(true);
    expect(ukLaunchOpen({ ...ready, ukRepresentative: null })).toBe(false);
    expect(euLaunchOpen({ ...ready, ukRepresentative: null })).toBe(true);
  });
});

describe("paused countries follow the launch gate", () => {
  it("pause the EU/EEA and the UK while both are closed", () => {
    const paused = pausedCountryCodesFor(GDPR_LAUNCH);
    for (const code of [...EU_EEA_COUNTRY_CODES, "GB"]) expect(paused).toContain(code);
  });

  it("open the EU/EEA and the UK once ready, but keep every high-risk country paused", () => {
    const paused = pausedCountryCodesFor(ready);
    for (const code of ["DE", "DK", "SE", "IE", "NL", "IT", "ES", "IS", "LI", "AX", "GB"]) expect(paused).not.toContain(code);
    for (const code of ["FR", "GF", "PT", "HU", "NO", "SJ", "CH", "RU", "CN"]) expect(paused).toContain(code);
    expect(paused).toHaveLength(29);
  });

  it("open only the territory whose representative exists", () => {
    const euOnly = pausedCountryCodesFor({ ...ready, ukRepresentative: null });
    expect(euOnly).toContain("GB");
    expect(euOnly).not.toContain("DE");
    const ukOnly = pausedCountryCodesFor({ ...ready, euRepresentative: null });
    expect(ukOnly).not.toContain("GB");
    expect(ukOnly).toContain("DE");
  });
});
