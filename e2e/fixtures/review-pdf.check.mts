/** Real local rendering proof. Prepare assets, bundle browser entry with esbuild,
 * then run this file with tsx; no app, database or document persistence. */
import assert from "node:assert/strict";
import http from "node:http";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createRequire} from "node:module";
import {chromium,expect} from "@playwright/test";
import {reviewPdf} from "./review-documents";

const diagnostics:string[]=[];const requests:string[]=[];
const require=createRequire(import.meta.url);const fromTsx=createRequire(require.resolve("tsx/package.json"));
const temporary=await mkdtemp(join(tmpdir(),"review-pdf-proof-"));
const bundle=join(temporary,"proof.js");
await fromTsx("esbuild").build({entryPoints:["e2e/fixtures/review-pdf-browser.tsx"],bundle:true,platform:"browser",format:"esm",jsx:"automatic",
  define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},outfile:bundle});
const server=http.createServer(async(request,response)=>{
  const url=request.url??"";requests.push(url);
  if(url==="/"){response.setHeader("content-type","text/html");response.end('<!doctype html><title>Local document proof</title><link rel="icon" href="data:,"><script type="module" src="/proof.js"></script>');return;}
  if(url==="/proof.js"){response.setHeader("content-type","text/javascript");response.end(await readFile(bundle));return;}
  if(!/^\/review-document-assets\/6\.3\.289\/[-A-Za-z0-9_./]+$/u.test(url)||url.includes("..")){response.writeHead(404);response.end();return;}
  try {const bytes=await readFile(join(process.cwd(),"public",url));
    response.setHeader("content-type",url.endsWith(".mjs")?"text/javascript":url.endsWith(".json")?"application/json":"application/octet-stream");response.end(bytes);
  } catch {response.writeHead(404);response.end();}
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();assert(address&&typeof address!=="string");
const origin=`http://127.0.0.1:${address.port}`;const browser=await chromium.launch();
try {
  const page=await browser.newPage();let external=0;
  await page.addInitScript(()=>{
    const Native=window.Worker;const ended=new WeakSet<Worker>();
    const counts={started:0,ended:0};Object.assign(window,{pdfWorkerCounts:counts});
    window.Worker=class extends Native {
      constructor(url:string|URL,options?:WorkerOptions){super(url,options);counts.started++;}
      terminate(){if(!ended.has(this)){ended.add(this);counts.ended++;}super.terminate();}
    };
  });
  page.on("console",message=>diagnostics.push(message.text()));page.on("pageerror",error=>diagnostics.push(error.message));
  await page.route("https://outside.example/**",route=>{external++;return route.abort();});
  await page.goto(origin);
  try {await page.waitForFunction(()=>"startPdfFixture" in window);}catch{throw new Error(`Synthetic fixture bootstrap failed: ${JSON.stringify(diagnostics)}`);}
  await page.evaluate(bytes=>(window as unknown as {startPdfFixture:(bytes:number[])=>void}).startPdfFixture(bytes),Array.from(reviewPdf()));
  const canvas=page.getByRole("img",{name:"Synthetic paper, page 1",exact:true});
  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");
  await expect(canvas).toBeVisible();await expect(page.getByRole("checkbox")).toHaveCount(0);
  assert.deepEqual(await canvas.evaluate(element=>{
    const target=element as HTMLCanvasElement;return {width:target.width,height:target.height,pixel:Array.from(target.getContext("2d")!.getImageData(200,600,1,1).data)};
  }),{width:640,height:832,pixel:[255,0,0,255]});
  await page.getByRole("button",{name:"Go on",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Page 2 of 2");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  assert.deepEqual(await page.getByRole("img").evaluate(element=>Array.from((element as HTMLCanvasElement).getContext("2d")!.getImageData(200,600,1,1).data)),[0,0,255,255]);
  await page.getByRole("button",{name:"Zoom in",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Page 2 of 2");
  await expect.poll(()=>page.getByRole("img").evaluate(element=>({width:(element as HTMLCanvasElement).width,height:(element as HTMLCanvasElement).height})))
    .toEqual({width:1280,height:1664});
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  assert.equal(await page.evaluate(()=>"__documentScriptExecuted" in window),false);
  assert.equal(external,0);assert.equal(requests.some(url=>url.includes("synthetic-private-name")),false);
  await page.evaluate(()=>(window as unknown as {closePdfFixture:()=>void}).closePdfFixture());
  await expect(page.getByRole("img")).toHaveCount(0);await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.evaluate(()=>(window as unknown as {startPdfFixture:(bytes:number[])=>void}).startPdfFixture([1,2,3,4]));
  await expect(page.getByText("The file could not be shown. Reload this page before trying again.",{exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {pdfWorkerCounts:{started:number;ended:number}}).pdfWorkerCounts)).toEqual({started:2,ended:2});
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let stopped=0;
  await page.route("**/review-worker.mjs",async route=>{stopped++;await held;await route.abort("aborted");});
  await page.evaluate(bytes=>(window as unknown as {startPdfFixture:(bytes:number[])=>void}).startPdfFixture(bytes),Array.from(reviewPdf()));
  await expect.poll(()=>stopped).toBe(1);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.evaluate(()=>(window as unknown as {closePdfFixture:()=>void}).closePdfFixture());
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {pdfWorkerCounts:{started:number;ended:number}}).pdfWorkerCounts)).toEqual({started:3,ended:3});
  release();await page.unroute("**/review-worker.mjs");
  await expect(page.getByRole("img")).toHaveCount(0);await expect(page.getByRole("checkbox")).toHaveCount(0);
  for(const format of ["png","jpeg"] as const) {
    await page.evaluate(format=>(window as unknown as {startImageFixture:(format:string)=>Promise<void>}).startImageFixture(format),format);
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    assert.deepEqual(await page.getByRole("img").evaluate(image=>({width:(image as HTMLImageElement).naturalWidth,height:(image as HTMLImageElement).naturalHeight})),{width:3,height:2});
  }
  await page.evaluate(()=>(window as unknown as {startImageFixture:(format:string)=>Promise<void>}).startImageFixture("invalid"));
  await expect(page.getByRole("status")).toHaveText("The image could not be shown.");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  assert.deepEqual(diagnostics,[]);
  console.log("PASS inert document view: both PDF pages have exact nonblank pixels before human confirmation; full-page zoom; inert links/actions; no external requests or diagnostics; close, invalid bytes and canceled startup terminate every worker; native PNG/JPG decode before confirmation and invalid images refuse it.");
} finally {await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(temporary,{recursive:true,force:true});}
