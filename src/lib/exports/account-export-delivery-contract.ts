import {z} from "zod";

export const ACCOUNT_ARCHIVE_FILENAME="inherit-account-export.zip";
export const ACCOUNT_ARCHIVE_CHUNK_BYTES=4_000_000;
const count=z.number().int().positive().safe(),hash=z.string().regex(/^[a-f0-9]{64}$/u);
export const accountExportPreparing=z.object({status:z.literal("preparing"),exportId:z.uuid()}).strict();
export const accountExportReady=z.object({status:z.literal("ready"),exportId:z.uuid(),
 filename:z.literal(ACCOUNT_ARCHIVE_FILENAME),sizeBytes:count,sha256:hash,
 openAction:z.object({method:z.literal("POST"),operation:z.literal("open-ready")}).strict()}).strict();
export const accountExportDownload=z.object({session:z.uuid(),filename:z.literal(ACCOUNT_ARCHIVE_FILENAME),
 sizeBytes:count,sha256:hash,chunkBytes:z.literal(ACCOUNT_ARCHIVE_CHUNK_BYTES),chunkCount:count,
 chunkRoute:z.string()}).strict()
 .refine(value=>value.chunkCount===Math.ceil(value.sizeBytes/ACCOUNT_ARCHIVE_CHUNK_BYTES)
  &&value.chunkRoute===`/api/downloads/${value.session}/chunks/{sequence}`);
export type AccountExportReady=z.infer<typeof accountExportReady>;
export type AccountExportDownload=z.infer<typeof accountExportDownload>;
