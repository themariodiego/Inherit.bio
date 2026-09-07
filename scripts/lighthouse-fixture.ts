// Runs only as the private tsx child of the Node-native Lighthouse entry point.
// Never prints credentials, writes auth state, or enables tracing/screenshots.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
import { adminClient, createConfirmedUser, signIn } from '../e2e/helpers';
import { uploadOwnFileWithChosenReports } from '../e2e/own-report-helpers';
import { localBase, pagesFor } from './lighthouse-contract.mjs';

type Fixture = { fileId: string; subjectId: string };

async function assertContent(page: Page, name: string, fixture: Fixture) {
  const expected = pagesFor(localBase(), fixture).find(p => p.name === name);
  assert(expected && page.url() === expected.url, 'Exact audited URL required');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('h1')).toBeVisible();
  if (name === 'overview') {
    await expect(page.locator('[data-starter-layer] a').first()).toBeVisible();
    await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
  }
  if (name === 'report') {
    await expect(page.locator(`[data-claim-block][data-subject-id="${fixture.subjectId}"] [data-figure-kind="genotype"]`)).toContainText('A/C');
    await expect(page.locator('[data-slot="input-provenance"]')).toBeVisible();
    await expect(page.locator('[data-slot="input-source"]')).toHaveCount(1);
    await expect(page.locator('[data-slot="input-provenance"]')).toContainText('No change of genome coordinates was needed.');
  }
}

async function main() {
  const [mode, port, inputBase, receipt, name] = process.argv.slice(2);
  assert(mode === 'prepare' || mode === 'verify');
  assert(/^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535);
  const base = localBase(inputBase);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const auditedContext = browser.contexts()[0];
    assert(auditedContext, 'Lighthouse default browser context required');
    if (mode === 'verify') {
      const fixture = JSON.parse(fs.readFileSync(receipt, 'utf8')) as Fixture;
      const target = pagesFor(base, fixture).find(p => p.name === name);
      assert(target);
      const matches = auditedContext.pages().filter(page => page.url() === target.url);
      assert(matches.length === 1, 'Exactly one actual Lighthouse page required');
      await assertContent(matches[0], name, fixture);
      // Close the measured tab before the next route; retain only its cookies.
      await matches[0].close();
      return;
    }
    const context = await browser.newContext({ baseURL: base });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      const email = `lighthouse-${randomUUID()}@e2e.local`;
      const accountId = await createConfirmedUser(email, 'synthetic-lighthouse-password');
      await signIn(page, email, 'synthetic-lighthouse-password');
      const fileId = await uploadOwnFileWithChosenReports(page,
        path.join(process.cwd(), 'e2e/fixtures/personal-previews-grch38.vcf'),
        { fileType: 'vcf', purposes: ['reports.polygenic'] });
      const { data: file, error } = await adminClient().from('genome_files').select('subject_id')
        .eq('id', fileId).eq('user_id', accountId).single();
      assert(!error && file?.subject_id);
      const fixture: Fixture = { fileId, subjectId: file.subject_id };
      for (const target of pagesFor(base, fixture).slice(1)) {
        const response = await page.goto(target.url);
        assert(response?.status() === 200, 'Prepared route must serve the actual document');
        await assertContent(page, target.name, fixture);
      }
      const cookies = await context.cookies();
      assert(cookies.some(cookie => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name)), 'Actual browser sign-in cookies required');
      // Do not attach a Cookie header globally: it would leak onto third-party
      // requests. CDP installs the actual domain/path-scoped cookies instead.
      await auditedContext.addCookies(cookies);
      fs.writeFileSync(receipt, JSON.stringify(fixture), { mode: 0o600, flag: 'wx' });
    } finally { await context.close(); }
  } finally { await browser.close(); }
}

main().catch(() => { console.error('Lighthouse fixture/content prerequisite failed'); process.exitCode = 1; });
