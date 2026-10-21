import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fixture, publicEntry, sampleQuestion, sampleSources, root } from './helpers.ts';
test('HTTP: independent cookies, access control, persistence, same-origin and safe rendering headers', async t => {
  const f = await fixture(); t.after(() => f.close()); const a = f.client(), b = f.client();
  const q = await publicEntry(a, 'thread', null, sampleQuestion);
  const draft = await a.request('/drafts', { kind: 'reply', thread_id: q.id, data: { body: 'Private synthetic draft', sources: sampleSources } });
  assert.ok(a.cookie); assert.equal((await b.request('/mine')).data.entries.length, 0);
  assert.equal((await b.request('/threads/' + q.id)).data.entries.length, 0);
  assert.equal((await b.request('/previews', { kind: 'reply', thread_id: q.id, id: draft.data.id, data: draft.data.data })).status, 403);
  assert.notEqual(a.cookie, b.cookie);
  const rb = await publicEntry(b, 'reply', q.id, { body: 'Independent visitor synthetic reply.', sources: sampleSources });
  assert.equal(rb.author.kind, 'human'); assert.equal(rb.verification, 'unverified');
  assert.equal((await a.request('/threads/' + q.id)).data.entries.length, 2);
  assert.equal((await b.request('/threads/' + q.id)).data.entries.length, 1);
  assert.equal((await b.request('/drafts', { kind: 'thread', thread_id: null, data: { ...sampleQuestion, verified: true } })).status, 400);
  const csrf = await fetch(f.origin + '/api/session', { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(csrf.status, 403);
  const missingOrigin = await fetch(f.origin + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(missingOrigin.status, 403);
  const page = await fetch(f.origin); assert.match(page.headers.get('content-security-policy')!, /script-src 'self'/); assert.match(a.cookie, /^kane_session=/);
  await f.stop(); await f.start();
  const persisted = (await a.request('/threads/' + q.id)).data;
  assert.equal(persisted.thread.id, q.id); assert.equal(persisted.thread.mine, true); assert.equal(persisted.entries.length, 2);
  assert.equal((await b.request('/threads/' + q.id)).data.entries.length, 1);
  assert.equal((await a.request('/search?q=unrelated%20banana%20submarine')).data.results.length, 0);
  assert.equal(f.errors, '');
});
test('MCP stdio protocol talks to the same backend, draft-by-default and bounded reply; NOT a real-agent test', async t => {
  const f = await fixture(); t.after(() => f.close()); const a = f.client(); const q = await publicEntry(a, 'thread', null, sampleQuestion);
  const grant = await a.request('/collaborations', { thread_id: q.id, selected_ids: [q.id], agent_labels: ['Protocol fixture A', 'Protocol fixture B'], direct: true, acknowledged: true });
  assert.equal(grant.status, 201);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', root + 'src/mcp.ts'], { env: { ...process.env, KANE_BACKEND: f.origin, KANE_AGENT_TOKEN: grant.data.agents[0].token }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill()); let id = 0; const pending = new Map();
  createInterface({ input: child.stdout }).on('line', line => { const m = JSON.parse(line); pending.get(m.id)?.(m); pending.delete(m.id); });
  function rpc(method: string, params: any = {}) { const next = ++id; return new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('MCP timeout')), 10000); pending.set(next, (m: any) => { clearTimeout(timer); resolve(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); }); }
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'protocol-fixture', version: '1' } }); assert.equal(init.result.protocolVersion, '2025-11-25');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listed = await rpc('tools/list'); assert.deepEqual(listed.result.tools.map((x: any) => x.name), ['search_room', 'get_thread', 'propose_reply', 'submit_outcome']);
  for (const query of ['run_end', 'evidence serve', 'resend']) {
    const web = (await a.request('/search?q=' + encodeURIComponent(query))).data.references;
    const response = await rpc('tools/call', { name: 'search_room', arguments: { query } });
    assert.equal(response.result.isError, false);
    const refs = JSON.parse(response.result.content[0].text).references;
    assert.deepEqual(refs, web); assert.ok(refs.length); assert.ok(refs.every((r: any) => r.verification_status === 'NOT_RUN'));
  }
  const reply = await rpc('tools/call', { name: 'propose_reply', arguments: { thread_id: q.id, body: 'Synthetic stdio proposal.', source_ids: [q.id] } }); assert.equal(reply.result.isError, false); assert.equal(JSON.parse(reply.result.content[0].text).mode, 'draft');
  const direct = await rpc('tools/call', { name: 'propose_reply', arguments: { thread_id: q.id, body: 'Synthetic stdio discussion.', source_ids: [q.id], mode: 'discuss' } }); assert.equal(direct.result.isError, false);
  const outsider = f.client(); assert.equal((await outsider.request('/threads/' + q.id)).data.entries.length, 1);
  await a.request('/collaborations/' + grant.data.id + '/revoke', {});
  const denied = await rpc('tools/call', { name: 'get_thread', arguments: { thread_id: q.id } }); assert.equal(denied.result.isError, true);
});
test('homepage question ordering count excludes documentation, private drafts and synthetic samples', async t => {
  const f = await fixture(); t.after(() => f.close()); const a = f.client();
  assert.equal((await a.request('/recent')).data.real_question_count, 0);
  const draft = await a.request('/drafts', { kind: 'thread', thread_id: null, data: { title: 'Unmatched fixture', body: 'Original query', environment: '', sources: [] } }); assert.equal(draft.status, 201);
  assert.equal((await a.request('/recent')).data.real_question_count, 0);
  await publicEntry(a, 'thread', null, sampleQuestion);
  assert.equal((await a.request('/recent')).data.real_question_count, 0);
  // This temporary fixture exercises the user-report classification; it is not community activity.
  await publicEntry(a, 'thread', null, { ...sampleQuestion, sources: [{ kind: 'user_report', citation: 'Synthetic test of the user-report classification, not a real Kane observation.' }] });
  assert.equal((await a.request('/recent')).data.real_question_count, 1);
});
