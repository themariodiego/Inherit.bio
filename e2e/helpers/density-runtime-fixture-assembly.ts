import assert from "node:assert/strict";
import { densityCapturePlan, densityStateKey } from "../../scripts/density-capture-plan";
import type { DensityStateFixture } from "./density-current-capture";
import { densityServicePort } from "../../scripts/density-service-binding";
import { realPublicAndAuthDensityFixtures } from "./density-real-state-fixtures";
import { realAccountAndOwnDensityFixtures } from "./density-owned-state-fixtures";
import { realPairedFamilyDensityFixtures } from "./density-family-state-fixtures";
import { realOwnReportDensityFixtures } from "./density-report-state-fixtures";
import { realOwnCarrierDensityFixtures } from "./density-carrier-state-fixtures";
import { realCohortEntryDensityFixtures } from "./density-cohort-entry-state-fixtures";
import { realFileTransferDensityFixtures } from "./density-file-transfer-state-fixtures";
import { realPublishedCohortDensityFixtures } from "./density-cohort-publication-state-fixtures";
import { realUnansweredCopilotDensityFixtures } from "./density-copilot-state-fixtures";
import { realJurisdictionDensityFixtures } from "./density-jurisdiction-state-fixtures";
import { realLiveCohortDensityFixtures } from "./density-cohort-live-state-fixtures";
import { realWithdrawalDensityFixtures } from "./density-withdrawal-state-fixtures";
import { realClaimProcessingDensityFixtures } from "./density-claim-state-fixtures";
import { realStatisticalCohortDensityFixtures } from "./density-cohort-statistical-state-fixtures";
import { realAppealReviewProcessingDensityFixtures } from "./density-appeal-review-state-fixtures";
import { realClaimReviewDensityFixtures } from "./density-claim-review-state-fixtures";
import { realSubjectAccessProcessingDensityFixtures } from "./density-subject-access-state-fixtures";
import { realPortraitDensityFixtures } from "./density-portrait-state-fixtures";
import { realHealthPictureDensityFixtures, realOverviewJurisdictionDensityFixtures } from "./density-health-picture-state-fixtures";
import { realRemainingCopilotDensityFixtures } from "./density-remaining-copilot-state-fixtures";
import { realFinalizedEmbryoEmptyDensityFixtures } from "./density-finalized-embryo-empty-state-fixtures";

/** Every argument retains the original provider's observer, actual mail and
 * fresh-runtime ABI. Fixed original app origins are not rewritten here. */
export interface DensityRuntimeFixtureAssemblyInput {
  publicAndAuth: Parameters<typeof realPublicAndAuthDensityFixtures>[0];
  accountAndOwn: Parameters<typeof realAccountAndOwnDensityFixtures>[0];
  pairedFamily: Parameters<typeof realPairedFamilyDensityFixtures>[0];
  ownReport: Parameters<typeof realOwnReportDensityFixtures>[0];
  ownCarrier: Parameters<typeof realOwnCarrierDensityFixtures>[0];
  cohortEntry: Parameters<typeof realCohortEntryDensityFixtures>[0];
  fileTransfer: Parameters<typeof realFileTransferDensityFixtures>[0];
  publishedCohort: Parameters<typeof realPublishedCohortDensityFixtures>[0];
  unansweredCopilot: Parameters<typeof realUnansweredCopilotDensityFixtures>[0];
  jurisdiction: Parameters<typeof realJurisdictionDensityFixtures>[0];
  liveCohort: Parameters<typeof realLiveCohortDensityFixtures>[0];
  withdrawal: Parameters<typeof realWithdrawalDensityFixtures>[0];
  claimProcessing: Parameters<typeof realClaimProcessingDensityFixtures>[0];
  statisticalCohort: Parameters<typeof realStatisticalCohortDensityFixtures>[0];
  appealReview: Parameters<typeof realAppealReviewProcessingDensityFixtures>[0];
  claimReview: Parameters<typeof realClaimReviewDensityFixtures>[0];
  subjectAccessProcessing: Parameters<typeof realSubjectAccessProcessingDensityFixtures>[0];
  portrait: Parameters<typeof realPortraitDensityFixtures>[0];
  /** Additive prepared providers; absence remains a complete-census HOLD. */
  healthPicture?: Parameters<typeof realHealthPictureDensityFixtures>[0];
  overviewJurisdiction?: Parameters<typeof realOverviewJurisdictionDensityFixtures>[0];
  remainingCopilot?: Parameters<typeof realRemainingCopilotDensityFixtures>[0];
  finalizedEmbryoEmpty?: Parameters<typeof realFinalizedEmbryoEmptyDensityFixtures>[0];
}

/** Connect the complete prepared source inventory. This creates no runtime,
 * state, screenshot or acceptance. Missing native source remains a provider
 * omission and the unchanged complete capture plan retains its HOLD. */
export function assembleRealDensityFixtures(input: DensityRuntimeFixtureAssemblyInput): DensityStateFixture[] {
  const reference = input.publicAndAuth;
  const inputs = [
    input.publicAndAuth,
    input.accountAndOwn,
    input.pairedFamily,
    input.ownReport,
    input.ownCarrier,
    input.cohortEntry,
    input.fileTransfer,
    input.publishedCohort,
    input.unansweredCopilot,
    input.jurisdiction,
    input.liveCohort,
    input.withdrawal,
    input.claimProcessing,
    input.statisticalCohort,
    input.appealReview,
    input.claimReview,
    input.subjectAccessProcessing,
    input.portrait,
    ...(input.healthPicture ? [input.healthPicture] : []),
    ...(input.overviewJurisdiction ? [input.overviewJurisdiction] : []),
    ...(input.remainingCopilot ? [input.remainingCopilot] : []),
    ...(input.finalizedEmbryoEmpty ? [input.finalizedEmbryoEmpty] : []),
  ];
  for (const provider of inputs) {
    assert(provider.root === reference.root && provider.browser === reference.browser
      && provider.register === reference.register, "One exact source, register and owned browser required");
  }
  const bindService = (fixtures: DensityStateFixture[], origin: string | ((fixture: DensityStateFixture) => string)) =>
    fixtures.map(fixture => {
      const serviceOrigin = typeof origin === "function" ? origin(fixture) : origin;
      densityServicePort(serviceOrigin);
      return { ...fixture, serviceOrigin };
    });
  const fixtures: DensityStateFixture[] = [
    ...bindService(realPublicAndAuthDensityFixtures(input.publicAndAuth), input.publicAndAuth.origin),
    ...bindService(realAccountAndOwnDensityFixtures(input.accountAndOwn), input.accountAndOwn.origin),
    ...bindService(realPairedFamilyDensityFixtures(input.pairedFamily), input.pairedFamily.origin),
    ...bindService(realOwnReportDensityFixtures(input.ownReport), input.ownReport.origin),
    ...bindService(realOwnCarrierDensityFixtures(input.ownCarrier), input.ownCarrier.origin),
    ...bindService(realCohortEntryDensityFixtures(input.cohortEntry), input.cohortEntry.origin),
    ...bindService(realFileTransferDensityFixtures(input.fileTransfer), input.fileTransfer.origin),
    ...bindService(realPublishedCohortDensityFixtures(input.publishedCohort), input.publishedCohort.origin),
    ...bindService(realUnansweredCopilotDensityFixtures(input.unansweredCopilot), input.unansweredCopilot.origin),
    ...bindService(realJurisdictionDensityFixtures(input.jurisdiction), input.jurisdiction.origin),
    ...bindService(realLiveCohortDensityFixtures(input.liveCohort), input.liveCohort.origin),
    ...bindService(realWithdrawalDensityFixtures(input.withdrawal), input.withdrawal.origin),
    ...bindService(realClaimProcessingDensityFixtures(input.claimProcessing), input.claimProcessing.origin),
    ...bindService(realStatisticalCohortDensityFixtures(input.statisticalCohort), input.statisticalCohort.origin),
    ...bindService(realAppealReviewProcessingDensityFixtures(input.appealReview), input.appealReview.origin),
    ...bindService(realClaimReviewDensityFixtures(input.claimReview), input.claimReview.origin),
    ...bindService(realSubjectAccessProcessingDensityFixtures(input.subjectAccessProcessing), input.subjectAccessProcessing.origin),
    ...bindService(realPortraitDensityFixtures(input.portrait), input.portrait.origin),
    ...(input.healthPicture ? bindService(realHealthPictureDensityFixtures(input.healthPicture), input.healthPicture.origin) : []),
    // This original journey starts on main and genuinely navigates to OFF.
    ...(input.overviewJurisdiction ? bindService(realOverviewJurisdictionDensityFixtures(input.overviewJurisdiction), "http://localhost:3101") : []),
    ...(input.remainingCopilot ? bindService(realRemainingCopilotDensityFixtures(input.remainingCopilot), fixture =>
      fixture.state === "jurisdiction-unavailable" ? input.remainingCopilot!.localModelOrigin : input.remainingCopilot!.origin) : []),
    ...(input.finalizedEmbryoEmpty ? bindService(realFinalizedEmbryoEmptyDensityFixtures(input.finalizedEmbryoEmpty), input.finalizedEmbryoEmpty.origin) : []),
  ];
  // Reject duplicate/foreign pairs without deduplicating, remapping, or
  // filling missing states. The actual driver saves the complete HOLD.
  densityCapturePlan(reference.register, fixtures.map(fixture => densityStateKey(fixture.routeId, fixture.state)));
  return fixtures;
}
