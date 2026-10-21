// Focused read-only display check; deliberately does not repeat whole-MVP manual acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture } from './helpers.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f = await fixture();
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors: string[] = [], remoteRequests: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('request', req => { if (!req.url().startsWith(f.origin + '/')) remoteRequests.push(req.url()); });
  await page.goto(f.origin);
  await page.getByRole('heading', { name: 'Starting reference notes' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Ask a question', exact: true }).count(), 1);
  assert.ok(await page.getByRole('link', { name: 'Browse reference notes', exact: false }).count());
  assert.equal(await page.locator('[data-reference-id]').count(), 3);
  await page.getByText('No public questions yet.', { exact: false }).waitFor();
  await page.getByRole('link', { name: 'Integration status & setup', exact: false }).click();
  await page.getByText('Tested locally over MCP stdio.', { exact: true }).waitFor();
  assert.match(await page.locator('#integration-status').innerText(), /Claude Code\s+NOT_TESTED/i);
  await page.goto(f.origin); await page.getByRole('heading', { name: 'Starting reference notes' }).waitFor();
  await page.getByRole('link', { name: 'Browse reference notes', exact: false }).first().click();
  await page.getByRole('heading', { name: 'Reference notes', exact: true }).waitFor();
  assert.equal(await page.locator('[data-reference-id]').count(), 3);
  for (const card of await page.locator('[data-reference-id]').all()) {
    await card.getByText('Docs reference · Not tested here', { exact: true }).waitFor();
    await card.locator('summary').click();
    await card.getByText('NOT_RUN', { exact: true }).waitFor();
    assert.match(await card.innerText(), /Source review: 2026-10-20 · CLI version: Not tested/);
    await card.getByRole('heading', { name: 'Documented notes · sourced summaries', exact: true }).waitFor();
    await card.getByRole('heading', { name: 'AEG suggestions · not official documentation', exact: true }).waitFor();
    await card.getByRole('heading', { name: 'Applies when', exact: true }).waitFor();
    await card.getByRole('heading', { name: 'Does not establish', exact: true }).waitFor();
    await card.getByRole('heading', { name: 'Discussion starter · not a submitted user question', exact: true }).waitFor();
    const links = await card.locator('a').evaluateAll(nodes => nodes.map(a => ({ href: (a as HTMLAnchorElement).href, label: a.textContent })));
    assert.ok(links.length); assert.ok(links.every(a => a.href.startsWith('https://www.testmuai.com/docs/') && a.label));
  }
  // Check actual rendered search paths for the three distinct supplied search terms.
  for (const [query, id] of [['run_end', 'kane-doc-command-completion'], ['evidence serve', 'kane-doc-share-evidence-safely'], ['resend', 'kane-doc-interaction-checks']]) {
    await page.goto(f.origin + '/#search/' + encodeURIComponent(query));
    await page.locator(`[data-reference-id="${id}"]`).waitFor();
    await page.locator(`[data-reference-id="${id}"]`).getByText('Docs reference · Not tested here', { exact: true }).waitFor();
  }
  await page.goto(f.origin + '/#references'); await page.getByRole('heading', { name: 'Reference notes', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log('PASS: focused reference display — 3 read-only notes, homepage question/reference entry points, source links, documented summaries vs AEG suggestions, review date, boundaries, NOT_RUN, untested CLI, prior connection status, 3 Web queries, no automatic remote fetch.');
} finally { await browser?.close(); await f.close(); }
