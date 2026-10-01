import { createHash } from "node:crypto";

/**
 * One versioned legal artifact file, `content/legal/<key>/v<n>.md`: a
 * front-matter block, a one-paragraph `<section data-legal-summary>`, then
 * the body. The body is what is hashed and signed; the summary renders above
 * it. This is the same shape `content/legal/legal-content.test.ts` reads, so
 * a file either parses the same way everywhere or nowhere.
 */
export interface ArtifactFile {
  meta: Record<string, string>;
  summary: string;
  body: string;
}

export function parseArtifactFile(source: string): ArtifactFile | null {
  const front = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!front) return null;
  const meta: Record<string, string> = {};
  for (const line of front[1].split("\n")) {
    const index = line.indexOf(":");
    if (index < 0) return null;
    meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const rest = source.slice(front[0].length);
  const section = rest.match(/^<section data-legal-summary>\n([\s\S]*?)\n<\/section>\n/);
  if (!section) return null;
  return { meta, summary: section[1].trim(), body: rest.slice(section[0].length).trim() };
}

export function artifactBodySha256(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}
