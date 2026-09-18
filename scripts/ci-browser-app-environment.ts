import assert from "node:assert/strict";
import { APP_ENV_NAMES } from "./ci-browser-config";

type Environment = Readonly<Record<string, string | undefined>>;
type AppPort = 3100 | 3101 | 3102;
type AppEnvironmentName = (typeof APP_ENV_NAMES)[number];

/** The configuration one fixed local app variant receives, in the shape
 * `checkedAppEnvironment` admits: 3100 is the main suite under the TEST-LOCAL
 * jurisdiction flag, 3101 the same build with the flag unset, 3102 the
 * paused-issuance variant. Only the four variant fields are fixed here; every
 * shared value is read by name from the job environment the browser suite
 * already runs under, so a Lighthouse run and the suite's own web server
 * describe the same app and nothing here holds a value of its own. */
export function appServerEnvironment(env: Environment, port: AppPort): Record<AppEnvironmentName, string> {
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
  return Object.fromEntries(entries) as Record<AppEnvironmentName, string>;
}
