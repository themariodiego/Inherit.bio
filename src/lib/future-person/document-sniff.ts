/**
 * legal-evidence-ingest-v1.allowedFormats: the server decides a document's
 * type from its own first bytes. The file name and the browser's content
 * type are never authoritative; a declared type the bytes do not bear out is
 * refused.
 */

export type DocumentMediaType = "application/pdf" | "image/jpeg" | "image/png";

const SIGNATURES: readonly [DocumentMediaType, readonly number[]][] = [
  ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
];

/** The allowed type these bytes begin with, or null. */
export function sniffDocumentType(bytes: Uint8Array): DocumentMediaType | null {
  for (const [type, magic] of SIGNATURES) {
    if (bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte)) return type;
  }
  return null;
}
