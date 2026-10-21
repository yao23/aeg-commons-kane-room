// Real Chrome, two isolated browser contexts. All writes use a temporary SQLite DB.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture } from './helpers.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const f = await fixture();
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
const ca = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), cb = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const a = await ca.newPage(), b = await cb.newPage();
const errors: string[] = [];
for (const p of [a, b]) { p.setDefaultTimeout(15000); p.on('pageerror', err => errors.push(err.message)); }
const source = 'Synthetic browser acceptance observation; no actual Kane command was run.';
async function fillSource(p: any) { await p.locator('[name=source_kind]').selectOption('synthetic_sample'); await p.locator('[name=source_citation]').fill(source); }
async function publish(p: any) { await p.getByRole('button', { name: 'Preview public post' }).click(); await p.getByRole('heading', { name: 'Review before sharing' }).waitFor(); await p.locator('#publish-ack').check(); await p.getByRole('button', { name: 'Publish to the room' }).click(); await p.getByRole('heading', { name: 'Discussion & experience' }).waitFor(); }
try {
  await a.goto(f.origin); await b.goto(f.origin);
  await a.getByRole('heading', { name: 'Stuck with Kane? Don’t debug alone.' }).waitFor();
  await a.getByRole('textbox', { name: 'Your Kane problem' }).fill('submarine banana unrelated'); await a.getByRole('button', { name: 'Find help' }).click();
  await a.getByText('No matching public experience or document reference.', { exact: false }).waitFor();
  await a.getByRole('button', { name: 'Ask this question', exact: true }).click(); await a.getByRole('heading', { name: 'Ask the Kane room' }).waitFor();
  await a.locator('[name=title]').fill('Synthetic browser fixture: Kane configuration mismatch');
  await a.locator('[name=body]').fill('Synthetic browser acceptance question. No real Kane invocation or private log.');
  await a.locator('[name=environment]').fill('Synthetic conditions: CLI version unknown; local test only.'); await fillSource(a);
  await a.getByRole('button', { name: 'Preview public post' }).click(); await a.getByRole('heading', { name: 'Review before sharing' }).waitFor();
  assert.equal((await ca.cookies()).length, 1); // Server-issued session at preview.
  const before = await cb.request.get(f.origin + '/api/recent'); assert.equal((await before.json()).threads.length, 0);
  await a.getByRole('button', { name: 'Publish to the room' }).click(); assert.equal(await a.locator('#modal').isVisible(), true); // Acknowledgment enforced.
  await a.locator('#publish-ack').check(); await a.getByRole('button', { name: 'Publish to the room' }).click();
  await a.getByRole('heading', { name: 'Discussion & experience' }).waitFor(); const threadURL = a.url(); const threadId = threadURL.split('/').pop();
  await b.goto(threadURL); await b.getByRole('heading', { name: 'Discussion & experience' }).waitFor();
  assert.equal(await b.getByRole('link', { name: 'Edit my content', exact: true }).count(), 0);
  await a.getByRole('button', { name: 'Add a reply', exact: true }).click(); await a.locator('[name=body]').fill('PRIVATE_MARKER synthetic draft'); await fillSource(a); await a.getByRole('button', { name: 'Save private draft' }).click(); await a.getByText('Private draft saved. Only your browser session can see it.', { exact: true }).waitFor();
  const mine = await ca.request.get(f.origin + '/api/mine'), draft = (await mine.json()).entries.find((x: any) => x.status === 'draft'); assert.ok(draft);
  const bview = await cb.request.get(f.origin + '/api/threads/' + threadId); assert.ok(!JSON.stringify(await bview.json()).includes('PRIVATE_MARKER'));
  const foreignEdit = await cb.request.post(f.origin + '/api/previews', { headers: { Origin: f.origin }, data: { kind: 'reply', thread_id: threadId, id: draft.id, data: draft.data } }); assert.equal(foreignEdit.status(), 403);
  await b.getByRole('button', { name: 'Add a reply', exact: true }).click(); await b.locator('[name=body]').fill('Synthetic reply from an independent human browser session.'); await fillSource(b); await publish(b);
  const cookiesA = await ca.cookies(), cookiesB = await cb.cookies(); assert.notEqual(cookiesA[0].value, cookiesB[0].value); assert.ok(cookiesA[0].httpOnly); assert.equal(cookiesA[0].sameSite, 'Strict');
  await a.reload(); await a.getByText('Synthetic reply from an independent human browser session.', { exact: true }).waitFor();
  await a.getByRole('button', { name: 'Save experience', exact: true }).click();
  await a.locator('[name=title]').fill('Synthetic conditional experience'); await a.locator('[name=applies]').fill('Only when reproducing this synthetic fixture.'); await a.locator('[name=not_applies]').fill('Does not apply to real Kane without version checks.'); await a.locator('[name=method]').fill('Compare the stated environment and collect a minimal public-safe description.'); await fillSource(a); await publish(a);
  const card = a.locator('article').filter({ has: a.getByRole('heading', { name: 'Synthetic conditional experience', exact: true }) });
  await card.getByRole('button', { name: 'Copy to my agent' }).click(); const packageText = await a.locator('#copy-package').inputValue();
  for (const word of ['MANUAL COPY', 'UNVERIFIED', 'Only when reproducing', 'Does not apply', 'synthetic_sample', 'Sources:']) assert.ok(packageText.includes(word));
  await a.getByRole('button', { name: 'Copy package', exact: true }).click(); await a.getByRole('button', { name: 'Close', exact: true }).click();
  await b.reload(); await b.getByRole('heading', { name: 'Synthetic conditional experience', exact: true }).waitFor();
  await b.locator('article').filter({ has: b.getByRole('heading', { name: 'Synthetic conditional experience', exact: true }) }).getByRole('button', { name: 'Report outcome', exact: true }).click();
  await b.locator('[name=result]').selectOption('failed'); await b.locator('[name=body]').fill('Synthetic failure: conditions were insufficient. No actual Kane execution.'); await fillSource(b); await publish(b);
  await a.reload(); await a.getByText('Synthetic failure: conditions were insufficient. No actual Kane execution.', { exact: true }).waitFor();
  assert.ok(await a.getByText('UNVERIFIED', { exact: true }).count() >= 4);
  await a.getByRole('link', { name: 'Back to the room', exact: false }).click(); await a.getByRole('textbox', { name: 'Your Kane problem' }).fill('conditional experience'); await a.getByRole('button', { name: 'Find help' }).click(); await a.getByRole('heading', { name: 'Synthetic conditional experience' }).waitFor();
  await f.stop(); await f.start(); await a.goto(threadURL); await b.reload();
  await a.getByText('Synthetic failure: conditions were insufficient. No actual Kane execution.', { exact: true }).waitFor();
  assert.ok(await a.getByRole('link', { name: 'Review / edit draft' }).count() >= 1); assert.equal(await b.getByText('PRIVATE_MARKER synthetic draft', { exact: true }).count(), 0);
  const mineAfterRestart = await ca.request.get(f.origin + '/api/mine'); assert.ok((await mineAfterRestart.json()).entries.find((x: any) => x.id === draft.id));
  await a.locator('#agents-panel summary').click();
  await a.locator('[name=direct]').check(); await a.locator('[name=acknowledged]').check();
  await a.getByRole('button', { name: 'Issue scoped credentials', exact: true }).click();
  await a.getByRole('heading', { name: '10-minute discussion authorized', exact: true }).waitFor();
  assert.equal(await a.locator('#modal textarea').count(), 2);
  await a.getByRole('button', { name: 'I have stored the credentials · close', exact: true }).click();
  await a.getByRole('button', { name: 'Revoke now', exact: true }).click();
  await a.getByText('REVOKED', { exact: true }).waitFor();
  const malicious = await cb.request.post(f.origin + '/api/drafts', { headers: { Origin: f.origin }, data: { kind: 'reply', thread_id: threadId, data: { body: 'forged', sources: [{ kind: 'user_report', citation: 'fixture' }], verified: true } } }); assert.equal(malicious.status(), 400);
  // Script-like post text stays text. This public fixture is isolated from the actual app database.
  const xss = await cb.request.post(f.origin + '/api/previews', { headers: { Origin: f.origin }, data: { kind: 'reply', thread_id: threadId, data: { body: '<img src=x onerror="window.XSS=true">', sources: [{ kind: 'synthetic_sample', citation: source }] } } }); const xp = await xss.json();
  assert.equal(xss.status(), 201); await cb.request.post(f.origin + '/api/publish', { headers: { Origin: f.origin }, data: { preview_id: xp.preview_id, acknowledged: true } });
  await b.reload(); await b.getByText('<img src=x onerror="window.XSS=true">', { exact: true }).waitFor(); assert.equal(await b.evaluate(() => (window as any).XSS), undefined);
  await b.setViewportSize({ width: 390, height: 844 }); await b.goto(f.origin); await b.getByRole('heading', { name: 'Stuck with Kane? Don’t debug alone.' }).waitFor();
  assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []); assert.equal(f.errors, '');
  console.log('PASS: two isolated Chrome contexts; public preview + acknowledgment; private drafts; cross-session denial; human reply; source labels + unverified; conditional card; manual copy package; failed feedback; matching + irrelevant search; restart durability; cookie ownership after restart; spoof rejection; stored XSS as text; grant issuance/revocation UI; 390px responsive layout.');
} finally { await browser.close(); await f.close(); }
