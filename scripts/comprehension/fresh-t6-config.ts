import { z } from "zod";
import { taskIds } from "./conductor-contract";
import { runConfigSchema } from "./run-config";
import { infrastructureReservation } from "./fresh-t6-resources";

export const freshT6ConfigSchema = z.object({ run: runConfigSchema,
  maximumInfrastructureCostPerStackMicroDollars: z.number().int().positive().max(50_000_000) }).strict().superRefine(({ run, maximumInfrastructureCostPerStackMicroDollars }, ctx) => {
  const tasks = run.tasks ?? [...taskIds];
  if (new Set(tasks).size !== tasks.length || run.t6Variant === "withheld")
    ctx.addIssue({ code: "custom", message: "Exclusive native TEST-LOCAL runs require distinct tasks and the standard T6 variant" });
  try { infrastructureReservation(run.personas ?? 30, maximumInfrastructureCostPerStackMicroDollars, run.limitMicroDollars - run.otherCostsMicroDollars, tasks.length); }
  catch { ctx.addIssue({ code: "custom", message: "Reserve every fresh stack including build bootstrap in the shared budget" }); }
});
