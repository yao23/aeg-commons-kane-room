import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, sensitivity } from '../src/store.ts';
const source = [{ kind: 'synthetic_sample', citation: 'Synthetic acceptance fixture; no real Kane execution.' }];
const question = { title: 'Synthetic Kane fixture: configuration mismatch', body: 'A synthetic CLI fixture reports inconsistent configuration. No actual Kane run.', environment: 'Synthetic Node test environment, no private logs.', sources: source };
function setup(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'kane-store-')); let clock = 1000000;
  const store = new Store(join(dir, 'db.sqlite'), () => clock);
  t.after(() => { store.db.close(); rmSync(dir, { recursive: true, force: true }); });
  const a = store.session().id, b = store.session().id;
  function publish(owner: string, kind: any, thread: any, data: any, id?: string) { const p = store.preview(owner, kind, thread, data, id); return store.publish(owner, p.preview_id, true)!; }
  return { store, a, b, publish, tick: (ms: number) => { clock += ms; } };
}
test('public preview is required, one-use, owner-bound and time-limited', t => {
  const { store:s, a, b, tick } = setup(t); const p = s.preview(a, 'thread', null, question);
  assert.throws(() => s.publish(b, p.preview_id, true), /Preview expired/);
  assert.throws(() => s.publish(a, p.preview_id, false), /acknowledge/);
  const q = s.publish(a, p.preview_id, true)!; assert.equal(q.verification, 'unverified');
  assert.throws(() => s.publish(a, p.preview_id, true), /Preview expired/);
  const later = s.preview(a, 'thread', null, question); tick(600001);
  assert.throws(() => s.publish(a, later.preview_id, true), /Preview expired/);
});
test('draft secrecy, ownership, and stale public edits', t => {
  const { store:s, a, b, publish } = setup(t); const draft = s.draft(a, 'thread', null, question)!;
  assert.throws(() => s.thread(draft.id, b), /not found/); assert.equal(s.search('configuration', b).results.length, 0);
  assert.throws(() => s.draft(b, 'thread', null, question, draft.id), /Only your session/);
  const q = publish(a, 'thread', null, question, draft.id);
  assert.throws(() => s.preview(b, 'thread', null, question, q.id), /Only your session/);
  const first = s.preview(a, 'thread', null, { ...question, title: 'Earlier edit' }, q.id);
  publish(a, 'thread', null, { ...question, title: 'Later edit' }, q.id);
  assert.throws(() => s.publish(a, first.preview_id, true), /Content changed/);
});
test('cannot publish children of private questions; outcome cannot reference another thread card', t => {
  const { store:s, a, publish } = setup(t); const q = s.draft(a, 'thread', null, question)!;
  assert.throws(() => s.preview(a, 'reply', q.id, { body: 'Would leak the private thread', sources: source }), /Publish the question/);
  const t1 = publish(a, 'thread', null, question), t2 = publish(a, 'thread', null, question);
  const c = publish(a, 'card', t1.id, { title: 'Method', applies: 'A', not_applies: 'B', method: 'C', sources: source });
  assert.throws(() => s.preview(a, 'outcome', t2.id, { result: 'failed', body: 'Wrong card', sources: source, card_id: c.id }), /Choose a card/);
});
test('identity and trust cannot be forged; unofficial and synthetic sources remain distinguished', t => {
  const { store:s, a } = setup(t);
  for (const injected of [{ verified: true }, { author: 'Official' }, { origin: 'mcp_client' }]) assert.throws(() => s.draft(a, 'thread', null, { ...question, ...injected }), /Unexpected fields/);
  assert.throws(() => s.draft(a, '__proto__' as any, null, question), /Unknown content/);
  assert.throws(() => s.draft(a, 'thread', null, { ...question, sources: [{ kind: 'official_reference', citation: 'Untrusted claim' }] }), /Only an operator/);
  const q = s.draft(a, 'thread', null, question)!; assert.equal(q.author.kind, 'human'); assert.equal(q.data.sources[0].kind, 'synthetic_sample');
});
test('sensitive checks block preview, but make no completeness guarantee', t => {
  const { store:s, a } = setup(t);
  for (const body of ['api_key=secret12345', 'person@example.invalid', '-----BEGIN PRIVATE KEY-----']) {
    assert.ok(sensitivity(body).length); assert.throws(() => s.preview(a, 'thread', null, { ...question, body }), /detected/);
  }
});
test('public search returns matches, no irrelevant matches, and curated document citations', t => {
  const { store:s, a, publish } = setup(t); publish(a, 'thread', null, question);
  s.setReferences([{ id: 'test-ref', title: 'Synthetic configuration document', summary: 'Synthetic reference for fixture mismatch.', url: 'https://example.invalid/reference', source_kind: 'synthetic_sample' }]);
  assert.equal(s.search('configuration').results.length, 1); assert.equal(s.search('configuration').references.length, 1);
  const none = s.search('underwater banana hyperspace'); assert.equal(none.results.length + none.references.length, 0); assert.match(none.message, /No matching/);
});
test('experience package preserves conditions, exclusions, version, provenance, and failed outcome', t => {
  const { store:s, a, b, publish } = setup(t); const q = publish(a, 'thread', null, question);
  const card = publish(b, 'card', q.id, { title: 'Synthetic card', applies: 'Only synthetic fixtures', not_applies: 'Real Kane execution', method: 'Compare conditions before any action.', sources: source });
  const copy = s.copy(card.id); assert.equal(copy.mode, 'manual_copy');
  for (const phrase of ['MANUAL COPY', 'UNVERIFIED', 'Only synthetic fixtures', 'Real Kane execution', 'synthetic_sample', card.id]) assert.ok(copy.text.includes(phrase));
  const out = publish(a, 'outcome', q.id, { result: 'failed', body: 'Synthetic failure evidence only.', sources: source, card_id: card.id }); assert.equal(out.data.result, 'failed'); assert.equal(out.verification, 'unverified');
});
function grant(t: any, direct = true) {
  const f = setup(t); const q = f.publish(f.a, 'thread', null, question);
  const g = f.store.collaboration(f.a, { thread_id: q.id, selected_ids: [q.id], agent_labels: ['Real client A label', 'Real client B label'], direct, acknowledged: true });
  return { ...f, q, g, call: (i: number, name: string, args: any) => f.store.agentTool(g.agents[i].token, name, args) };
}
test('agent default is private draft; another visitor and other agents cannot read it', t => {
  const { store:s, a, b, q, call } = grant(t);
  const r = call(0, 'propose_reply', { thread_id: q.id, body: 'Synthetic draft proposal.', source_ids: [q.id] });
  assert.equal(r.mode, 'draft'); assert.equal(r.entry.author.kind, 'agent'); assert.equal(r.entry.origin, 'mcp_client');
  assert.equal(s.thread(q.id, b).entries.length, 0); assert.equal(s.thread(q.id, a).entries.length, 1);
  assert.equal(call(1, 'get_thread', { thread_id: q.id }).discussion.length, 0);
});
test('two protocol principals exchange only grant discussion, max 3 each; not a real-client test', t => {
  const { q, call } = grant(t);
  for (let round = 0; round < 3; round++) for (const i of [0, 1]) {
    const r = call(i, 'propose_reply', { thread_id: q.id, body: `Synthetic protocol principal ${i} round ${round}.`, source_ids: [q.id], mode: 'discuss' }); assert.equal(r.remaining, 2 - round);
  }
  assert.equal(call(0, 'get_thread', { thread_id: q.id }).discussion.length, 6);
  assert.throws(() => call(0, 'propose_reply', { thread_id: q.id, body: 'Over limit', source_ids: [q.id], mode: 'discuss' }), /unavailable/);
});
test('snapshot excludes nonselected material and later edits; one-thread scope enforced', t => {
  const { store:s, a, q, call, publish } = grant(t);
  const hidden = publish(a, 'reply', q.id, { body: 'Nonselected public material.', sources: source });
  publish(a, 'thread', null, { ...question, title: 'Edited after grant' }, q.id);
  const r = call(0, 'get_thread', { thread_id: q.id }); assert.equal(r.selected_materials[0].data.title, question.title); assert.equal(r.discussion.length, 0);
  assert.throws(() => call(0, 'get_thread', { thread_id: hidden.id }), /one thread/);
  assert.throws(() => call(0, 'propose_reply', { thread_id: q.id, body: 'Wrong source', source_ids: [hidden.id] }), /selected public/);
});
test('revocation, 10-minute expiry and owner-only authorization are server-enforced', t => {
  const { store:s, b, a, q, g, call, tick } = grant(t);
  assert.equal(g.expires - s.now(), 600000);
  assert.throws(() => s.revoke(b, g.id), /not found/);
  assert.throws(() => s.collaboration(b, { thread_id: q.id, selected_ids: [q.id], agent_labels: ['A', 'B'], direct: true, acknowledged: true }), /Only the public thread owner/);
  tick(600001); assert.throws(() => call(0, 'get_thread', { thread_id: q.id }), /expired/);
  s.revoke(a, g.id); assert.throws(() => call(1, 'get_thread', { thread_id: q.id }), /revoked/);
});
test('draft-only scope rejects public discussion; outcomes always draft; concrete decision question', t => {
  const { q, call } = grant(t, false);
  assert.throws(() => call(0, 'propose_reply', { thread_id: q.id, body: 'Too broad', source_ids: [q.id], mode: 'discuss' }), /unavailable/);
  const result = call(0, 'submit_outcome', { thread_id: q.id, result: 'not_applicable', body: 'Synthetic mismatch', source_ids: [q.id] }); assert.equal(result.entry.status, 'draft');
  const r = call(0, 'propose_reply', { thread_id: q.id, body: 'Conflicting conditions need clarification.', source_ids: [q.id], decision_question: 'Which CLI version should this advice target?' }); assert.match(r.entry.data.decision_question, /CLI version/);
});
test('agent cannot forge trust, upload sources, execute commands, or publish raw logs', t => {
  const { q, call } = grant(t);
  assert.throws(() => call(0, 'propose_reply', { thread_id: q.id, body: 'Trust me', source_ids: [q.id], verified: true }), /Unexpected/);
  assert.throws(() => call(0, 'execute', { command: 'anything' }), /Unknown tool/);
  assert.throws(() => call(0, 'propose_reply', { thread_id: q.id, body: '```raw log```', source_ids: [q.id], mode: 'discuss' }), /Raw logs/);
  assert.throws(() => call(0, 'propose_reply', { thread_id: q.id, body: 'api_key=private12345', source_ids: [q.id], mode: 'discuss' }), /detected/);
});
test('active out-of-scope attempts queue one private concrete owner decision without rejected payload', t => {
  const { store:s, a, b, q, call } = grant(t);
  for (let i = 0; i < 2; i++) assert.throws(() => call(0, 'get_thread', { thread_id: 'OUTSIDE_PRIVATE_TARGET' }), (err: any) => !!err.question && err.status === 403);
  const drafts = s.thread(q.id, a).entries.filter((x: any) => x.status === 'draft'); assert.equal(drafts.length, 1);
  assert.ok(drafts[0].data.decision_question); assert.ok(!JSON.stringify(drafts).includes('OUTSIDE_PRIVATE_TARGET')); assert.equal(s.thread(q.id, b).entries.length, 0);
});
test('human edits of an agent draft keep explicit edit provenance', t => {
  const { store:s, a, q, call } = grant(t);
  const draft = call(0, 'propose_reply', { thread_id: q.id, body: 'Original synthetic agent proposal.', source_ids: [q.id] }).entry;
  const data = { ...draft.data, body: 'Human revised this synthetic proposal.' };
  const preview = s.preview(a, 'reply', q.id, data, draft.id); assert.equal(preview.origin, 'mcp_client_human_edited');
  const entry = s.publish(a, preview.preview_id, true)!; assert.equal(entry.origin, 'mcp_client_human_edited'); assert.equal(entry.verification, 'unverified');
});
test('an unmatched query can remain a private incomplete thread draft but cannot be published incomplete', t => {
  const { store:s, a, b } = setup(t);
  const data = { title: 'Unmatched Kane question', body: 'Unmatched Kane question', environment: '', sources: [] };
  const draft = s.draft(a, 'thread', null, data)!;
  assert.equal(draft.status, 'draft'); assert.deepEqual(draft.data, data);
  assert.equal(s.mine(a).length, 1); assert.equal(s.mine(b).length, 0);
  assert.throws(() => s.thread(draft.id, b), /not found/);
  assert.equal(s.search('Unmatched').results.length, 0);
  assert.throws(() => s.preview(a, 'thread', null, data, draft.id), /environment|sources/);
  assert.throws(() => s.preview(b, 'thread', null, { ...question }, draft.id), /Only your session/);
});
