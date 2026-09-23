import "server-only";
import { z } from "zod";
import { isFixtureSlug } from "@/components/reports/library";
import { ownChatReportSchema, type OwnChatProjection, type OwnChatReport } from "./own-chat-content";
import { OWN_ANCESTRY_REPORT } from "./own-chat-ancestry-content";

/** Read only reports already bound to this exact authorized projection. The
 * existing selector is read-only and does not require a consumed chat nonce. */
export async function readOwnChatReports(projection: OwnChatProjection, options: {
  check: () => Promise<void>;
  readPage: (offset: number) => Promise<unknown>;
}): Promise<OwnChatReport[]> {
  const rows: OwnChatReport[] = [];
  await options.check();
  if (!projection.sources.some(source => source.completed.some(result => result.purpose !== "ancestry"))) return rows;
  for (let offset = 0;;) {
    await options.check();
    const page = z.array(ownChatReportSchema).max(1000).parse(await options.readPage(offset));
    if (!page.length) break;
    if (page.some(row => row.report.slug === OWN_ANCESTRY_REPORT || !projection.sources.some(source =>
      source.id === row.file_id && source.completed.some(result => result.purpose === row.purpose)))) {
      throw new Error("copilot_unavailable");
    }
    rows.push(...page);
    offset += page.length;
    if (rows.length > 10000 || JSON.stringify(rows).length > 2000000) throw new Error("copilot_unavailable");
  }
  await options.check();
  return rows.filter(row => !isFixtureSlug(row.report.slug));
}
