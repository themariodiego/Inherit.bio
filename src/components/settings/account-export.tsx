"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {requestAccountExport,type AccountExportControl} from "@/lib/exports/account-export-control";
import {chooseAccountArchiveSink,downloadAccountArchive,type AccountArchiveDownloadSink} from "@/lib/exports/account-archive-download";

/** `route` selects one record's export (api.subject-export); the account
 * export is the default. The control and its proofs come from that route's
 * own server presentation. */
export function AccountExport({control,route}:{control:AccountExportControl;route?:string}){
 const open=control.available?control.open:undefined;
 const [busy,setBusy]=useState(false),[used,setUsed]=useState(!!open),[exportId,setExportId]=useState<string|null>(open?.exportId??null);
 const [message,setMessage]=useState<string|null>(null),active=useRef<AbortController|null>(null);
 const attempted=useRef(false);
 const opening=useRef(false);
 const [openingDisabled,setOpeningDisabled]=useState(false);
 // A refresh may present a new proof, but never resets an attempted action in
 // this mounted control. Uncertain responses cannot trigger another create.
 useEffect(()=>()=>active.current?.abort(),[]);
 async function request(operation:"create"|"check"){
  if(busy||active.current||operation==="create"&&(attempted.current||!control.available))return;
  const stop=new AbortController();active.current=stop;setBusy(true);setMessage(null);
  if(operation==="create"){attempted.current=true;setUsed(true);}
  try{const result=await requestAccountExport({operation,control,expectedExportId:exportId,signal:stop.signal,route});
   if(!stop.signal.aborted&&"exportId" in result){setExportId(result.exportId);setMessage(result.status==="ready"
    ?"Your export is ready. Reload this page to get its download action."
    :"Your export is being prepared. Check its status here.");}
  }catch{if(!stop.signal.aborted)setMessage(operation==="create"
   ?"We could not confirm the request. Check its status before making a new request."
   :"We could not confirm its status. Reload this page and try again.");
  }finally{if(active.current===stop){active.current=null;setBusy(false);}stop.abort();}
 }
 async function download(){
  if(busy||active.current||opening.current||!open||!control.available)return;
  opening.current=true;setOpeningDisabled(true);const stop=new AbortController();active.current=stop;setBusy(true);setMessage(null);
  let sink:AccountArchiveDownloadSink|undefined,handedToDownload=false;
  // The explicit click owns the file picker before any server action or fetch.
  const selected=chooseAccountArchiveSink();
  try{
   sink=await selected;if(stop.signal.aborted)throw new Error("account_export_unavailable");
   const result=await requestAccountExport({operation:"open-ready",control,expectedExportId:open.exportId,signal:stop.signal,route});
   if(!("session" in result))throw new Error("account_export_unavailable");
   handedToDownload=true;await downloadAccountArchive({download:result,sink,signal:stop.signal});
   if(!stop.signal.aborted)setMessage("Your complete export has been saved.");
  }catch{if(!stop.signal.aborted)setMessage("We could not confirm the complete download. Reload this page before trying again.");}
  finally{if(sink&&!handedToDownload){let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([sink.abort(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("account_export_unavailable")),5_000);})]);}
    catch{if(!stop.signal.aborted)setMessage("We could not confirm the partial file was discarded. Keep this download closed.");}
    finally{if(timer)clearTimeout(timer);}}
   if(active.current===stop){active.current=null;setBusy(false);}stop.abort();}
 }
 return <div className="mt-4 space-y-3" data-slot="account-export-control">
  <Button type="button" variant="outline" disabled={!control.available||used||busy} onClick={()=>void request("create")}>Prepare complete export</Button>
  {!control.available?<p className="text-sm text-ink-muted">A complete export cannot be prepared right now.</p>:null}
  {used?<Button type="button" variant="outline" disabled={busy} onClick={()=>void request("check")}>{busy?"Checking…":"Check export status"}</Button>:null}
  {open?<Button type="button" variant="outline" disabled={busy||openingDisabled} onClick={()=>void download()}>Save complete export</Button>:null}
  {message?<p role="status" className="text-sm">{message}</p>:null}
 </div>;
}
