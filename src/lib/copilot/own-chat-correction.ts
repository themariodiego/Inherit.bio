import { z } from "zod";
import { OWN_CHAT_CORRECTION_NOTICE } from "@/copy/reports/scientific-correction";

export { OWN_CHAT_CORRECTION_NOTICE } from "@/copy/reports/scientific-correction";
export const ownChatCorrectionSchema = z.object({
  error: z.literal("report_scientific_correction"),
  notice: z.literal(OWN_CHAT_CORRECTION_NOTICE),
}).strict();
export const ownChatCorrection = () => ({ error: "report_scientific_correction" as const, notice: OWN_CHAT_CORRECTION_NOTICE });
