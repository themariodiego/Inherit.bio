import "server-only";

/**
 * The origin every link inside outbound mail is built from: invitations,
 * rights and withdrawal links, and the cancel/export links in an
 * account-deletion notice.
 *
 * D-098 asked whether `NEXT_PUBLIC_APP_URL` should fail loudly rather than
 * fall back, and recorded the question as unanswerable because what the
 * production deployment sets is not readable from this repository. It does not
 * have to be. The two deployments are distinguishable without knowing either
 * one's configuration, and they carry opposite risks:
 *
 *   - On the hosted deployment the fallback is CORRECT. `docs/route-register.json`
 *     pins `canonicalOrigin` to the same literal, so an unset variable there
 *     produces exactly the origin the register already declares, and throwing
 *     would take out mail delivery to fix nothing.
 *   - Off it, the fallback is the defect. A self-hoster who set the documented
 *     `NEXT_PUBLIC_SITE_URL` and missed this one would mail their users links
 *     to a site they do not run - and those links carry rights tokens, so the
 *     failure hands a stranger's server the means to act on someone's genome.
 *
 * So the rule is the deployment, not the value: hosted keeps the fallback,
 * anywhere else an unset variable is refused. That is why this throws at the
 * point a link is built rather than at startup - a refusal that stops one
 * message is recoverable, where a message already sent is not.
 *
 * `VERCEL`/`VERCEL_ENV` are set by the platform and never by an operator;
 * `.env.example` and `docs/self-hosting.md` both say so, and `gate:env` holds
 * them in its runtime-injected ledger.
 */

/** Kept identical to `canonicalOrigin` in `docs/route-register.json`, which is
 * the authority for it; `src/lib/app-origin.test.ts` fails if the two drift. */
const HOSTED_ORIGIN = "https://www.inherit.bio";

export const UNSET_APP_URL_MESSAGE =
  "NEXT_PUBLIC_APP_URL is unset. It builds the links inside outbound mail - invitations, " +
  "rights and withdrawal links - and falling back to the hosted deployment would send your " +
  "users' mail links, and the rights tokens they carry, to a site you do not run. Set it " +
  "explicitly; see docs/self-hosting.md.";

export function applicationOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const hosted = env.VERCEL !== undefined || env.VERCEL_ENV !== undefined;
  if (!hosted) throw new Error(UNSET_APP_URL_MESSAGE);
  return HOSTED_ORIGIN;
}
