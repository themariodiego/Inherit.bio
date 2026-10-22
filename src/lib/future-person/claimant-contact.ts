import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { decryptSecret,encryptSecret } from "@/lib/crypto";
import { claimDataKey,openDocumentBytes,sealDocumentBytes } from "./document-envelope";

const envelope=z.object({version:z.literal(2),contactId:z.uuid(),wrappedKey:z.string().regex(/^[0-9a-f]{58,512}$/u),
  sealedEmail:z.string().regex(/^[0-9a-f]{58,2048}$/u)}).strict();
const email=z.email().max(254);
/** Independently shreddable contact key, wrapped inside the contact blob. */
export function sealClaimantContact(contactId:string,address:string):string {
  z.uuid().parse(contactId);const normalized=email.parse(address);
  const key=crypto.randomBytes(32);const bytes=Buffer.from(normalized,"utf8");
  try {
    const sealedEmail=sealDocumentBytes(key,`claimant-contact-v1|${contactId}`,bytes).toString("hex");
    const wrappedKey=encryptSecret(key.toString("base64")).toString("hex");
    return `\\x${encryptSecret(JSON.stringify({version:2,contactId,wrappedKey,sealedEmail})).toString("hex")}`;
  } finally {key.fill(0);bytes.fill(0);}
}
/** Existing contact blobs remain compatible; malformed envelopes fail closed. */
export function openMailContact(ciphertext:Uint8Array):string {
  if(ciphertext.byteLength>16384)throw new Error("mail_contact_unavailable");
  const text=decryptSecret(Buffer.from(ciphertext));
  if(!text.startsWith("{"))return email.parse(text);
  const parsed=envelope.parse(JSON.parse(text));let key:Buffer|undefined;let bytes:Buffer|null=null;
  try {
    key=claimDataKey(parsed.wrappedKey);
    bytes=openDocumentBytes(key,`claimant-contact-v1|${parsed.contactId}`,Buffer.from(parsed.sealedEmail,"hex"));
    if(!bytes)throw new Error("mail_contact_unavailable");
    return email.parse(bytes.toString("utf8"));
  } finally {key?.fill(0);bytes?.fill(0);}
}
