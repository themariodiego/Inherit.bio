import {describe,expect,it,vi} from "vitest";
import {completePdfPages,pdfAssetFactory,pdfViewport} from "./review-pdf";

describe("complete inert PDF view",()=>{
  it("requires every valid page and rejects missing, substituted or excessive pages",()=>{
    expect(completePdfPages(2,new Set([1]))).toBe(false);
    expect(completePdfPages(2,new Set([1,3]))).toBe(false);
    expect(completePdfPages(2,new Set([1,2]))).toBe(true);
    expect(completePdfPages(0,new Set())).toBe(false);
    expect(completePdfPages(201,new Set(Array.from({length:201},(_,n)=>n+1)))).toBe(false);
  });
  it("shows the entire page proportionally and refuses oversized or invalid canvases",()=>{
    expect(pdfViewport(300,450)).toEqual({width:640,height:960,scale:640/300});
    expect(pdfViewport(300,450,2)).toEqual({width:1280,height:1920,scale:1280/300});
    for(const dimensions of [[0,1],[1,NaN],[1,Infinity],[1,100000]])expect(()=>pdfViewport(...dimensions as [number,number])).toThrow("The document could not be shown.");
    expect(()=>pdfViewport(1,1,4)).toThrow();
  });
  it("never sends document-selected or traversed asset names to a network or log",async()=>{
    const request=vi.fn();const Factory=pdfAssetFactory({cMapUrl:{"known.bcmap":2},standardFontDataUrl:{},wasmUrl:{}},request);
    const factory=new Factory();
    for(const value of [{kind:"cMapUrl",filename:"private-name.bcmap"},{kind:"cMapUrl",filename:"../known.bcmap"},
      {kind:"cMapUrl",filename:"https://outside.example/identity"},{kind:"__proto__",filename:"known.bcmap"}]) {
      await expect(factory.fetch(value)).rejects.toThrow("The document could not be shown.");
    }
    expect(request).not.toHaveBeenCalled();
  });
  it("loads only exact local packaged bytes without credentials or a referrer",async()=>{
    const request=vi.fn().mockResolvedValue(new Response(new Uint8Array([1,2])));
    const Factory=pdfAssetFactory({cMapUrl:{"known.bcmap":2},standardFontDataUrl:{},wasmUrl:{}},request);
    expect(await new Factory().fetch({kind:"cMapUrl",filename:"known.bcmap"})).toEqual(new Uint8Array([1,2]));
    expect(request).toHaveBeenCalledWith("/review-document-assets/6.3.289/cmaps/known.bcmap",{credentials:"omit",referrerPolicy:"no-referrer",signal:expect.any(AbortSignal)});
    request.mockResolvedValue(new Response(new Uint8Array([1])));
    await expect(new Factory().fetch({kind:"cMapUrl",filename:"known.bcmap"})).rejects.toThrow("The document could not be shown.");
  });
  it("refuses invalid asset sizes and names before making a request",async()=>{
    const request=vi.fn();
    for(const [filename,size] of [["known.bcmap",0],["known.bcmap",4_000_001],["../known.bcmap",2],["known.bcmap",NaN]] as const) {
      const Factory=pdfAssetFactory({cMapUrl:{[filename]:size},standardFontDataUrl:{},wasmUrl:{}},request);
      await expect(new Factory().fetch({kind:"cMapUrl",filename})).rejects.toThrow("The document could not be shown.");
    }
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds an unresponsive local asset and aborts its request",async()=>{
    vi.useFakeTimers();let signal:AbortSignal|undefined;
    const request=vi.fn((_url:unknown,options?:RequestInit)=>{signal=options?.signal as AbortSignal;return new Promise<Response>(()=>{});});
    try {
      const Factory=pdfAssetFactory({cMapUrl:{"known.bcmap":2},standardFontDataUrl:{},wasmUrl:{}},request);
      const refusal=expect(new Factory().fetch({kind:"cMapUrl",filename:"known.bcmap"})).rejects.toThrow("The document could not be shown.");
      await vi.advanceTimersByTimeAsync(20_000);await refusal;expect(signal?.aborted).toBe(true);
    } finally {vi.useRealTimers();}
  });
});
