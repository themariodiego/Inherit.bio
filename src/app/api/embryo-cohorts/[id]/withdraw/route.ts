// api.embryo-withdraw is an alias of api.cohort-restrict with no write path
// of its own (register policy.aliasOf): the same handler, the same contract,
// and so the same one-time X-Inherit-CSRF token (src/lib/security/session-csrf.ts).
export { POST } from "@/app/api/cohorts/[id]/restrict/route";
