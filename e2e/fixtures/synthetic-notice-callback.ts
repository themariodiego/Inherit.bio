import {createHmac,randomUUID} from "node:crypto";
import {z} from "zod";

/** Software fixture only. This key is generated for the current isolated
 * launcher run and exists in inherited process memory, never this source. */
export function syntheticDeliveredCallback(messageId:string,now=new Date()){
  if(!z.uuid().safeParse(messageId).success||!Number.isFinite(now.getTime()))throw new Error("Synthetic callback unavailable");
  const secret=process.env.INHERIT_CI_SYNTHETIC_WEBHOOK_SECRET;
  if(typeof secret!=="string"||!/^whsec_[A-Za-z0-9+/]{43}=$/u.test(secret))throw new Error("Synthetic callback unavailable");
  const id=`synthetic-keyless-${randomUUID()}`,timestamp=String(Math.floor(now.getTime()/1000));
  const payload=JSON.stringify({type:"email.delivered",created_at:now.toISOString(),data:{email_id:messageId}});
  const key=Buffer.from(secret.slice(6),"base64");
  try{return {payload,headers:{"content-type":"application/json","svix-id":id,"svix-timestamp":timestamp,
    "svix-signature":`v1,${createHmac("sha256",key).update(`${id}.${timestamp}.${payload}`).digest("base64")}`}};}
  finally{key.fill(0);}
}
