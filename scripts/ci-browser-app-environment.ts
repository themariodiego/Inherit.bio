import assert from "node:assert/strict";
import { APP_ENV_NAMES, APP_PORTS, LOCAL_MODEL_ENV, LOCAL_MODEL_PORT, PREPARED_APP_ENV, PREPARED_APP_PORT } from "./ci-browser-config";

type Environment = Readonly<Record<string, string | undefined>>;
type AppPort = (typeof APP_PORTS)[number];
type AppEnvironmentName = (typeof APP_ENV_NAMES)[number];

/** The configuration one fixed local app variant receives, in the shape
 * `checkedAppEnvironment` admits: 3100 is the main suite under the TEST-LOCAL
 * jurisdiction flag, 3101 the same build with the flag unset, 3102 the
 * paused-issuance variant, 3103 the local-model variant that alone carries
 * the fixed attestation in `LOCAL_MODEL_ENV`, and 3104 the CI prepared-source
 * variant with its own preparation flag. Only the variant fields are
 * fixed here; every shared value is read by name from the job environment the
 * browser suite already runs under, so a Lighthouse run and the suite's own
 * web server describe the same app and nothing here holds a value of its own. */
export function appServerEnvironment(env: Environment, port: AppPort): Record<string, string> {
  const variant: Partial<Record<AppEnvironmentName, string>> = {
    INHERIT_CANONICAL_UPLOADS_PAUSED: port === 3102 ? "true" : "false",
    NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
    NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
    INHERIT_TEST_JURISDICTION: port === 3101 ? "" : "1",
  };
  const entries = APP_ENV_NAMES.map((name): [AppEnvironmentName, string] => {
    const fixed = variant[name];
    if (fixed !== undefined) return [name, fixed];
    const shared = env[name];
    assert(typeof shared === "string" && shared.length > 0, `App server configuration requires ${name}`);
    return [name, shared];
  });
  const shared = Object.fromEntries(entries) as Record<AppEnvironmentName, string>;
  return port === LOCAL_MODEL_PORT ? { ...shared, ...LOCAL_MODEL_ENV }
    : port === PREPARED_APP_PORT ? { ...shared, ...PREPARED_APP_ENV } : shared;
}
