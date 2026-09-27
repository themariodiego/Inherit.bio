/**
 * The name a person's computer saves an original upload under.
 *
 * The canonical upload path stores the generic `Genome file` as the display
 * name, on purpose: a lab or vendor file name can carry a person's name or a
 * sample label, and the name is shown and exported. Without an extension,
 * though, the saved file opens with nothing on a double-click. So the generic
 * base stays and an extension for the stored type is added to it.
 *
 * Compression is recorded, not guessed. Canonical finalization stores the
 * stored object's own hash in `sha256` and the hash of the decoded stream in
 * `source_sha256`; the two are equal exactly when nothing was decoded, and
 * differ exactly when the stored bytes are gzip. A row without both (a legacy
 * upload, which kept the person's own file name) is left as it was rather than
 * given an extension that might not match its bytes.
 */

const BASE_EXTENSIONS: Readonly<Record<string, string>> = {
  array_23andme: ".txt",
  array_ancestry: ".txt",
  array_myheritage: ".txt",
  array_ftdna: ".txt",
  vcf: ".vcf",
  gvcf: ".g.vcf",
};

export type OriginalFileFacts = {
  file_type: string | null | undefined;
  sha256: string | null | undefined;
  source_sha256: string | null | undefined;
};

/** The extension for the stored bytes, or "" when it cannot be known. A
 * compressed consumer array is `.txt.gz`, since `.txt` would not open it. */
export function originalFileExtension(file: OriginalFileFacts): string {
  const base = file.file_type ? BASE_EXTENSIONS[file.file_type] : undefined;
  if (!base || !file.sha256 || !file.source_sha256) return "";
  return file.sha256 === file.source_sha256 ? base : `${base}.gz`;
}

/** The stored name with the extension added, unless it already ends with it. */
export function originalDownloadName(file: OriginalFileFacts & { original_name: string }): string {
  const extension = originalFileExtension(file);
  return extension && !file.original_name.toLowerCase().endsWith(extension)
    ? `${file.original_name}${extension}`
    : file.original_name;
}
