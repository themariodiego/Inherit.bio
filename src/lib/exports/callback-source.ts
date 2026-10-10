import "server-only";

/** Adapt an existing awaited callback reader without accumulating its complete
 * source. At most one bounded chunk is retained. Producing the next chunk waits
 * for the consumer to resume; cancellation aborts the actual source reader and
 * releases an outstanding callback. A rejected producer always reaches EOF as
 * an error, never as successful partial content. */
export async function* callbackSource<T>(signal:AbortSignal,
 produce:(emit:(value:T)=>Promise<void>,current:AbortSignal)=>Promise<void>):AsyncGenerator<T>{
 const stop=new AbortController(),current=AbortSignal.any([signal,stop.signal]);
 let pending:{value:T;resume:()=>void;reject:(error:Error)=>void}|undefined;
 let ended=false,failed=false,failure:unknown,wake=()=>{};
 const unavailable=()=>new Error("account_archive_source_unavailable");
 const abort=()=>{failed=true;failure=unavailable();ended=true;pending?.reject(unavailable());wake();};
 current.addEventListener("abort",abort,{once:true});
 const work=Promise.resolve().then(async()=>{
  if(current.aborted)throw unavailable();
  await produce(value=>{
   if(current.aborted||pending||ended)return Promise.reject(unavailable());
   return new Promise<void>((resume,reject)=>{pending={value,resume,reject};wake();});
  },current);
 }).then(()=>{ended=true;wake();},error=>{failed=true;failure=error;ended=true;wake();});
 try{for(;;){
  if(current.aborted)throw unavailable();if(failed)throw failure??unavailable();
  if(pending){const selected=pending;
   yield selected.value;
   if(current.aborted)throw unavailable();pending=undefined;selected.resume();continue;
  }
  if(ended)return;
  await new Promise<void>(resolve=>{wake=resolve;});
 }}finally{
  stop.abort();pending?.reject(unavailable());pending=undefined;
  current.removeEventListener("abort",abort);void work.catch(()=>{});
 }
}
