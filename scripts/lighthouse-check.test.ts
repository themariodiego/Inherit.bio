import { describe, expect, it, vi } from 'vitest';
import { assess, localBase, pagesFor, proxyFlags, runGate, median } from './lighthouse-contract.mjs';
import { chromiumStorageProxyArgs } from './local-storage-browser-config';

const fixture = { fileId: '00000000-0000-4000-8000-000000000001', subjectId: '00000000-0000-4000-8000-000000000002' };
const pages = pagesFor(localBase(), fixture);
const good = (url: string) => ({ requestedUrl: url, finalUrl: url, finalDisplayedUrl: url,
  categories: { performance: { score: 0.90 }, accessibility: { score: 1 } },
  audits: { 'network-requests': { details: { items: [{ resourceType: 'Document', url, statusCode: 200 }] } } } });

describe('G1.14 exact authenticated gate', () => {
  it('requires exactly the real three routes and preserves the chosen file selector', () => {
    expect(pages.map(p => p.url)).toEqual(['http://localhost:3100/', 'http://localhost:3100/overview',
      `http://localhost:3100/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551?source=${fixture.fileId}`]);
    expect(() => pagesFor(localBase(), {})).toThrow();
    expect(() => localBase('https://inherit.bio')).toThrow();
  });
  it('never rounds 89.9 performance or 99.9 accessibility into a pass', () => {
    const lhr = good(pages[0].url);
    lhr.categories.performance.score = .899;
    lhr.categories.accessibility.score = .999;
    expect(assess(pages[0], lhr).failures).toHaveLength(2);
    expect(assess(pages[0], good(pages[0].url)).failures).toEqual([]);
  });
  it.each(['requestedUrl', 'finalUrl', 'finalDisplayedUrl'])('refuses redirected or changed %s even with perfect categories', key => {
    const lhr = { ...good(pages[2].url), [key]: 'http://localhost:3100/auth/sign-in' };
    expect(assess(pages[2], lhr).failures).toContain('report: requested/final URL mismatch');
  });
  it.each([null, NaN, undefined])('refuses unavailable category score %s', score => {
    const lhr = { ...good(pages[0].url), categories: { performance: { score }, accessibility: { score: 1 } } };
    expect(assess(pages[0], lhr).failures.length).toBeGreaterThan(0);
  });
  it('rejects audit errors and failing document status', () => {
    expect(assess(pages[0], { ...good(pages[0].url), runtimeError: { code: 'NO_FCP' } }).failures).toHaveLength(1);
    expect(assess(pages[0], { ...good(pages[0].url), audits: {} }).failures).toHaveLength(1);
    const failed = good(pages[0].url);
    failed.audits['network-requests'].details.items[0].statusCode = 404;
    expect(assess(pages[0], failed).failures).toContain('landing: unsuccessful document');
  });
  it('audits and checks all three actual tabs, then fails a category without dropping later routes', async () => {
    const audit = vi.fn(async (url: string) => ({ ...good(url), categories: { performance: { score: 1 }, accessibility: { score: .99 } } }));
    const verify = vi.fn(async () => {});
    const report = vi.fn();
    await expect(runGate(pages, audit, verify, report)).rejects.toThrow('accessibility');
    expect(audit.mock.calls.map(args => args[0])).toEqual(pages.flatMap(p => [p.url, p.url, p.url]));
    expect(verify).toHaveBeenCalledTimes(9);
  });
  it('cannot pass a score-only login shell with failed authenticated content proof', async () => {
    await expect(runGate(pages, async (url: string) => good(url), async () => { throw new Error('not a real result'); }, () => {}))
      .rejects.toThrow('not a real result');
  });
  it('reports the middle of exactly three measured category scores', () => {
    expect(median([94, 87, 90])).toBe(90);
    expect(() => median([100, 100])).toThrow();
    expect(() => median([100, NaN, 100])).toThrow();
  });
  it('retains the exact existing Storage proxy boundary', () => {
    expect(proxyFlags('http://127.0.0.1:19000')).toEqual(chromiumStorageProxyArgs('http://127.0.0.1:19000'));
    const credentialedProxy = new URL('http://127.0.0.1:19000');
    credentialedProxy.username = 'synthetic-user';
    credentialedProxy.password = 'test-only';
    for (const invalid of ['', 'https://127.0.0.1:19000', 'http://remote.test:19000', credentialedProxy.href]) {
      expect(() => proxyFlags(invalid)).toThrow();
    }
  });
});
