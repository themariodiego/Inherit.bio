"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {requestAccountExport,type AccountExportControl} from "@/lib/exports/account-export-control";

export function AccountExport({control}:{control:AccountExportControl}){
 const [busy,setBusy]=useState(false),[used,setUsed]=useState(false),[exportId,setExportId]=useState<string|null>(null);
 const [message,setMessage]=useState<string|null>(null),active=useRef<AbortController|null>(null);
 const attempted=useRef(false);
 // A refresh may present a new proof, but never resets an attempted action in
 // this mounted control. Uncertain responses cannot trigger another create.
 useEffect(()=>()=>active.current?.abort(),[]);
 async function request(operation:"create"|"check"){
  if(busy||active.current||operation==="create"&&(attempted.current||!control.available))return;
  const stop=new AbortController();active.current=stop;setBusy(true);setMessage(null);
  if(operation==="create"){attempted.current=true;setUsed(true);}
  try{const result=await requestAccountExport({operation,control,expectedExportId:exportId,signal:stop.signal});
   if(!stop.signal.aborted){setExportId(result.exportId);setMessage("Your export is being prepared. Check its status here.");}
  }catch{if(!stop.signal.aborted)setMessage(operation==="create"
   ?"We could not confirm the request. Check its status before making a new request."
   :"We could not confirm its status. Reload this page and try again.");
  }finally{if(active.current===stop){active.current=null;setBusy(false);}stop.abort();}
 }
 return <div className="mt-4 space-y-3" data-slot="account-export-control">
  <Button type="button" variant="outline" disabled={!control.available||used||busy} onClick={()=>void request("create")}>Prepare complete export</Button>
  {!control.available?<p className="text-sm text-ink-muted">A complete export cannot be prepared right now.</p>:null}
  {used?<Button type="button" variant="outline" disabled={busy} onClick={()=>void request("check")}>{busy?"Checking…":"Check export status"}</Button>:null}
  {message?<p role="status" className="text-sm">{message}</p>:null}
 </div>;
}
