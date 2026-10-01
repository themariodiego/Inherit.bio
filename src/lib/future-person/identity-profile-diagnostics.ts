import "server-only";

const rpcCodes=new Set(["42501","22023","23503","23514","40001","40P01","55P03","57014",
  "08001","08006","53300","53400","57P01","57P02","57P03","42883",
  "PGRST116","PGRST202","PGRST301","PGRST302"]);
const issueCodes=new Set(["invalid_type","too_big","too_small","invalid_format","not_multiple_of",
  "unrecognized_keys","invalid_union","invalid_key","invalid_element","invalid_value","custom"]);
const fields=new Set(["items","nextCursor","embryoId","label","hasProfile","expiresAt","saveContext","deleteContext",
  "subjectId","actorPrincipal","basisFingerprint","basisRevision","participantSetRevision","recipientSetRevision",
  "cohortLifecycleRevision","subjectLifecycleRevision","dispositionRevision","accountRevision","authSessionRevision",
  "sessionRevision","consentSignatureId","currentProfileId","nextIdentityRevision"]);
type Issue=Readonly<{code:string;path:readonly PropertyKey[]}>;
type Diagnostic=Readonly<{stage:"rpc";code:string}|{stage:"schema";issues:readonly Readonly<{code:string;field:string}>[]}
  |{stage:"proof";code:"unavailable"}>;
function emit(value:Diagnostic){
  try{console.warn("identity_profile_controls_unavailable",value);}catch{/* Logging cannot change the refusal. */}
}
/** Only fixed schema names/codes reach server logs. Never serialize errors,
 * unknown keys, paths containing user values, authority or profile fields. */
export function profileRpcFailure(error?:unknown){
  let code="unavailable";
  try{
    const candidate=error&&typeof error==="object"&&"code" in error?error.code:undefined;
    if(typeof candidate==="string"&&rpcCodes.has(candidate))code=candidate;
  }catch{/* Untrusted error accessors have no diagnostic authority. */}
  emit({stage:"rpc",code});
}
export function profileSchemaFailure(issues:readonly Issue[]){
  emit({stage:"schema",issues:issues.slice(0,8).map(issue=>({
    code:issueCodes.has(issue.code)?issue.code:"unavailable",
    field:issue.path.length<=5&&issue.path.every(part=>typeof part==="number"||typeof part==="string"&&fields.has(part))
      ?issue.path.map(part=>typeof part==="number"?"*":part).join(".")||"inventory":"other",
  }))});
}
export function profileProofFailure(){emit({stage:"proof",code:"unavailable"});}
