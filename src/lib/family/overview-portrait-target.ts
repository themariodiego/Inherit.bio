import "server-only";
import { z } from "zod";
import type { Db } from "@/lib/genome/load";
import type { SubjectSummary } from "@/lib/subjects";
import { currentOwnUploadAccount } from "@/lib/uploads/own-upload-context";
import { familyCapability, viewerMaySee } from "./access";
import type { FamilyPerson } from "./graph";

const uuid = z.uuid();
const pairRows = z.array(z.object({
  id: uuid, subject_a_id: uuid, subject_b_id: uuid, status: z.literal("current"),
}).strict()).max(50);
const navigation = z.object({
  pairId: uuid, subjectAId: uuid, subjectBId: uuid, counterpartAccountId: uuid,
  receipt: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
export type OverviewPortraitTarget = { confirm(): Promise<string | null> };
const unavailable: OverviewPortraitTarget = { confirm: async () => null };

async function permitted(accountId: string, counterpartId: string) {
  for (const capability of ["third_party_adult_analysis", "family_portrait"] as const) {
    if ((await familyCapability(accountId, [counterpartId], capability)).status !== "permitted") return false;
  }
  return true;
}

/** Resolve only a candidate from the viewer's own graph. No file, source or
 * result is read; no pair identifier leaves this helper before confirmation. */
export async function loadOverviewPortraitTarget(
  db: Db, viewerAccountId: string, self: SubjectSummary | null, people: readonly FamilyPerson[],
): Promise<OverviewPortraitTarget> {
  try {
    if (!uuid.safeParse(viewerAccountId).success || !self || !uuid.safeParse(self.id).success ||
      self.subjectClass !== "self" || self.lifecycle !== "active" || self.subjectAccountId !== viewerAccountId) return unavailable;
    const counterparts = people.filter(person => viewerMaySee(person, "family.portrait") &&
      person.grantsFromViewer.has("family.portrait") && uuid.safeParse(person.dataSubjectId).success &&
      uuid.safeParse(person.counterpartAccountId).success && person.dataSubjectId !== self.id &&
      person.counterpartAccountId !== viewerAccountId);
    if (!counterparts.length) return unavailable;
    const actor = await currentOwnUploadAccount();
    if (!actor || actor.accountId !== viewerAccountId || !uuid.safeParse(actor.sessionId).success) return unavailable;
    const response = await db.from("family_pairs").select("id, subject_a_id, subject_b_id, status")
      .eq("status", "current").or(`subject_a_id.eq.${self.id},subject_b_id.eq.${self.id}`)
      .order("id", { ascending: true }).limit(50);
    const parsed = pairRows.safeParse(response.data);
    if (response.error || !parsed.success) return unavailable;
    const rpc = db.rpc.bind(db) as unknown as Rpc;
    for (const pair of parsed.data) {
      const otherSubject = pair.subject_a_id === self.id ? pair.subject_b_id : pair.subject_b_id === self.id ? pair.subject_a_id : null;
      const person = counterparts.find(candidate => candidate.dataSubjectId === otherSubject);
      if (!person || !await permitted(viewerAccountId, person.counterpartAccountId)) continue;
      const args = { p_account_id: actor.accountId, p_session_id: actor.sessionId,
        p_pair_id: pair.id, p_counterpart_account_id: person.counterpartAccountId };
      const captured = await rpc("family_portrait_navigation_v1", args);
      const checked = navigation.safeParse(captured.data);
      if (captured.error || !checked.success || checked.data.pairId !== pair.id ||
        checked.data.subjectAId !== pair.subject_a_id || checked.data.subjectBId !== pair.subject_b_id ||
        checked.data.counterpartAccountId !== person.counterpartAccountId) continue;
      const snapshot = checked.data;
      let closed = false;
      return { confirm: async () => {
        if (closed) return null;
        try {
          const current = await currentOwnUploadAccount();
          if (!current || current.accountId !== actor.accountId || current.sessionId !== actor.sessionId ||
            !await permitted(actor.accountId, person.counterpartAccountId)) { closed = true; return null; }
          // Last await before exposing the href: current authority must match
          // the captured pair, both grants, endpoints, readiness and session.
          const final = await rpc("family_portrait_navigation_v1", { ...args, p_expected: snapshot.receipt });
          const result = navigation.safeParse(final.data);
          if (final.error || !result.success || JSON.stringify(result.data) !== JSON.stringify(snapshot)) {
            closed = true; return null;
          }
          return snapshot.pairId;
        } catch { closed = true; return null; }
      } };
    }
  } catch { return unavailable; }
  return unavailable;
}
