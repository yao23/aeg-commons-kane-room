import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importReferenceSeed, mapReferenceSeed } from '../src/references.ts';
import { Store } from '../src/store.ts';
import { fixture, publicEntry, sampleQuestion, root } from './helpers.ts';
const seedPath = root + 'kane-official-reference-seed.en.json';
const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
const ids = ['kane-doc-command-completion', 'kane-doc-share-evidence-safely', 'kane-doc-interaction-checks'];
function temp(t: any) { const dir = mkdtempSync(join(tmpdir(), 'kane-reference-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
test('seed maps into existing reference model, keeps all source/summary/boundary/NOT_RUN fields', () => {
  const mapped = mapReferenceSeed(seed); assert.deepEqual(mapped.map(r => r.id), ids);
  for (let i = 0; i < mapped.length; i++) {
    const r = mapped[i]; for (const key of Object.keys(seed.records[i])) assert.deepEqual(r[key], seed.records[i][key]);
    assert.equal(r.summary, r.short_answer); assert.equal(r.verification_status, 'NOT_RUN'); assert.equal(r.tested_cli_version, null); assert.equal(r.real_user_question, false); assert.equal(r.source_kind, 'official_reference');
    for (const s of r.sources) assert.deepEqual(s, { id: s.id, ...seed.sources[s.id] });
  }
});
test('import twice is byte-idempotent, preserves preexisting references and never touches user entries', t => {
  const dir = temp(t), target = join(dir, 'curated-references.json');
  const userRef = { id: 'existing-user-citation', title: 'User-maintained reference', summary: 'Keep this exact record.', url: 'https://example.invalid/manual', source_kind: 'synthetic_sample' };
  writeFileSync(target, JSON.stringify([userRef]));
  const s = new Store(join(dir, 'db.sqlite')); t.after(() => s.db.close());
  s.draft(s.session().id, 'thread', null, sampleQuestion); const before = s.db.prepare('SELECT * FROM entries').all();
  assert.deepEqual(importReferenceSeed(seedPath, target).inserted, ids);
  const once = readFileSync(target, 'utf8'); const repeated = importReferenceSeed(seedPath, target);
  assert.deepEqual(repeated.unchanged, ids); assert.equal(repeated.total, 4); assert.equal(readFileSync(target, 'utf8'), once);
  assert.deepEqual(JSON.parse(once)[0], userRef); assert.deepEqual(s.db.prepare('SELECT * FROM entries').all(), before);
  s.setReferences(JSON.parse(once)); assert.equal(s.references.length, 4); assert.ok(s.references.every(r => !('_seed' in r)));
});
test('modified same-ID and unmanaged same-ID records are skipped and reported, not overwritten', t => {
  const dir = temp(t), target = join(dir, 'curated-references.json'); importReferenceSeed(seedPath, target);
  const current = JSON.parse(readFileSync(target, 'utf8')); current[0].summary = 'User edited summary; must survive.'; delete current[1]._seed;
  writeFileSync(target, JSON.stringify(current, null, 2)); const before = readFileSync(target, 'utf8');
  const r = importReferenceSeed(seedPath, target); assert.deepEqual(r.skipped.map((x: any) => x.id), ids.slice(0, 2)); assert.deepEqual(r.unchanged, ids.slice(2)); assert.equal(r.total, 3); assert.equal(readFileSync(target, 'utf8'), before);
});
test('reference revision changes require unmodified managed content; invalid NOT_RUN state changes nothing', t => {
  const dir = temp(t), target = join(dir, 'curated-references.json'), updatePath = join(dir, 'seed.json'); importReferenceSeed(seedPath, target);
  const next = structuredClone(seed); next.records[0].revision = 2; next.records[0].short_answer += ' Explicit revision update.'; writeFileSync(updatePath, JSON.stringify(next));
  assert.deepEqual(importReferenceSeed(updatePath, target).updated, [ids[0]]);
  const before = readFileSync(target, 'utf8'); next.records[1].verification_status = 'VERIFIED'; writeFileSync(updatePath, JSON.stringify(next));
  assert.throws(() => importReferenceSeed(updatePath, target), /NOT_RUN/); assert.equal(readFileSync(target, 'utf8'), before);
});
test('Web and authenticated MCP search share reference objects; references are excluded from community entries', async t => {
  const f = await fixture(); t.after(() => f.close()); const owner = f.client();
  const docs = (await owner.request('/references')).data.references; assert.deepEqual(docs.map((r: any) => r.id), ids);
  assert.equal((await owner.request('/recent')).data.threads.length, 0);
  assert.equal((await owner.request('/mine')).data.entries.length, 0);
  const q = await publicEntry(owner, 'thread', null, sampleQuestion);
  const grant = await owner.request('/collaborations', { thread_id: q.id, selected_ids: [q.id], agent_labels: ['Protocol reference test A', 'Protocol reference test B'], direct: false, acknowledged: true });
  for (const [query, id] of [['run_end', ids[0]], ['evidence serve', ids[1]], ['resend', ids[2]]]) {
    const web = (await owner.request('/search?q=' + encodeURIComponent(query))).data;
    const mcp = await owner.request('/agent/tools', { name: 'search_room', arguments: { query } }, { Authorization: 'Bearer ' + grant.data.agents[0].token });
    assert.equal(mcp.status, 200); assert.deepEqual(mcp.data.references, web.references); assert.ok(web.references.some((r: any) => r.id === id));
    for (const r of web.references) { assert.equal(r.verification_status, 'NOT_RUN'); assert.equal(r.tested_cli_version, null); assert.equal(r.source_review_date, '2026-10-20'); assert.ok(r.documented_notes.length); assert.ok(r.aeg_suggestions.length); assert.ok(r.applies_when.length); assert.ok(r.does_not_establish.length); }
  }
  assert.equal((await owner.request('/search?q=submarine%20banana%20unrelated')).data.references.length, 0);
  assert.equal((await owner.request('/recent')).data.threads.length, 1); // Only the synthetic question created by this temporary test.
  assert.equal((await owner.request('/mine')).data.entries.length, 1);
});
