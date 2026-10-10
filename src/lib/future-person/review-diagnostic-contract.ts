/** Fixed stage/code diagnostics. No identity, authority, content or error text. */
export const REVIEW_DIAGNOSTIC_PREFIX="claim_review_refused ";
export const reviewDiagnosticStages=["request","body","nonce","case-rpc","case-key","identity","indexes","verify-rpc","verify-proof","branch","decision-rpc","outcome"] as const;
export type ReviewDiagnosticStage=typeof reviewDiagnosticStages[number];
const stages:ReadonlySet<string>=new Set(reviewDiagnosticStages);
const codes:ReadonlySet<string>=new Set(["unavailable","42501","22023","23505","23514","40001","40P01","55P03","57014","42883","PGRST202"]);
export function reviewDiagnosticLine(value:unknown):string|null{
 try{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!=="code,stage")return null;
  const given=value as {stage:unknown;code:unknown};
  if(typeof given.stage!=="string"||!stages.has(given.stage)||typeof given.code!=="string"||!codes.has(given.code))return null;
  return REVIEW_DIAGNOSTIC_PREFIX+JSON.stringify({stage:given.stage,code:given.code});
 }catch{return null;}
}
export function reviewDiagnosticCode(error:unknown):string{
 try{const code=error&&typeof error==="object"&&"code" in error?error.code:null;
  return typeof code==="string"&&codes.has(code)?code:"unavailable";
 }catch{return "unavailable";}
}
