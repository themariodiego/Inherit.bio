// Audit helper (A3): verifies every provider buy link and privacy-policy
// link resolves (HTTP < 400, following redirects) on the provider's own
// domain. Run manually / in the audit phase — not in E2E, which must not
// depend on 16 external sites being up.
import fs from "node:fs";
import path from "node:path";

interface Entry {
  slug: string;
  checkout_url: string;
  privacy_policy_url?: string;
}

async function head(url: string): Promise<number> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; InheritLinkCheck/1.0)" },
      signal: AbortSignal.timeout(20000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

async function main() {
  const providers = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data/providers/providers.json"),
      "utf8",
    ),
  ) as Entry[];

  let failures = 0;
  for (const p of providers) {
    const buy = await head(p.checkout_url);
    const priv = p.privacy_policy_url ? await head(p.privacy_policy_url) : -1;
    const ok = buy > 0 && buy < 400 && (priv === -1 || (priv > 0 && priv < 400));
    console.log(
      `${ok ? "ok " : "FAIL"} ${p.slug}: buy=${buy} privacy=${priv === -1 ? "n/a" : priv}`,
    );
    if (!ok) failures++;
  }
  if (failures > 0) {
    console.error(`\n${failures} provider link(s) failing`);
    process.exit(1);
  }
}

void main();
