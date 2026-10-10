import "server-only";

import {z} from "zod";
import {claimDataKey,newWrappedDocumentKey,openDocumentBytes,sealDocumentBytes} from "./document-envelope";
import {verifiedDocumentIdentity} from "./review";

const normalizedText=z.string().max(640).transform(value=>value.normalize("NFC").trim().replace(/\s+/gu," "))
  .refine(value=>[...value].length>=2&&[...value].length<=160&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value));
const minimum=z.object({version:z.literal(1),verifiedName:normalizedText,
  verifiedDateOfBirth:z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  childPlaceOfBirth:normalizedText,parentNames:z.array(normalizedText).min(1).max(4),
}).strict();
const hash=z.string().regex(/^[0-9a-f]{64}$/u);
const scope=z.object({reviewId:z.uuid(),documentaryRevision:z.number().int().positive().safe(),
  photoDocumentId:z.uuid(),photoSha256:hash,birthDocumentId:z.uuid(),birthSha256:hash,
}).strict().refine(value=>value.photoDocumentId!==value.birthDocumentId);
export type NoticePackageScope=z.infer<typeof scope>;

function aad(binding:NoticePackageScope):string {
  return `future-person-notice-package-v1|${JSON.stringify(scope.parse(binding))}`;
}

/** The notice phase receives an independently erasable minimum comparison,
 * not a copy of the intake, candidate-search receipt or contact. */
export function sealNoticePackage(
  attestation:z.infer<typeof verifiedDocumentIdentity>,
  profile:{childDateOfBirth:string;childPlaceOfBirth:string;parentNames:string[]},
  binding:NoticePackageScope,
):{ciphertext:string;wrappedKey:string} {
  const human=verifiedDocumentIdentity.parse(attestation);
  if(profile.childDateOfBirth!==human.dateOfBirth)throw new Error("claim_package_unavailable");
  const fields=minimum.parse({version:1,verifiedName:human.fullName,verifiedDateOfBirth:human.dateOfBirth,
    childPlaceOfBirth:profile.childPlaceOfBirth,parentNames:profile.parentNames});
  const wrapped=newWrappedDocumentKey();let key:Buffer|undefined;const bytes=Buffer.from(JSON.stringify(fields),"utf8");
  try {
    key=claimDataKey(wrapped.toString("hex"));
    return {ciphertext:`\\x${sealDocumentBytes(key,aad(binding),bytes).toString("hex")}`,
      wrappedKey:`\\x${wrapped.toString("hex")}`};
  }finally{key?.fill(0);wrapped.fill(0);bytes.fill(0);}
}

/** Only an operation-authorized server reader may supply this exact scope.
 * A key or valid envelope alone grants no reviewer, owner or release right. */
export function openNoticePackage(ciphertext:string,wrappedKey:string,binding:NoticePackageScope)
  :z.infer<typeof minimum>|null {
  let key:Buffer|undefined;let bytes:Buffer|null=null;
  try {
    if(!/^[0-9a-f]{58,32768}$/u.test(ciphertext))return null;
    key=claimDataKey(wrappedKey);bytes=openDocumentBytes(key,aad(binding),Buffer.from(ciphertext,"hex"));
    if(!bytes)return null;
    const fields=minimum.safeParse(JSON.parse(bytes.toString("utf8")));
    if(!fields.success)return null;
    const adult=verifiedDocumentIdentity.safeParse({fullName:fields.data.verifiedName,
      dateOfBirth:fields.data.verifiedDateOfBirth,photoIdentityReviewed:true,birthRecordReviewed:true,adultAgeConfirmed:true});
    return adult.success?fields.data:null;
  }catch{return null;}finally{key?.fill(0);bytes?.fill(0);}
}
