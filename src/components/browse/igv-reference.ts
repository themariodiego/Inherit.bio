/** The installed viewer resolves every string URL through its external URL
 * mapping service. Its native File path skips that lookup. Fetch this public
 * reference ourselves so the viewer has no remote resource to resolve and
 * unrelated upload XMLHttpRequests keep their ordinary browser behavior. */
export async function loadIgvReference(signal: AbortSignal): Promise<File> {
  const response = await fetch("/genomes/hg38.chrom.sizes", {
    credentials: "same-origin", redirect: "error", signal,
  });
  if (!response.ok) throw new Error("Genome reference could not be loaded");
  return new File([await response.blob()], "hg38.chrom.sizes", { type: "text/plain" });
}
