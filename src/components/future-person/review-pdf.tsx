"use client";

import {useEffect,useRef,useState} from "react";
import {completePdfPages,openReviewPdf,type ReviewPdf} from "@/lib/future-person/review-pdf";

export function ReviewPdfDocument({url,title,onRendered,onPending,onFailure}:{url:string;title:string;onRendered:()=>void;onPending:()=>void;onFailure:()=>void}) {
  const canvas=useRef<HTMLCanvasElement>(null);const controller=useRef<ReviewPdf|null>(null);
  const visited=useRef(new Set<number>());const [pages,setPages]=useState(0);const [page,setPage]=useState(1);const [zoom,setZoom]=useState(1);
  const [busy,setBusy]=useState(true);const [failed,setFailed]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();
    void openReviewPdf(url,abort.signal).then(pdf=>{if(abort.signal.aborted){pdf.close();return;}controller.current=pdf;setPages(pdf.pages);})
      .catch(()=>{if(!abort.signal.aborted){setFailed(true);setBusy(false);onFailure();}});
    return ()=>{abort.abort();controller.current?.close();controller.current=null;};
  },[url,onFailure]);
  useEffect(()=>{
    if(!pages||!controller.current||!canvas.current)return;
    const abort=new AbortController();
    void controller.current.render(canvas.current,page,zoom,abort.signal).then(()=>{
      if(abort.signal.aborted)return;visited.current.add(page);setBusy(false);
      if(completePdfPages(pages,visited.current))onRendered();
    }).catch(()=>{if(!abort.signal.aborted){setFailed(true);setBusy(false);onFailure();controller.current?.close();}});
    return ()=>abort.abort();
  },[pages,page,zoom,onRendered,onFailure]);
  useEffect(()=>{const element=canvas.current;return ()=>{if(element){element.width=0;element.height=0;}};},[]);
  const changePage=(next:number)=>{setBusy(true);onPending();setPage(next);};
  const changeZoom=(next:number)=>{setBusy(true);onPending();setZoom(next);};
  return <section aria-label={title} aria-busy={busy} className="space-y-3">
    {failed?<p>The file could not be shown. Reload this page before trying again.</p>:<>
      <p role="status">{busy?"Reading page…":`Page ${page} of ${pages}`}</p>
      <div role="region" aria-label={`${title}, page ${page} view`} tabIndex={0} className="max-h-[40rem] overflow-auto rounded border bg-white focus-visible:outline-2 focus-visible:outline-offset-2"><canvas ref={canvas} role="img" aria-label={`${title}, page ${page}`} className={busy?"invisible":"block"}/></div>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy||page<=1} onClick={()=>changePage(page-1)}>Go back</button>
        <button type="button" disabled={busy||page>=pages} onClick={()=>changePage(page+1)}>Go on</button>
        <button type="button" disabled={busy||zoom<=1} onClick={()=>changeZoom(zoom-1)}>Zoom out</button>
        <button type="button" disabled={busy||zoom>=3} onClick={()=>changeZoom(zoom+1)}>Zoom in</button>
      </div>
      <p>Open each page before marking this file as read. Use the page size buttons to read small text.</p>
    </>}
  </section>;
}
