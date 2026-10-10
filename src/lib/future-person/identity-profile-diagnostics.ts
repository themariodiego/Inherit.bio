import "server-only";
import {profileDiagnosticField,profileDiagnosticLine,profileIssueCodes,profileRpcCodes,type ProfileDiagnostic}
  from "./identity-profile-diagnostic-contract";
type Issue=Readonly<{code:string;path:readonly PropertyKey[]}>;
function emit(value:ProfileDiagnostic){
  try{const line=profileDiagnosticLine(value);if(line!==null)console.warn(line);}catch{/* Logging cannot change the refusal. */}
}
/** Only fixed schema names/codes reach server logs. Never serialize errors,
 * unknown keys, paths containing user values, authority or profile fields. */
export function profileRpcFailure(error?:unknown){
  let code="unavailable";
  try{
    const candidate=error&&typeof error==="object"&&"code" in error?error.code:undefined;
    if(typeof candidate==="string"&&profileRpcCodes.has(candidate))code=candidate;
  }catch{/* Untrusted error accessors have no diagnostic authority. */}
  emit({stage:"rpc",code});
}
export function profileSchemaFailure(issues:readonly Issue[]){
  emit({stage:"schema",issues:issues.slice(0,8).map(issue=>({
    code:profileIssueCodes.has(issue.code)?issue.code:"unavailable",field:profileDiagnosticField(issue.path),
  }))});
}
export function profileProofFailure(){emit({stage:"proof",code:"unavailable"});}
