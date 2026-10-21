// Targeted onboarding coverage. Temporary database; no real user content or credentials in screenshots.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fixture, publicEntry, sampleQuestion } from './helpers.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f = await fixture();
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const other = await browser.newContext(); const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', err => errors.push(err.message));
  await page.goto(f.origin); await page.getByRole('heading', { name: 'Starting reference notes' }).waitFor();
  assert.equal(await page.locator('.hero .intro').innerText(), 'Ask a specific question. Work through it with developers and your coding agent. Share what you tried—and what happened.');
  await page.getByRole('heading', { name: 'Stuck with Kane? Don’t debug alone.' }).waitFor();
  assert.ok(await page.evaluate(() => !!(document.querySelector('#starting-references').compareDocumentPosition(document.querySelector('#community-section')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  assert.equal(await page.locator('[data-reference-id]').count(), 3);
  assert.equal(await page.locator('.compact-empty').count(), 1);
  if (process.env.SCREENSHOT_PATH) { mkdirSync(dirname(process.env.SCREENSHOT_PATH), { recursive: true }); await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true }); }
  const examples = page.locator('[data-action=try-query]'); assert.equal(await examples.count(), 3);
  for (const example of await examples.all()) {
    const hash = new URL(page.url()).hash; await example.click();
    assert.equal(await page.getByRole('textbox', { name: 'Your Kane problem' }).inputValue(), await example.getAttribute('data-query'));
    assert.equal(new URL(page.url()).hash, hash); assert.equal((await context.request.get(f.origin + '/api/recent')).status(), 200);
  }
  assert.equal((await (await context.request.get(f.origin + '/api/recent')).json()).threads.length, 0);
  assert.equal((await (await context.request.get(f.origin + '/api/mine')).json()).entries.length, 0);
  await page.getByRole('link', { name: 'Use with my agent', exact: true }).click();
  await page.getByRole('heading', { name: 'Use with my agent' }).waitFor();
  assert.match(await page.locator('#integration-status').innerText(), /Tested locally over MCP stdio/);
  assert.match(await page.locator('#integration-status').innerText(), /Remote MCP\s+NOT_TESTED/i);
  assert.match(await page.locator('#integration-status').innerText(), /Claude Code\s+NOT_TESTED/i);
  await page.goto(f.origin); await page.getByRole('textbox', { name: 'Your Kane problem' }).fill('unmatched submarine banana question'); await page.getByRole('button', { name: 'Find help' }).click();
  await page.getByRole('button', { name: 'Ask this question', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask the Kane room' }).waitFor();
  assert.equal(await page.locator('[name=title]').inputValue(), 'unmatched submarine banana question');
  assert.equal(await page.locator('[name=body]').inputValue(), 'unmatched submarine banana question');
  await page.reload(); await page.getByRole('heading', { name: 'Ask the Kane room' }).waitFor();
  assert.equal(await page.locator('[name=body]').inputValue(), 'unmatched submarine banana question');
  const own = await (await context.request.get(f.origin + '/api/mine')).json(); assert.equal(own.entries.length, 1); assert.equal(own.entries[0].status, 'draft');
  assert.equal((await (await other.request.get(f.origin + '/api/mine')).json()).entries.length, 0);
  assert.equal((await (await context.request.get(f.origin + '/api/recent')).json()).threads.length, 0);
  await page.locator('[name=environment]').fill('Synthetic browser fixture; no Kane command executed.');
  await page.locator('[name=source_kind]').selectOption('synthetic_sample'); await page.locator('[name=source_citation]').fill('Synthetic onboarding test, no real question or result claimed.');
  await page.getByRole('button', { name: 'Preview public post' }).click(); await page.getByRole('heading', { name: 'Review before sharing' }).waitFor();
  assert.equal((await (await context.request.get(f.origin + '/api/recent')).json()).threads.length, 0);
  await page.getByRole('button', { name: 'Back to edit', exact: true }).click();
  // Test the nonzero real-question branch with a synthetic fixture explicitly classified as a user report.
  await publicEntry(f.client(), 'thread', null, { ...sampleQuestion, sources: [{ kind: 'user_report', citation: 'Synthetic test of user-report classification. Not a real community question.' }] });
  await page.goto(f.origin); await page.getByRole('heading', { name: 'Community questions', exact: true }).waitFor();
  assert.ok(await page.evaluate(() => !!(document.querySelector('#community-section').compareDocumentPosition(document.querySelector('#starting-references')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.getByText('An independent participant project. Not official Kane support.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('PASS: homepage copy, example-fill-only queries, zero/nonzero question ordering, existing-agent instructions and precise local status, persisted private unmatched-query draft, preview gate, session privacy, footer and mobile width.');
} finally { await browser?.close(); await f.close(); }
