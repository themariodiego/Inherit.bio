import assert from 'node:assert/strict';

export const REPORT_SLUG = 'caffeine-metabolism-cyp1a2-rs762551';
export const THRESHOLDS = Object.freeze({ performance: 0.90, accessibility: 1 });

export function localBase(value = 'http://localhost:3100') {
  const url = new URL(value);
  assert(url.href === 'http://localhost:3100/', 'Lighthouse requires the exact local main app origin');
  return url.origin;
}

// Same flags as chromiumStorageProxyArgs; the parity regression prevents drift.
// Kept Node-native because this entry point cannot load a tsx-transformed Lighthouse.
export function proxyFlags(value) {
  assert(value, 'Start the real local Storage browser bootstrap first');
  const url = new URL(value);
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port
    && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash,
  'An exact loopback Storage proxy is required');
  return [`--proxy-server=${url.origin}`, '--proxy-bypass-list=<-loopback>'];
}

export function pagesFor(base, fixture) {
  localBase(base);
  assert(fixture && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(fixture.fileId)
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(fixture.subjectId),
  'An actual prepared fixture receipt is required');
  return [
    { name: 'landing', url: `${base}/` },
    { name: 'overview', url: `${base}/overview` },
    { name: 'report', url: `${base}/genome/me/reports/${REPORT_SLUG}?source=${fixture.fileId}` },
  ];
}

export function assess(page, lhr) {
  const failures = [];
  if (!lhr || lhr.runtimeError) failures.push(`${page.name}: audit did not complete`);
  if (lhr?.requestedUrl !== page.url || lhr?.finalDisplayedUrl !== page.url
    || lhr?.finalUrl !== page.url) failures.push(`${page.name}: requested/final URL mismatch`);
  // A status-200 shell or a cached error page is not a successful document.
  // network-requests belongs to performance; http-status-code is SEO and is
  // intentionally not collected by this two-category gate.
  const documents = lhr?.audits?.['network-requests']?.details?.items?.filter(item =>
    item.resourceType === 'Document' && item.url === page.url);
  if (!documents?.length || documents.some(item => item.statusCode !== 200)) failures.push(`${page.name}: unsuccessful document`);
  const scores = {};
  for (const [category, threshold] of Object.entries(THRESHOLDS)) {
    const score = lhr?.categories?.[category]?.score;
    scores[category] = typeof score === 'number' ? score * 100 : null;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < threshold || score > 1) {
      failures.push(`${page.name}: ${category} below ${threshold * 100} or unavailable`);
    }
  }
  return { name: page.name, url: page.url, scores, failures };
}

export const RUNS = 3;
export function median(values) {
  assert(values.length === RUNS && values.every(value => typeof value === 'number' && Number.isFinite(value)),
    'Three measured scores are required');
  return [...values].sort((a, b) => a - b)[1];
}

/** Three cold navigations per route, median category scores; exact URLs and
 * authenticated content must pass on every navigation, not just the median. */
export async function runGate(pages, audit, verify, report) {
  const failures = [];
  for (const page of pages) {
    const runs = [];
    for (let run = 1; run <= RUNS; run++) {
      const result = assess(page, await audit(page.url));
      await verify(page); // Same audited tab, no replacement navigation.
      report({ ...result, run });
      runs.push(result);
      // A score below threshold contributes to the median. An absent/invalid
      // score, document error or redirect is never a usable median sample.
      failures.push(...result.failures.filter(failure => !failure.includes(' below ')));
      if (Object.values(result.scores).some(score => score === null || !Number.isFinite(score) || score < 0 || score > 100)) {
        failures.push(`${page.name}: invalid score sample`);
      }
    }
    const scores = Object.fromEntries(Object.keys(THRESHOLDS).map(category => [category,
      runs.every(run => typeof run.scores[category] === 'number' && Number.isFinite(run.scores[category]))
        ? median(runs.map(run => run.scores[category])) : null]));
    report({ name: page.name, url: page.url, aggregation: 'median-of-three', scores });
    for (const [category, threshold] of Object.entries(THRESHOLDS)) {
      if (scores[category] === null || scores[category] < threshold * 100) failures.push(`${page.name}: median ${category} below ${threshold * 100}`);
    }
  }
  assert(failures.length === 0, `Lighthouse gate failed: ${failures.join('; ')}`);
}
