import "server-only";
const held=()=>new Error("statement_runtime_disposition_held");
/** A native buffers-zeroed ACK follows the actual owned task graph. Closing
 * stops producer admission; cleanup remains admissible while tasks unwind.
 * No timeout, lease expiry or counter decrement proves byte disposition.
 * Immutable strings/platform/provider copies need their separate evidence. */
export function createRequesterStatementRuntime(){
 const tasks=new Set<Promise<unknown>>(),buffers=new Set<Uint8Array>();
 let closing=false,settled=false,cleanupFailed=false,proofExpired=false,settlementDeadline:number|undefined;
 function clear(bytes:Uint8Array){
  try{bytes.fill(0);if(bytes.some(byte=>byte!==0))throw held();buffers.delete(bytes);}
  catch{cleanupFailed=true;throw held();}
 }
 function owned<T>(label:string,work:()=>PromiseLike<T>|T,cleanup:boolean):Promise<T>{
  if(!label||settled||closing&&!cleanup)throw held();
  // Register before invoking work, including synchronous throw/outer races.
  const task=Promise.resolve().then(work).catch(error=>{if(cleanup)cleanupFailed=true;throw error;});
  const tracked=task.finally(()=>tasks.delete(tracked));tasks.add(tracked);
  void tracked.catch(()=>{});return tracked;
 }
 return Object.freeze({
  track<T>(label:string,work:()=>PromiseLike<T>|T){return owned(label,work,false);},
  cleanup<T>(label:string,work:()=>PromiseLike<T>|T){return owned(label,work,true);},
  own<T extends Uint8Array>(bytes:T):T{if(settled||!(bytes instanceof Uint8Array))throw held();buffers.add(bytes);return bytes;},
  clear,
  async wait<T>(pending:PromiseLike<T>,originalDeadline:number):Promise<T>{
   const remaining=Math.min(30_000,originalDeadline-Date.now());
   if(!Number.isSafeInteger(originalDeadline)||remaining<=0){proofExpired=true;throw held();}
   let timer:ReturnType<typeof setTimeout>|undefined;
   const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{proofExpired=true;reject(held());},remaining);timer.unref();});
   try{return await Promise.race([pending,expired]);}finally{clearTimeout(timer);}
  },
  /** Bound the caller, not disposal. If the race expires, actual cleanup
   * continues tracked and the caller cannot issue the native ACK. */
  async settle(originalDeadline:number){
   if(settlementDeadline!==undefined&&originalDeadline!==settlementDeadline)throw held();settlementDeadline=originalDeadline;
   closing=true;
   const actual=(async()=>{
    while(tasks.size)await Promise.allSettled([...tasks]);
    for(const bytes of [...buffers])clear(bytes);
    if(cleanupFailed||tasks.size||buffers.size)throw held();settled=true;
   })();
   let timer:ReturnType<typeof setTimeout>|undefined;
   const remaining=Math.min(30_000,originalDeadline-Date.now());
   if(!Number.isSafeInteger(originalDeadline)||remaining<=0){proofExpired=true;void actual.catch(()=>{});throw held();}
   const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{proofExpired=true;reject(held());},remaining);timer.unref();});
   try{await Promise.race([actual,expired]);}finally{clearTimeout(timer);}
  },
  assertSettled(){if(!settled||tasks.size||buffers.size||cleanupFailed||proofExpired)throw held();},
 });
}
export type RequesterStatementRuntime=ReturnType<typeof createRequesterStatementRuntime>;
