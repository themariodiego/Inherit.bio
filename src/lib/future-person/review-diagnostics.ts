import "server-only";
import {reviewDiagnosticCode,reviewDiagnosticLine,type ReviewDiagnosticStage} from "./review-diagnostic-contract";
/** Logging can never change a refusal. Read only the fixed allowlisted code. */
export function reviewRefusal(stage:ReviewDiagnosticStage,error?:unknown){
 try{const line=reviewDiagnosticLine({stage,code:reviewDiagnosticCode(error)});if(line!==null)console.warn(line);}catch{/* Fixed diagnostic sink only. */}
}
