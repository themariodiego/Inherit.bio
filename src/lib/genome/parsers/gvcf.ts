/** GATK's spelling and VCF section 5.5's unspecified allele are equivalent.
 * Neither is the literal `*` spanning-deletion allele. */
export function isUnspecifiedAllele(allele: string): boolean {
  return allele === "<NON_REF>" || allele === "<*>";
}

/** Content evidence only: filenames and mentions in free text do not select
 * a format-specific ceiling. An ALT declaration works even in a long header. */
export function hasGvcfMarker(lines: readonly string[]): boolean {
  return lines.some(line => {
    if (line.startsWith("#")) return /^##ALT=<ID=(?:NON_REF|\*)(?:,.*)?>$/.test(line);
    const fields = line.split("\t");
    return fields.length >= 6 && fields[4].split(",").some(isUnspecifiedAllele);
  });
}
