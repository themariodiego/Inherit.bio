import 'server-only';
import type { SubjectSummary } from '@/lib/subjects';

/**
 * What `/copilot/[scope]` serves for a subject segment (`me` or `s-{uuid}`),
 * by the register: `policyResolvers.copilot-route-scope-v1` resolves the
 * subject, `scope-derived-v1` names its case, and
 * `copilot-transport-availability-v1` classifies it as own or true non-self
 * from the database subject row (owner and subject account), never from a
 * request field.
 *
 * - `own`: a `self` subject the acting account holds (`self`,
 *   `subject:self`). The own chat serves it (src/lib/copilot/own-chat.ts):
 *   the person's own Copilot purpose grant, a server-held conversation and a
 *   single-use context token. A self subject with no canonical upload consent
 *   has no such grant yet, and the own chat answers it with its own
 *   consent-required or setup state.
 * - `true-non-self-unavailable`: an `other_adult` subject the account
 *   uploaded or was granted (`subject:adult-uploader-or-grantee`, one of
 *   `trueNonSelfScopes`) on a runtime that is not a server-attested
 *   same-host local model. The page renders the registered
 *   `unavailablePageProjection` and nothing about the subject.
 * - `refused`: every other subject the account resolves. No context token is
 *   minted, so the API can only answer resource-not-found-v1, and the page
 *   answers the copilot.scope parameter contract's resource-not-found-page-v1:
 *   - `adult-uploader-or-grantee` on a local runtime. Its authority is
 *     `copilot.local` signed by the adult subject principal for this recipient
 *     relationship, and no door writes that grant: `grant_path_b_purpose_v1`
 *     and `grant_purpose_rights_v1` refuse `copilot.local` ("no Path B Copilot
 *     scope"), and the Family door's `copilot.local` is read only by the Family
 *     group scope. Opening uploader access is the owner's decision.
 *   - `own-adult-subject`: an `other_adult` record the person holds
 *     themselves. The register has provider cases for it, but the own Copilot
 *     permission and authority (`grant_own_copilot_v1`,
 *     `own_copilot_authority_v1` through `own_report_context_v1`) admit a
 *     `self` subject only, so no grant can exist. Not built.
 *   - `no-subject-case`: a `minor` or an `embryo`. `scope-derived-v1` has no
 *     subject case for either (an embryo's Copilot is the cohort scope).
 *   - `not-held`: a `self` record another account holds.
 *
 * Until 24 October 2026 the compatibility branch of `api.chat` answered
 * these subjects (and self subjects with no canonical upload consent) under
 * provider-key consent, with no conversation and a reusable token. It is
 * retired (G8.5).
 */
export type CopilotSubjectScope =
  | { kind: 'own' }
  | { kind: 'true-non-self-unavailable' }
  | { kind: 'refused'; case: 'adult-uploader-or-grantee' | 'own-adult-subject' | 'no-subject-case' | 'not-held' };

export function copilotSubjectScope(accountId: string, subject: Pick<SubjectSummary, 'subjectClass' | 'subjectAccountId'>,
  localTransportAvailable: boolean): CopilotSubjectScope {
  const held = subject.subjectAccountId === accountId;
  if (subject.subjectClass === 'self') return held ? { kind: 'own' } : { kind: 'refused', case: 'not-held' };
  if (subject.subjectClass === 'other_adult') {
    if (held) return { kind: 'refused', case: 'own-adult-subject' };
    return localTransportAvailable ? { kind: 'refused', case: 'adult-uploader-or-grantee' } : { kind: 'true-non-self-unavailable' };
  }
  return { kind: 'refused', case: 'no-subject-case' };
}
