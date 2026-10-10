import "server-only";
import type {AccountExportActor} from "./account-export-session";
import {accountArchiveReadySchema,type TestAccountArchiveReady} from "./account-archive-test-publication";
import {ACCOUNT_ARCHIVE_CHUNK_BYTES,ACCOUNT_ARCHIVE_FILENAME,accountExportReady} from "./account-export-delivery-contract";

/** Trusted TEST composition only. The ready reader must hold the actual native
 * cookie/session/source authority; status alone supplies no delivery proof.
 * Ordinary production dependencies never select this capability. */
export type AccountExportDeliveryCapability=Readonly<{
 assertReady(signal:AbortSignal):Promise<void>;
 ready(input:{actor:AccountExportActor;exportId:string;exportCookieHash:string},signal:AbortSignal):Promise<unknown>;
}>;
const unavailable=()=>new Error("account_export_delivery_unavailable");
export async function currentAccountExportReady(options:{delivery:AccountExportDeliveryCapability;
 actor:AccountExportActor;exportId:string;exportCookieHash:string;signal:AbortSignal}):Promise<TestAccountArchiveReady>{
 if(options.signal.aborted)throw unavailable();
 await options.delivery.assertReady(options.signal);
 const value=accountArchiveReadySchema.parse(await options.delivery.ready({actor:options.actor,
  exportId:options.exportId,exportCookieHash:options.exportCookieHash},options.signal));
 if(options.signal.aborted||value.exportId!==options.exportId||Date.parse(value.expiresAt)<=Date.now()
  ||value.segmentCount!==Math.ceil(value.sizeBytes/ACCOUNT_ARCHIVE_CHUNK_BYTES)
  ||value.pageCount!==Math.ceil(value.segmentCount/128))throw unavailable();
 return value;
}
export function publicAccountExportReady(value:TestAccountArchiveReady){
 return accountExportReady.parse({status:"ready",exportId:value.exportId,filename:ACCOUNT_ARCHIVE_FILENAME,
  sizeBytes:value.sizeBytes,sha256:value.sha256,openAction:{method:"POST",operation:"open-ready"}});
}
