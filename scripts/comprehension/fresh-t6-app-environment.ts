import { randomBytes } from "node:crypto";
import { appServerEnvironment } from "../ci-browser-app-environment";
import { checkedAppEnvironment, EMBRYO_APP_ENV } from "../ci-browser-config";

/** Each fresh persona owns an in-memory verifier on the embryo server alone.
 * This supplies configuration, never a delivered callback or native receipt. */
export function freshT6AppEnvironments(parent: Readonly<Record<string, string | undefined>>, signer: string) {
  const shared = { ...parent, INHERIT_UPLOAD_SIGNING_JWK: signer };
  return {
    3100: checkedAppEnvironment(appServerEnvironment(shared, 3100), 3100),
    3105: checkedAppEnvironment({ ...appServerEnvironment(shared, 3105), ...EMBRYO_APP_ENV,
      RESEND_WEBHOOK_SECRET: `whsec_${randomBytes(32).toString("base64")}` }, 3105),
  };
}
