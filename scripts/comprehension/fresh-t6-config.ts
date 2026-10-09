import { z } from "zod";
import { runConfigSchema } from "./run-config";
import { infrastructureReservation } from "./fresh-t6-resources";

export const freshT6ConfigSchema = z.object({ run: runConfigSchema,
  maximumInfrastructureCostPerStackMicroDollars: z.number().int().positive().max(50_000_000) }).strict().superRefine(({ run, maximumInfrastructureCostPerStackMicroDollars }, ctx) => {
  if (run.tasks?.length !== 1 || run.tasks[0] !== "T6" || run.t6Variant === "withheld" || run.kind === "live-run")
    ctx.addIssue({ code: "custom", message: "Fresh T6 supports only explicit T6 standard smoke/calibration, never a full round" });
  try { infrastructureReservation(run.personas ?? 30, maximumInfrastructureCostPerStackMicroDollars, run.limitMicroDollars - run.otherCostsMicroDollars); }
  catch { ctx.addIssue({ code: "custom", message: "Reserve every fresh stack including build bootstrap in the shared budget" }); }
});
