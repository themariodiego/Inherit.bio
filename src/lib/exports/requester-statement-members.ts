import "server-only";
import { z } from "zod";
import { nativeRequesterStatement, openRequesterCorrectionStatement, requesterStatementsOpen } from "@/lib/future-person/requester-statement";
import type { FuturePersonMemberFactory } from "./future-person-member-plan";
import type { FuturePersonExportSnapshot } from "./future-person-content";
import type {RequesterStatementRuntime} from "./requester-statement-runtime";
export const ownStatementCapture = z.object({ version: z.literal("test-requester-own-statements-v1"),
 corrections: z.number().int().nonnegative().safe(), appeals: z.literal(0),
 membershipSha256: z.string().regex(/^[0-9a-f]{64}$/u), originalDeadline: z.iso.datetime({ offset: true }).nullable() }).strict()
 .refine(value => (value.corrections === 0) === (value.originalDeadline === null));
const page = z.object({ rows: z.array(z.object({ id: z.uuid(), frame: nativeRequesterStatement }).strict()).max(32),
 count: z.number().int().min(0).max(32), nextAfterId: z.uuid().nullable() }).strict();
const unavailable = () => new Error("requester_statement_archive_unavailable"), encoder = new TextEncoder();
/** Complete server census and EOF are proved again for each materialization.
 * Native capture owns the source fingerprint. The worker does not guess authors
 * from subject access, decrypt notes, or omit a nonempty unsupported appeal. */
export async function prepareRequesterStatementMembers(options: { snapshot: FuturePersonExportSnapshot;
 sensitiveRuntime?:RequesterStatementRuntime;
 signal: AbortSignal; check: (signal: AbortSignal) => Promise<unknown>;
 call: (operation: "own-statements", signal: AbortSignal, after?: string | null) => Promise<unknown> }) {
 const captured = options.snapshot.ownStatements;
 if (captured === undefined) return [];
 if (!requesterStatementsOpen()) throw unavailable();
 const capture = ownStatementCapture.parse(captured), actor = options.snapshot.authority;
 async function* rows(signal: AbortSignal) {
  let after: string | null = null, count = 0;
  for (;;) {
   if (signal.aborted) throw unavailable();await options.check(signal);
   const current = page.parse(await options.call("own-statements", signal, after));
   if (current.count !== current.rows.length || current.nextAfterId !== (current.rows.at(-1)?.id ?? null)) throw unavailable();
   if (!current.count) { if (count !== capture.corrections) throw unavailable();await options.check(signal);return; }
   for (const item of current.rows) {
    if (after !== null && item.id <= after || item.frame.scope.caseId !== item.id
      || item.frame.binding.principalId !== actor.principalId || item.frame.binding.subjectId !== actor.subjectId
      || item.frame.binding.authorityRevision !== actor.credentialRevision
      || item.frame.binding.lifecycleRevision !== actor.lifecycleRevision || item.frame.binding.bindingRevision !== actor.bindingRevision) throw unavailable();
    await options.check(signal);
    const projected = openRequesterCorrectionStatement(item.frame, item.id);
    if (!projected) throw unavailable();
    await options.check(signal);after = item.id;count++;if (count > capture.corrections) throw unavailable();
    const bytes = encoder.encode(JSON.stringify(projected));options.sensitiveRuntime?.own(bytes);
    try{yield bytes;}finally{if(options.sensitiveRuntime)options.sensitiveRuntime.clear(bytes);else bytes.fill(0);}
   }
  }
 }
 const factory: FuturePersonMemberFactory = { name: `subjects/${actor.subjectId}/my-correction-statements.json`, rows: capture.corrections,
  chunks: async function* (signal) {
   await options.check(signal);yield encoder.encode('{"schemaVersion":"test-requester-own-statements-v1","rows":[');
   let comma = false;
   for await (const bytes of rows(signal)) {
    try { await options.check(signal);if (comma) yield encoder.encode(",");yield bytes;await options.check(signal);comma = true; }
    finally { bytes.fill(0); }
   }
   await options.check(signal);yield encoder.encode("]}\n");await options.check(signal);
  } };
 // Census/decryption now; whole worker still repeats all member byte identity
 // and EOF through its actual ZIP64/member SHA before a READY transition.
 for await (const bytes of rows(options.signal)) bytes.fill(0);
 return [factory];
}
