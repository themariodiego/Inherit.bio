import type { DensityStateCase } from "./density-capture-plan";

export type FileTransferDensityRecipe = "pending" | "prepared";
export const FILE_TRANSFER_DENSITY_STATES: Readonly<Record<string, Readonly<Record<string, FileTransferDensityRecipe>>>> = {
  "files.index": { processing: "pending", complete: "prepared" },
  "files.upload": { processing: "pending" },
};
export function fileTransferDensityRecipe(row: DensityStateCase): FileTransferDensityRecipe | null {
  return Object.hasOwn(FILE_TRANSFER_DENSITY_STATES, row.route.id)
    && Object.hasOwn(FILE_TRANSFER_DENSITY_STATES[row.route.id], row.state)
    ? FILE_TRANSFER_DENSITY_STATES[row.route.id][row.state] : null;
}
