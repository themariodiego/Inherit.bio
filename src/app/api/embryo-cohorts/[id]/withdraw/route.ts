// api.embryo-withdraw is an alias of api.cohort-restrict with no write path
// of its own (register policy.aliasOf): the same handler, the same contract.
export { POST } from "@/app/api/cohorts/[id]/restrict/route";
