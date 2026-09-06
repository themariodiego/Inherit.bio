import crypto from "node:crypto";
import { SENSITIVE_HEADERS } from "@/lib/embryos/api";
import { mintRightsActivationCandidate } from "@/lib/embryos/rights-activation";
import { rightsInterstitialScript } from "@/lib/embryos/rights-interstitial";

export const dynamic = "force-dynamic";

/** Generic GET: no credential, account, invitation or target lookup. */
export function GET() {
  const candidate = mintRightsActivationCandidate();
  const scriptNonce = crypto.randomBytes(24).toString("base64url");
  const script = rightsInterstitialScript(candidate.formToken);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<script nonce="${scriptNonce}">${script}</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Open your request · Inherit</title>
<style nonce="${scriptNonce}">
:root{color-scheme:light dark;--paper:#f7f8f1;--ink:#14201b;--forest:#2e5c45;--on-forest:#f7f8f1}
@media(prefers-color-scheme:dark){:root{--paper:#101713;--ink:#e8ede2;--forest:#7fb298;--on-forest:#101713}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.65 system-ui,sans-serif}
main{max-width:64rem;margin:4rem auto;padding:0 1.5rem}h1{font:400 clamp(2rem,5vw,3rem)/1.15 Georgia,serif}
p{max-width:42rem}a{color:var(--forest);text-underline-offset:.2em}button{font:inherit;border:0;border-radius:9999px;padding:.75rem 1.5rem;background:var(--forest);color:var(--on-forest);min-height:44px;cursor:pointer}
button:disabled{opacity:.65;cursor:default}:focus-visible{outline:3px solid var(--forest);outline-offset:4px}
</style></head><body><main>
<a href="/">Inherit</a><h1>Open your request</h1>
<p>Continue to review the request linked in your email. Opening this page does not accept an invitation or give anyone access to your data.</p>
<button id="activate" type="button" disabled>Continue</button>
<p id="status" role="status" aria-live="polite"></p>
<noscript><p>JavaScript is needed to open this private link. Enable it, then open the link from your email again.</p></noscript>
<p><a href="/withdraw/session">Continue an open request</a></p>
<p><a href="/legal/privacy">Privacy</a> · <a href="/legal/gdpr">Your data rights</a></p>
</main></body></html>`;
  return new Response(html, { headers: {
    ...SENSITIVE_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Set-Cookie": candidate.setCookie,
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'nonce-${scriptNonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  } });
}

/** Link previews do not need a form or a cookie. */
export function HEAD() {
  return new Response(null, { headers: {
    ...SENSITIVE_HEADERS,
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Type": "text/html; charset=utf-8",
  } });
}
