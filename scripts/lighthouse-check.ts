// G1.14: exactly /, authenticated /overview, and one covered exact-source report.
// Three cold-cache runs/route; median performance >=90 and accessibility100.
// URL, document status, auth and personal-result checks must pass on EVERY run.
// Already-serving isolated production build + seeded local Supabase + the real
// Storage browser proxy/signer are prerequisites. This does not build/start/reset
// services. It creates one run-scoped synthetic account/file through existing UI
// helpers; it never sends mail/model requests or runs a global cleanup worker.
// Run: node --experimental-strip-types scripts/lighthouse-check.ts
// Do not use tsx here: esbuild keepNames breaks Lighthouse's serialized functions.
// Auth stays inside the ephemeral Chrome profile; no cookies/storageState, full
// Lighthouse JSON, screenshots or genetic page bodies are written to receipts.
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { localBase, pagesFor, proxyFlags, runGate } from './lighthouse-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findChrome(): string | undefined {
  if (process.env.SEQ_LH_CHROME) return process.env.SEQ_LH_CHROME;
  const directory = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!fs.existsSync(directory)) return undefined;
  for (const entry of fs.readdirSync(directory)) {
    for (const relative of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome']) {
      const candidate = path.join(directory, entry, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
}

async function main() {
  const base = localBase(process.env.SEQ_LH_BASE);
  if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Disable credential-bearing browser debug output');
  const flags = proxyFlags(process.env.INHERIT_LOCAL_BROWSER_STORAGE_PROXY);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'inherit-lighthouse-'));
  fs.chmodSync(scratch, 0o700);
  const receipt = path.join(scratch, 'fixture.json');
  const chrome = await launch({ chromePath: findChrome(),
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', ...flags] });
  const worker = async (mode: string, target = '') => {
    try {
      await promisify(execFile)(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'),
        path.join(root, 'scripts/lighthouse-fixture.ts'), mode, String(chrome.port), base, receipt, target],
      { cwd: root, timeout: 240_000, maxBuffer: 8192 });
    } catch { throw new Error(`Lighthouse ${mode} prerequisite failed; no authenticated result can be claimed`); }
  };
  try {
    console.log('Preparing one synthetic account and covered saved report through the real UI.');
    await worker('prepare');
    const pages = pagesFor(base, JSON.parse(fs.readFileSync(receipt, 'utf8')));
    // Use Lighthouse's installed Puppeteer dependency and its public page argument.
    // Without an owned page Lighthouse closes the audited tab before content proof.
    const lhRequire = createRequire(import.meta.resolve('lighthouse'));
    const puppeteer = (await import(pathToFileURL(lhRequire.resolve('puppeteer-core')).href)).default;
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
    await runGate(pages, async (url: string) => {
      console.log(`Auditing ${url}`);
      const page = await browser.newPage();
      const cdp = await page.createCDPSession();
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'cache_storage,service_workers' });
      await cdp.detach();
      const result = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error' }, {
        extends: 'lighthouse:default',
        settings: { onlyCategories: ['performance', 'accessibility'], disableStorageReset: true },
      }, page);
      return result?.lhr;
    }, async (page: { name: string; url: string }) => worker('verify', page.name),
    (result: unknown) => console.log(JSON.stringify(result)));
    await browser.disconnect();
    console.log('Lighthouse G1.14 passed: all three exact pages, median performance >=90, median accessibility 100.');
  } finally {
    await chrome.kill();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch(() => {
  // Do not dump subprocess errors, Chrome headers, auth state or page contents.
  console.error('Lighthouse G1.14 failed. Check sanitized route scores and local prerequisites.');
  process.exitCode = 1;
});
