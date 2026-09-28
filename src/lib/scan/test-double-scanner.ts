import crypto from "node:crypto";
import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";
import { clamdScanner, parseClamdAddress } from "./clamd";
import { MAXIMUM_SCANNED_BYTES, type MalwareScanner } from "./malware-scanner";

/**
 * The scanner for CI and the local TEST-LOCAL stack, where no clamd runs.
 * It finds the EICAR anti-malware test string, the file every real scanner
 * reports as infected, and passes everything else under signatures it says
 * were published now. It is never a production scanner: `claimScannerFrom`
 * refuses it outside TEST-LOCAL or in a production build.
 *
 * The EICAR string is assembled at run time so that an antivirus on a
 * developer machine does not quarantine this source file.
 */
export const EICAR_TEST_STRING = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  return Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).indexOf(needle) >= 0;
}

export function testDoubleScanner(now: () => number = Date.now): MalwareScanner {
  const eicar = Buffer.from(EICAR_TEST_STRING, "ascii");
  return {
    async scan(bytes) {
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (bytes.length > MAXIMUM_SCANNED_BYTES) return { verdict: "OVERSIZE", sha256 };
      const signatures = { engine: "test-double", version: 1, publishedAt: new Date(now()) };
      return contains(bytes, eicar)
        ? { verdict: "FOUND", sha256, signatures }
        : { verdict: "OK", sha256, signatures };
    },
  };
}

/**
 * The scanner `INHERIT_CLAMD_ADDRESS` names: a clamd socket
 * (`unix:/path` or `tcp:host:port`), or `test-double` on a TEST-LOCAL,
 * non-production build. Anything else is a configuration error, so the scan
 * worker cannot start without a real scanner.
 */
export function claimScannerFrom(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MalwareScanner {
  const value = env.INHERIT_CLAMD_ADDRESS;
  if (value === "test-double") {
    if (!isTestJurisdictionEnabled(env) || env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
      throw new Error("scanner_unconfigured");
    }
    return testDoubleScanner();
  }
  const address = parseClamdAddress(value);
  if (!address) throw new Error("scanner_unconfigured");
  return clamdScanner({ address });
}
