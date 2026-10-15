/** Browser transport: acknowledge only after every exact chunk and the full digest arrive. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEX=/^[0-9a-f]{64}$/u;
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",Uint8Array.from(bytes)))].map(b=>b.toString(16).padStart(2,"0")).join("");
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).sort().join("|")===keys.slice().sort().join("|");
export async function readReviewDocument(documentId:string,openNonce:string,reviewCsrf:string,signal?:AbortSignal):Promise<{bytes:Uint8Array;filename:string}> {
  if (!UUID.test(documentId)) throw new Error("Document unavailable");
  const assertActive=()=>{if(signal?.aborted)throw new Error("Document read canceled");};
  assertActive();
  const init=await fetch(`/api/legal-evidence/${documentId}/review-download`,{credentials:"same-origin",signal});
  const descriptor:unknown=await init.json();
  if(init.status!==200||!exact(descriptor,["session","filename","sizeBytes","sha256","chunkBytes","chunkCount","chunkRoute"])
    ||typeof descriptor.session!=="string"||!UUID.test(descriptor.session)||typeof descriptor.filename!=="string"
    ||typeof descriptor.sha256!=="string"||!HEX.test(descriptor.sha256)||descriptor.chunkBytes!==4_000_000
    ||!Number.isInteger(descriptor.sizeBytes)||Number(descriptor.sizeBytes)<1||Number(descriptor.sizeBytes)>20_000_000
    ||descriptor.chunkCount!==Math.ceil(Number(descriptor.sizeBytes)/4_000_000)
    ||descriptor.chunkRoute!==`/api/downloads/${descriptor.session}/chunks/{sequence}`)throw new Error("Document unavailable");
  assertActive();
  const opened=await fetch(`/api/downloads/${descriptor.session}/receipt`,{method:"POST",credentials:"same-origin",signal,
    headers:{"content-type":"application/json","x-inherit-csrf":reviewCsrf},body:JSON.stringify({nonce:openNonce})});
  const receipt:unknown=await opened.json();
  const csrf=opened.headers.get("x-inherit-csrf");
  if(opened.status!==201||!csrf||!HEX.test(csrf)||!exact(receipt,["session","chunks"])||receipt.session!==descriptor.session
    ||!Array.isArray(receipt.chunks)||receipt.chunks.length!==descriptor.chunkCount)throw new Error("Document unavailable");
  const chunks:Uint8Array[]=[];
  const proofs:Array<{proof:string;nonce:string}>=[];
  let bytes:Uint8Array|undefined;
  try {
    for(let sequence=0;sequence<receipt.chunks.length;sequence++) {
      assertActive();
      const item:unknown=receipt.chunks[sequence];
      if(!exact(item,["sequence","challenge","nonce"])||item.sequence!==sequence||typeof item.challenge!=="string"
        ||!HEX.test(item.challenge)||typeof item.nonce!=="string"||item.nonce.length<1||item.nonce.length>2048)throw new Error("Document unavailable");
      const response=await fetch(`/api/downloads/${descriptor.session}/chunks/${sequence}`,{credentials:"same-origin",signal});
      if(response.status!==200||response.headers.get("content-type")!=="application/octet-stream"
        ||response.headers.get("content-encoding")!=="identity")throw new Error("Document unavailable");
      const chunk=new Uint8Array(await response.arrayBuffer());
      chunks.push(chunk);
      const expected=Math.min(4_000_000,Number(descriptor.sizeBytes)-sequence*4_000_000);
      if(chunk.length!==expected||response.headers.get("content-length")!==String(expected))throw new Error("Document incomplete");
      assertActive();
      const challenged=new Uint8Array(32+chunk.length);
      challenged.set(Uint8Array.from(item.challenge.match(/../gu)!,byte=>parseInt(byte,16)));
      challenged.set(chunk,32);
      try {proofs.push({proof:await hash(challenged),nonce:item.nonce});}finally{challenged.fill(0);}
    }
    bytes=new Uint8Array(Number(descriptor.sizeBytes));
    let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(await hash(bytes)!==descriptor.sha256)throw new Error("Document integrity check failed");
    for(let sequence=0;sequence<proofs.length;sequence++) {
      assertActive();
      const settled=await fetch(`/api/downloads/${descriptor.session}/chunks/${sequence}/acknowledge`,{
        method:"POST",credentials:"same-origin",signal,headers:{"content-type":"application/json","x-inherit-csrf":csrf},body:JSON.stringify(proofs[sequence]),
      });
      if(settled.status!==204||(await settled.arrayBuffer()).byteLength!==0)throw new Error("Document receipt unavailable");
    }
    assertActive();
    return {bytes,filename:descriptor.filename};
  } catch(error) {bytes?.fill(0);throw error;} finally {for(const chunk of chunks)chunk.fill(0);}
}
