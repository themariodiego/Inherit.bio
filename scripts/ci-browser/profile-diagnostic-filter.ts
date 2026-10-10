import type {Readable} from "node:stream";
import {PROFILE_DIAGNOSTIC_LINE_BYTES,PROFILE_DIAGNOSTIC_PREFIX,profileDiagnosticLine}
  from "../../src/lib/future-person/identity-profile-diagnostic-contract";

import {REVIEW_DIAGNOSTIC_PREFIX,reviewDiagnosticLine} from "../../src/lib/future-person/review-diagnostic-contract";
import {APP_LAUNCHER_DIAGNOSTIC_PREFIX,appLauncherDiagnosticLine} from "./app-launcher-diagnostic";

export const PROFILE_DIAGNOSTIC_RECORD_LIMIT=64;
/** A complete ASCII line is required. Oversize lines are discarded through
 * their newline; their suffix cannot masquerade as a fresh diagnostic. */
export function profileDiagnosticFilter(emit:(line:string)=>void){
  let pending:Buffer=Buffer.alloc(0),discard=false,closed=false;
  return {
    write(chunk:Buffer|string){
      if(closed)return;
      const bytes=typeof chunk==="string"?Buffer.from(chunk):chunk;
      let start=0;
      while(start<bytes.length){
        const newline=bytes.indexOf(10,start),end=newline<0?bytes.length:newline;
        if(!discard){
          const part=bytes.subarray(start,end);
          if(pending.length+part.length>PROFILE_DIAGNOSTIC_LINE_BYTES||part.some(byte=>byte>127)){
            pending=Buffer.alloc(0);discard=true;
          }else pending=Buffer.concat([pending,part]);
        }
        if(newline<0)break;
        const line=pending.toString("ascii");
        const prefix=line.startsWith(PROFILE_DIAGNOSTIC_PREFIX)?PROFILE_DIAGNOSTIC_PREFIX:
          line.startsWith(REVIEW_DIAGNOSTIC_PREFIX)?REVIEW_DIAGNOSTIC_PREFIX:
          line.startsWith(APP_LAUNCHER_DIAGNOSTIC_PREFIX)?APP_LAUNCHER_DIAGNOSTIC_PREFIX:null;
        if(!discard&&prefix!==null){
          try{
            const value=JSON.parse(line.slice(prefix.length));
            const safe=prefix===PROFILE_DIAGNOSTIC_PREFIX?profileDiagnosticLine(value):
              prefix===REVIEW_DIAGNOSTIC_PREFIX?reviewDiagnosticLine(value):appLauncherDiagnosticLine(value);if(safe!==null&&line===safe)emit(safe);
          }catch{/* Unknown logs and failed sinks have no diagnostic authority. */}
        }
        pending=Buffer.alloc(0);discard=false;start=newline+1;
      }
    },
    end(){pending=Buffer.alloc(0);discard=false;closed=true;},
  };
}
/** Both app pipes share one output budget. Raw output is always drained and
 * never forwarded or persisted. End/close drops a truncated partial line. */
export function forwardProfileDiagnostics(streams:readonly (Readable|null|undefined)[],emit:(line:string)=>void){
  let records=0;
  const closers: Array<()=>void>=[];
  for(const stream of streams){
    if(!stream)continue;
    const filter=profileDiagnosticFilter(line=>{if(records<PROFILE_DIAGNOSTIC_RECORD_LIMIT){records++;emit(line);}});
    const write=(chunk:Buffer|string)=>filter.write(chunk),end=()=>filter.end();
    stream.on("data",write);stream.once("end",end);stream.once("close",end);
    closers.push(()=>{filter.end();stream.off("data",write);stream.off("end",end);stream.off("close",end);stream.resume();});
  }
  return ()=>{for(const close of closers)close();};
}
/** The relay's stdout carries synthetic message bodies. Only its stderr may
 * supply canonical, closed mail startup facts through the existing filter. */
export function forwardMailRelayDiagnostics(stderr:Readable|null|undefined,emit:(line:string)=>void){
  return forwardProfileDiagnostics([stderr],line=>{
    if(!line.startsWith(APP_LAUNCHER_DIAGNOSTIC_PREFIX))return;
    const value=JSON.parse(line.slice(APP_LAUNCHER_DIAGNOSTIC_PREFIX.length));
    if(value.mode==="mail"&&value.port===null
      &&(value.stage==="runtime-proof"||value.stage==="mail-relay"))emit(line);
  });
}
