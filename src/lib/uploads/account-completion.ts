import { z } from "zod";

/** Strict calendar parsing; no rollover dates, locale parsing or client-reported age. */
export function isAdultOnUtcDate(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(now.getTime())) return false;
  const birth = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== value) return false;
  const anniversaryPassed = now.getUTCMonth() > birth.getUTCMonth()
    || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  return now.getUTCFullYear() - birth.getUTCFullYear() - (anniversaryPassed ? 0 : 1) >= 18;
}

export const accountCompletionBody = z.object({
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  presentationToken: z.string().min(16).max(4096),
}).strict();
