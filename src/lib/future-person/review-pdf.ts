import type {PDFDocumentProxy,PDFDocumentLoadingTask,PDFWorker,RenderTask} from "pdfjs-dist";

const BASE="/review-document-assets/6.3.289/";
const DIRECTORY={cMapUrl:"cmaps",standardFontDataUrl:"standard_fonts",wasmUrl:"wasm"} as const;
type AssetKind=keyof typeof DIRECTORY;
type Manifest=Record<AssetKind,Record<string,number>>;
const FAILURE="The document could not be shown.";
const MAX_PIXELS=16_000_000;
const MAX_PAGES=200;

export function completePdfPages(total:number,rendered:ReadonlySet<number>):boolean {
  if(!Number.isSafeInteger(total)||total<1||total>MAX_PAGES||rendered.size!==total)return false;
  for(let page=1;page<=total;page++)if(!rendered.has(page))return false;
  return true;
}

export function pdfViewport(width:number,height:number,zoom=1):{width:number;height:number;scale:number} {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||![1,2,3].includes(zoom))throw new Error(FAILURE);
  const scale=640/width*zoom;
  const scaled={width:Math.ceil(width*scale),height:Math.ceil(height*scale),scale};
  if(!Number.isSafeInteger(scaled.height)||scaled.width*scaled.height>MAX_PIXELS)throw new Error(FAILURE);
  return scaled;
}

export function pdfAssetFactory(manifest:Manifest,request:typeof fetch=fetch) {
  return class {
    async fetch({kind,filename}:{kind:string;filename:string}):Promise<Uint8Array> {
      if(!Object.hasOwn(DIRECTORY,kind)||typeof filename!=="string"||!Object.hasOwn(manifest[kind as AssetKind],filename))throw new Error(FAILURE);
      const size=manifest[kind as AssetKind][filename];
      if(!Number.isSafeInteger(size)||size<1||size>4_000_000||!/^[-A-Za-z0-9_.]+$/u.test(filename))throw new Error(FAILURE);
      const abort=new AbortController();
      try {
        const response=await bounded(request(`${BASE}${DIRECTORY[kind as AssetKind]}/${filename}`,{credentials:"omit",referrerPolicy:"no-referrer",signal:abort.signal}),abort.signal);
        if(response.status!==200)throw new Error(FAILURE);
        const bytes=new Uint8Array(await bounded(response.arrayBuffer(),abort.signal));
        if(bytes.length!==size){bytes.fill(0);throw new Error(FAILURE);}
        return bytes;
      } catch {throw new Error(FAILURE);}
      finally {abort.abort();}
    }
  };
}

function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
  return new Promise((resolve,reject)=>{
    const fail=()=>{clear();reject(new Error(FAILURE));};
    const timer=setTimeout(fail,20_000);
    signal.addEventListener("abort",fail,{once:true});
    const clear=()=>{clearTimeout(timer);signal.removeEventListener("abort",fail);};
    promise.then(value=>{clear();if(signal.aborted)fail();else resolve(value);},fail);
    if(signal.aborted){clear();fail();}
  });
}

export type ReviewPdf={pages:number;render:(canvas:HTMLCanvasElement,page:number,zoom:number,signal:AbortSignal)=>Promise<void>;close:()=>void};

/** Inert canvas only: no annotation HTML, links, actions, scripting manager or remote document URL. */
export async function openReviewPdf(url:string,signal:AbortSignal):Promise<ReviewPdf> {
  let port:Worker|undefined,worker:PDFWorker|undefined,loading:PDFDocumentLoadingTask|undefined,document:PDFDocumentProxy|undefined;
  let render:RenderTask|undefined;let bytes:Uint8Array|undefined;let closed=false;
  const close=()=>{closed=true;render?.cancel();if(bytes?.byteLength)bytes.fill(0);void loading?.destroy().catch(()=>{});worker?.destroy();port?.terminate();};
  signal.addEventListener("abort",close,{once:true});
  try {
    const moduleUrl=BASE+"pdf.mjs";
    const pdf=await bounded(import(/* webpackIgnore: true */ /* turbopackIgnore: true */ moduleUrl) as Promise<typeof import("pdfjs-dist")>,signal);
    const manifestResponse=await bounded(fetch(BASE+"manifest.json",{credentials:"omit",referrerPolicy:"no-referrer",signal}),signal);
    if(manifestResponse.status!==200)throw new Error(FAILURE);
    const manifest=await bounded(manifestResponse.json() as Promise<Manifest>,signal);
    for(const kind of Object.keys(DIRECTORY) as AssetKind[])if(!manifest[kind]||typeof manifest[kind]!=="object")throw new Error(FAILURE);
    const response=await bounded(fetch(url,{credentials:"omit",referrerPolicy:"no-referrer",signal}),signal);
    if(response.status!==200)throw new Error(FAILURE);
    bytes=new Uint8Array(await bounded(response.arrayBuffer(),signal));
    if(bytes.length<1||bytes.length>20_000_000)throw new Error(FAILURE);
    port=new Worker(BASE+"review-worker.mjs",{type:"module",credentials:"omit"});
    port.addEventListener("error",event=>{event.preventDefault();close();});
    const readyPort=port;
    let readyListener:(event:MessageEvent)=>void=()=>{};let errorListener:()=>void=()=>{};
    try {
      await bounded(new Promise<void>((resolve,reject)=>{
        readyListener=event=>{if(event.data?.reviewPdfWorkerReady===true)resolve();};
        errorListener=()=>reject(new Error(FAILURE));
        readyPort.addEventListener("message",readyListener);readyPort.addEventListener("error",errorListener);
      }),signal);
    } finally {readyPort.removeEventListener("message",readyListener);readyPort.removeEventListener("error",errorListener);}
    if(closed)throw new Error(FAILURE);
    worker=pdf.PDFWorker.create({port,verbosity:0});
    loading=pdf.getDocument({data:bytes,worker,verbosity:0,stopAtErrors:true,enableXfa:false,
      disableRange:true,disableStream:true,disableAutoFetch:true,disableFontFace:true,useSystemFonts:false,
      isOffscreenCanvasSupported:false,isImageDecoderSupported:false,canvasMaxAreaInBytes:MAX_PIXELS*4,
      cMapUrl:BASE+"cmaps/",cMapPacked:true,standardFontDataUrl:BASE+"standard_fonts/",wasmUrl:BASE+"wasm/",iccUrl:BASE+"iccs/",
      useWorkerFetch:false,BinaryDataFactory:pdfAssetFactory(manifest)});
    document=await bounded(loading.promise,signal);
    if(closed||!Number.isSafeInteger(document.numPages)||document.numPages<1||document.numPages>MAX_PAGES)throw new Error(FAILURE);
    const loaded=document;
    return {pages:loaded.numPages,close:()=>{signal.removeEventListener("abort",close);close();},render:async(canvas,page,zoom,renderSignal)=>{
      if(closed||!Number.isInteger(page)||page<1||page>loaded.numPages)throw new Error(FAILURE);
      render?.cancel();
      const current=await bounded(loaded.getPage(page),renderSignal);
      const natural=current.getViewport({scale:1});const viewport=pdfViewport(natural.width,natural.height,zoom);
      const context=canvas.getContext("2d",{alpha:false,willReadFrequently:true});if(!context)throw new Error(FAILURE);
      canvas.width=viewport.width;canvas.height=viewport.height;
      render=current.render({canvas,canvasContext:context,viewport:current.getViewport({scale:viewport.scale}),background:"white"});
      const cancel=()=>render?.cancel();renderSignal.addEventListener("abort",cancel,{once:true});
      try {await bounded(render.promise,renderSignal);if(closed)throw new Error(FAILURE);}
      finally{renderSignal.removeEventListener("abort",cancel);current.cleanup();}
    }};
  } catch {close();signal.removeEventListener("abort",close);throw new Error(FAILURE);}
}
