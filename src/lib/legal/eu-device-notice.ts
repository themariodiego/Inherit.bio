import type { CategoryId } from "@/lib/genome/taxonomy";
import { isEuEeaCountry } from "./service-restrictions";

/**
 * Whether a report page adds the EU medical-device sentence
 * (`WHAT_THIS_DOESNT_MEAN_EU_DEVICE`): for a viewer who declared an EU or EEA
 * country, on every report outside everyday traits. A report whose category
 * is unknown gets the sentence too; a missing sentence is the costly mistake.
 */
export function euDeviceNoticeApplies(categoryId: CategoryId | null, viewerCode: string | null): boolean {
  return isEuEeaCountry(viewerCode) && categoryId !== "everyday-traits";
}
