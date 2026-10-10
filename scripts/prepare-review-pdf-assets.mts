import {createRequire} from "node:module";
import {cp,mkdir,readFile,readdir,rm,stat,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";

const version="6.3.289";
const require=createRequire(import.meta.url);
const source=dirname(require.resolve("pdfjs-dist/package.json"));
const metadata=JSON.parse(await readFile(join(source,"package.json"),"utf8")) as {version:string};
if(metadata.version!==version)throw new Error("Review PDF dependency version differs");
const target=join(process.cwd(),"public","review-document-assets",version);
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
for(const name of ["pdf.mjs","pdf.worker.min.mjs"])await cp(join(source,"build",name),join(target,name));
const manifest:Record<string,Record<string,number>>={};
for(const [kind,directory] of [["cMapUrl","cmaps"],["standardFontDataUrl","standard_fonts"],["wasmUrl","wasm"]]) {
  await cp(join(source,directory),join(target,directory),{recursive:true});
  manifest[kind]={};
  for(const name of (await readdir(join(source,directory))).sort()) {
    const info=await stat(join(source,directory,name));
    if(info.isFile())manifest[kind][name]=info.size;
  }
}
await cp(join(source,"iccs"),join(target,"iccs"),{recursive:true});
await cp(join(source,"LICENSE"),join(target,"LICENSE"));
await writeFile(join(target,"manifest.json"),JSON.stringify(manifest));
// Only this private worker's diagnostics are suppressed. The application console
// is untouched; a document error is reported to the UI through a closed code.
await writeFile(join(target,"review-worker.mjs"),`for (const method of ["debug","info","log","warn","error"]) console[method]=()=>{};
addEventListener("unhandledrejection",event=>event.preventDefault());
await import("./pdf.worker.min.mjs");
postMessage({reviewPdfWorkerReady:true});
`);
