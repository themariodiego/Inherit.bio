import "server-only";
import crypto from "node:crypto";

/** NEW case envelopes only. Preserve the existing AES-256-GCM layouts: a
 * 12-byte IV, 16-byte tag, then ciphertext. Deployment wrapping keeps the
 * original 44-byte canonical base64 representation of the independent 32-byte
 * key (72-byte wrapped package). Legacy document helpers remain byte-exact.
 * This code clears retained mutable copies; immutable environment strings,
 * crypto internals and platform memory require separate qualification. */
const unavailable=()=>new Error("new_case_key_unavailable");
const overhead=28;
function clear(bytes:Buffer|undefined){bytes?.fill(0);}
function deploymentKey(){
 const encoded=process.env.BYOK_ENCRYPTION_KEY;
 if(!encoded)throw unavailable();const key=Buffer.from(encoded,"base64");
 if(key.byteLength!==32){key.fill(0);throw unavailable();}return key;
}
// Encode/decode the 32-byte case key directly to/from a mutable ASCII buffer.
// The representation matches the original deployment wrapper; no raw key
// string is introduced on the NEW path.
const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeCaseKey(key:Buffer){
 if(key.byteLength!==32)throw unavailable();const encoded=Buffer.alloc(44);
 for(let offset=0,out=0;offset<32;offset+=3,out+=4){
  const count=Math.min(3,32-offset),word=(key[offset]!<<16)|((count>1?key[offset+1]!:0)<<8)|(count>2?key[offset+2]!:0);
  encoded[out]=alphabet.charCodeAt((word>>>18)&63);encoded[out+1]=alphabet.charCodeAt((word>>>12)&63);
  encoded[out+2]=count>1?alphabet.charCodeAt((word>>>6)&63):61;encoded[out+3]=count>2?alphabet.charCodeAt(word&63):61;
 }return encoded;
}
function decodeCaseKey(encoded:Buffer){
 let key:Buffer|undefined;
 try{
  if(encoded.byteLength!==44||encoded[43]!==61)throw unavailable();key=Buffer.alloc(32);
  let out=0;
  for(let at=0;at<44;at+=4){
   const values=[0,1,2,3].map(index=>at===40&&index===3?0:alphabet.indexOf(String.fromCharCode(encoded[at+index]!)));
   if(values.some(value=>value<0)||at===40&&(values[2]!&3)!==0)throw unavailable();
   const word=(values[0]!<<18)|(values[1]!<<12)|(values[2]!<<6)|values[3]!;
   key[out++]=(word>>>16)&255;if(out<32)key[out++]=(word>>>8)&255;if(out<32)key[out++]=word&255;
  }
  return key;
 }catch{clear(key);throw unavailable();}
}
function seal(key:Buffer,aad:string|undefined,bytes:Uint8Array){
 let iv:Buffer|undefined,aadBytes:Buffer|undefined,head:Buffer|undefined,tail:Buffer|undefined,tag:Buffer|undefined;
 try{
  if(key.byteLength!==32)throw unavailable();iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
  if(aad!==undefined){aadBytes=Buffer.from(aad,"utf8");cipher.setAAD(aadBytes);}
  head=cipher.update(bytes);tail=cipher.final();tag=cipher.getAuthTag();return Buffer.concat([iv,tag,head,tail]);
 }finally{clear(iv);clear(aadBytes);clear(head);clear(tail);clear(tag);}
}
function open(key:Buffer,aad:string|undefined,sealed:Uint8Array):Buffer|null{
 let aadBytes:Buffer|undefined,head:Buffer|undefined,tail:Buffer|undefined;
 if(key.byteLength!==32||sealed.byteLength<=overhead)return null;
 // A view does not introduce another ciphertext copy. The caller owns it.
 const blob=Buffer.from(sealed.buffer,sealed.byteOffset,sealed.byteLength);
 try{
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,blob.subarray(0,12));
  if(aad!==undefined){aadBytes=Buffer.from(aad,"utf8");decipher.setAAD(aadBytes);}
  decipher.setAuthTag(blob.subarray(12,overhead));
  head=decipher.update(blob.subarray(overhead));tail=decipher.final();return Buffer.concat([head,tail]);
 }catch{return null;}
 finally{clear(aadBytes);clear(head);clear(tail);}
}
export function newWrappedCaseKey(){
 let raw:Buffer|undefined,encoded:Buffer|undefined,master:Buffer|undefined;
 try{raw=crypto.randomBytes(32);encoded=encodeCaseKey(raw);master=deploymentKey();return seal(master,undefined,encoded);}
 finally{clear(raw);clear(encoded);clear(master);}
}
export function unwrapNewCaseKey(wrappedHex:string){
 let wrapped:Buffer|undefined,encoded:Buffer|undefined,master:Buffer|undefined;
 try{
  if(!/^[0-9a-f]{144}$/u.test(wrappedHex))throw unavailable();wrapped=Buffer.from(wrappedHex,"hex");master=deploymentKey();
  encoded=open(master,undefined,wrapped)??undefined;if(!encoded)throw unavailable();return decodeCaseKey(encoded);
 }finally{clear(wrapped);clear(encoded);clear(master);}
}
export const sealNewCaseBytes=(key:Buffer,aad:string,bytes:Uint8Array)=>seal(key,aad,bytes);
export const openNewCaseBytes=(key:Buffer,aad:string,sealed:Uint8Array)=>open(key,aad,sealed);
/** Same context-separated digest as the original shared helper, with explicit
 * ownership of the NEW path's decoded deployment key, sub-key and digest. */
export function newCaseHmac(value:string,context:string){
 let master:Buffer|undefined,subKey:Buffer|undefined,digest:Buffer|undefined;
 try{master=deploymentKey();subKey=crypto.createHmac("sha256",master).update(context,"utf8").digest();
  digest=crypto.createHmac("sha256",subKey).update(value,"utf8").digest();return digest.toString("hex");}
 finally{clear(master);clear(subKey);clear(digest);}
}
