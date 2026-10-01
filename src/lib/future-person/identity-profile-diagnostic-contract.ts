/** Closed, value-free wire contract shared by the loader and CI launcher.
 * It carries no record identity, authority, error text or unknown field. */
export const PROFILE_DIAGNOSTIC_PREFIX="identity_profile_controls_unavailable ";
export const PROFILE_DIAGNOSTIC_LINE_BYTES=2048;
export const profileRpcCodes:ReadonlySet<string>=new Set(["unavailable","42501","22023","23503","23514","40001","40P01","55P03","57014",
  "08001","08006","53300","53400","57P01","57P02","57P03","42883",
  "PGRST116","PGRST202","PGRST301","PGRST302"]);
export const profileIssueCodes:ReadonlySet<string>=new Set(["unavailable","invalid_type","too_big","too_small","invalid_format","not_multiple_of",
  "unrecognized_keys","invalid_union","invalid_key","invalid_element","invalid_value","custom"]);
const fields=new Set(["items","nextCursor","embryoId","label","hasProfile","expiresAt","saveContext","deleteContext",
  "subjectId","actorPrincipal","basisFingerprint","basisRevision","participantSetRevision","recipientSetRevision",
  "cohortLifecycleRevision","subjectLifecycleRevision","dispositionRevision","accountRevision","authSessionRevision",
  "sessionRevision","consentSignatureId","currentProfileId","nextIdentityRevision"]);
type Issue=Readonly<{code:string;field:string}>;
export type ProfileDiagnostic=Readonly<{stage:"rpc";code:string}|{stage:"schema";issues:readonly Issue[]}
  |{stage:"proof";code:"unavailable"}>;
export function profileDiagnosticField(path:readonly PropertyKey[]):string{
  return path.length<=5&&path.every(part=>typeof part==="number"||typeof part==="string"&&fields.has(part))
    ?path.map(part=>typeof part==="number"?"*":part).join(".")||"inventory":"other";
}
function record(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==="object"&&!Array.isArray(value);
}
function keys(value:Record<string,unknown>,expected:string){return Object.keys(value).sort().join(",")===expected;}
function field(value:unknown):value is string{
  if(value==="inventory"||value==="other")return true;
  if(typeof value!=="string")return false;
  const parts=value.split(".");return parts.length<=5&&parts.every(part=>part==="*"||fields.has(part));
}
/** Rebuild a canonical record from fixed enums only. Never relay raw JSON,
 * additional properties or an object's own serialization hook. */
export function profileDiagnosticLine(value:unknown):string|null{
  try{
    if(!record(value))return null;
    let safe:ProfileDiagnostic;
    if(value.stage==="rpc"&&keys(value,"code,stage")&&typeof value.code==="string"&&profileRpcCodes.has(value.code))
      safe={stage:"rpc",code:value.code};
    else if(value.stage==="proof"&&keys(value,"code,stage")&&value.code==="unavailable")
      safe={stage:"proof",code:"unavailable"};
    else if(value.stage==="schema"&&keys(value,"issues,stage")&&Array.isArray(value.issues)&&value.issues.length<=8){
      const issues:Issue[]=[];
      for(const issue of value.issues){
        if(!record(issue)||!keys(issue,"code,field")||typeof issue.code!=="string"
          ||!profileIssueCodes.has(issue.code)||!field(issue.field))return null;
        issues.push({code:issue.code,field:issue.field});
      }
      safe={stage:"schema",issues};
    }else return null;
    return PROFILE_DIAGNOSTIC_PREFIX+JSON.stringify(safe);
  }catch{return null;}
}
