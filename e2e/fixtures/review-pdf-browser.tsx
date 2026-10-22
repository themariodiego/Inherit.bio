import {useCallback,useState} from "react";
import {createRoot} from "react-dom/client";
import {ReviewPdfDocument} from "../../src/components/future-person/review-pdf";
import {ReviewDocumentView} from "../../src/components/future-person/claim-review";

function Proof({url}:{url:string}) {
  const [ready,setReady]=useState(false);const [failed,setFailed]=useState(false);
  const rendered=useCallback(()=>setReady(true),[]);
  const pending=useCallback(()=>setReady(false),[]);
  const failure=useCallback(()=>{setReady(false);setFailed(true);},[]);
  return <><ReviewPdfDocument url={url} title="Synthetic paper" onRendered={rendered} onPending={pending} onFailure={failure}/>
    {ready&&!failed&&<label><input type="checkbox"/>I read this file.</label>}</>;
}
function ImageProof({url,type}:{url:string;type:string}) {
  const [view,setView]=useState({url,type,ready:false,failed:false});
  const state=useCallback((_kind:unknown,ready:boolean,failed:boolean)=>setView(previous=>({...previous,ready,failed})),[]);
  return <><ReviewDocumentView kind="photo" view={view} onState={state}/>
    {view.ready&&!view.failed&&<label><input type="checkbox"/>I read this file.</label>}
    {view.failed&&<p role="status">The image could not be shown.</p>}</>;
}
const host=document.createElement("main");document.body.append(host);const root=createRoot(host);
let active:string|undefined;
Object.assign(window,{
  startPdfFixture:(bytes:number[])=>{if(active)URL.revokeObjectURL(active);active=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:"application/pdf"}));root.render(<Proof key={active} url={active}/>);},
  startImageFixture:async(format:"png"|"jpeg"|"invalid")=>{
    const canvas=document.createElement("canvas");canvas.width=3;canvas.height=2;canvas.getContext("2d")!.fillRect(0,0,3,2);
    const type=format==="jpeg"?"image/jpeg":"image/png";
    const blob=format==="invalid"?new Blob([new Uint8Array([1,2,3,4])],{type}):await new Promise<Blob>((resolve,reject)=>
      canvas.toBlob(value=>value?resolve(value):reject(new Error("Synthetic image unavailable")),type));
    canvas.width=0;canvas.height=0;if(active)URL.revokeObjectURL(active);active=URL.createObjectURL(blob);
    root.render(<ImageProof key={active} url={active} type={type}/>);
  },
  closePdfFixture:()=>{root.render(null);if(active)URL.revokeObjectURL(active);active=undefined;},
});
