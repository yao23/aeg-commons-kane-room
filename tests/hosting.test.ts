// Local-only hosted-mode and HTTPS transport simulations. No cloud, device, or model-client test is claimed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createTLS, request as httpsRequest } from 'node:https';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { readAppConfig, readAdapterBackend, normalizePeer } from '../src/config.ts';
import { fixture, freePort, root, sampleQuestion } from './helpers.ts';

type Values = Record<string, string | undefined>;
const cleanEnv = (): Values => ({ ...process.env, APP_MODE: 'local', LISTEN_HOST: '127.0.0.1', TRUSTED_PROXIES: '', DB_PATH: undefined, APP_ORIGIN: undefined, PORT: undefined });
function scratch(t: any) { const dir = mkdtempSync(join(tmpdir(), 'kane-hosting-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function hostedEnv(dir: string): Values { return { APP_MODE: 'hosted', LISTEN_HOST: '127.0.0.1', PORT: '4317', APP_ORIGIN: 'https://room.example.test', DB_PATH: join(dir, 'room.sqlite'), TRUSTED_PROXIES: '127.0.0.1' }; }
async function hosted(t: any, override: Values = {}) {
  const dir = scratch(t), port = await freePort();
  const env = { ...cleanEnv(), ...hostedEnv(dir), PORT: String(port), ...override };
  let child: any, errors = '';
  async function start() {
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', (b: any) => { errors += b; });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Hosted simulation startup timeout')), 8000);
      child.stdout.on('data', (b: any) => { if (String(b).includes('Public origin:')) { clearTimeout(timer); resolve(); } });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Hosted simulation exited: ' + errors)); });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; } }
  t.after(stop); await start();
  return { port, origin: env.APP_ORIGIN!, dir, start, stop, get errors() { return errors; } };
}
async function wire(port: number, path: string, body?: any, headers: any = {}, tls?: { origin: string; ca: Buffer }) {
  return new Promise<any>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = (tls ? httpsRequest : httpRequest)({ hostname: '127.0.0.1', port, path, method: data === undefined ? 'GET' : 'POST', ...(tls ? { ca: tls.ca } : {}), headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', b => { text += b; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(text) }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('Simulation request timeout'))); req.on('error', reject); req.end(data);
  });
}
function browserClient(port: number, origin: string, tls?: { origin: string; ca: Buffer }) {
  let cookie = '';
  return { get cookie() { return cookie; }, async request(path: string, body?: any, extra: any = {}) {
    const r = await wire(port, path, body, { Host: new URL(origin).host, ...(tls ? {} : { 'X-Forwarded-Proto': 'https' }), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { Origin: origin }), ...extra }, tls);
    if (r.headers['set-cookie']) cookie = r.headers['set-cookie'][0].split(';')[0]; return r;
  } };
}
async function publish(client: any, kind: string, thread_id: string | null, data: any) {
  const p = await client.request('/api/previews', { kind, thread_id, data }); assert.equal(p.status, 201);
  const r = await client.request('/api/publish', { preview_id: p.data.preview_id, acknowledged: true }); assert.equal(r.status, 201); return r.data;
}
async function stdio(t: any, backend: string, token: string, ca?: string) {
  const env = { ...process.env, KANE_BACKEND: backend, KANE_AGENT_TOKEN: token, NODE_TLS_REJECT_UNAUTHORIZED: '1' };
  delete env.NODE_EXTRA_CA_CERTS; if (ca) env.NODE_EXTRA_CA_CERTS = ca;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', root + 'src/mcp.ts'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let id = 0, stderr = ''; const pending = new Map<number, any>();
  child.stderr.on('data', b => { stderr += b; });
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => { const m = JSON.parse(line); pending.get(m.id)?.(m); pending.delete(m.id); });
  t.after(() => { reader.close(); child.kill(); assert.ok(!stderr.includes(token), 'Credential leaked on adapter stderr.'); });
  async function rpc(method: string, params: any = {}) {
    const next = ++id;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Adapter simulation timeout')), 15000);
      pending.set(next, (m: any) => { clearTimeout(timer); resolve(m); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
    });
  }
  await rpc('initialize', { protocolVersion: '2025-11-25' });
  return { rpc, call: (name: string, args: any = {}) => rpc('tools/call', { name, arguments: args }) };
}

test('local configuration retains loopback, 4317, HTTP, SQLite and non-Secure cookie defaults', () => {
  const c = readAppConfig({}, '/fixture-project');
  assert.equal(c.mode, 'local'); assert.equal(c.listenHost, '127.0.0.1'); assert.equal(c.port, 4317); assert.equal(c.origin, 'http://127.0.0.1:4317'); assert.equal(c.dbPath, '/fixture-project/data/kane.sqlite'); assert.equal(c.secureCookie, false); assert.deepEqual(c.trustedProxies, []);
  for (const env of [{ LISTEN_HOST: '0.0.0.0' }, { APP_ORIGIN: 'http://other.example.test:4317' }, { PORT: '' }, { PORT: '0' }, { PORT: 'NaN' }, { PORT: '65536' }, { APP_MODE: 'production' }]) assert.throws(() => readAppConfig(env, '/fixture-project'));
});
test('hosted mode requires valid HTTPS origin, absolute DB path and exact proxy configuration', t => {
  const env = hostedEnv(scratch(t)); const c = readAppConfig({ ...env, LISTEN_HOST: '0.0.0.0', PORT: '8080' }, root);
  assert.equal(c.port, 8080); assert.equal(c.host, 'room.example.test'); assert.equal(c.origin, 'https://room.example.test'); assert.equal(c.secureCookie, true);
  for (const patch of [{ APP_ORIGIN: undefined }, { APP_ORIGIN: '' }, { APP_ORIGIN: 'http://room.example.test' }, { APP_ORIGIN: 'https://room.example.test:0' }, { APP_ORIGIN: 'https://user:private@room.example.test' }, { APP_ORIGIN: 'https://room.example.test/path/..' }, { APP_ORIGIN: 'https://room.example.test/?' }, { APP_ORIGIN: 'https://room.example.test/#' }, { DB_PATH: undefined }, { DB_PATH: '' }, { DB_PATH: ':memory:' }, { DB_PATH: 'relative.sqlite' }, { TRUSTED_PROXIES: '' }, { TRUSTED_PROXIES: '*' }, { TRUSTED_PROXIES: 'true' }, { TRUSTED_PROXIES: '127.0.0.1/8' }, { TRUSTED_PROXIES: 'localhost' }]) assert.throws(() => readAppConfig({ ...env, ...patch }, root));
  assert.equal(normalizePeer('::ffff:127.0.0.1'), '127.0.0.1'); assert.equal(normalizePeer('::FFFF:7F00:1'), '127.0.0.1'); assert.equal(normalizePeer('0:0:0:0:0:0:0:1'), '::1');
});
test('invalid hosted disk mount fails startup without creating a fallback directory or database', t => {
  const dir = scratch(t), missing = join(dir, 'missing-mount', 'room.sqlite');
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], { cwd: root, env: { ...cleanEnv(), ...hostedEnv(dir), DB_PATH: missing }, encoding: 'utf8', timeout: 8000 });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /parent must already exist/); assert.equal(existsSync(join(dir, 'missing-mount')), false);
});
test('local HTTP rejects wrong Host/Origin and does not trust forwarding headers or change cookie flags', async t => {
  const f = await fixture(); t.after(() => f.close()); const port = Number(new URL(f.origin).port);
  const good = await wire(port, '/api/session', {}, { Host: new URL(f.origin).host, Origin: f.origin, Forwarded: 'for=127.0.0.1;proto=https;host=room.example.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'room.example.test' });
  assert.equal(good.status, 200); assert.match(good.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/); assert.ok(!good.headers['set-cookie'][0].includes('Secure'));
  assert.equal((await wire(port, '/api/health', undefined, { Host: 'evil.example.test', 'X-Forwarded-Host': new URL(f.origin).host })).status, 403);
  assert.equal((await wire(port, '/api/session', {}, { Host: new URL(f.origin).host, Origin: 'https://evil.example.test', Forwarded: `host=${new URL(f.origin).host};proto=http` })).status, 403);
  assert.equal(good.headers['access-control-allow-origin'], undefined);
});
test('hosted boundary requires real trusted peer, preserved exact Host/Origin and a single HTTPS assertion', async t => {
  const f = await hosted(t); const headers = { Host: new URL(f.origin).host, 'X-Forwarded-Proto': 'https', Origin: f.origin };
  const r = await wire(f.port, '/api/session', {}, headers); assert.equal(r.status, 200);
  const cookie = r.headers['set-cookie'][0]; assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /; Secure/); assert.ok(!cookie.includes('Domain='));
  for (const patch of [{ Host: 'wrong.example.test', 'X-Forwarded-Host': new URL(f.origin).host }, { Origin: 'http://room.example.test' }, { Origin: 'null' }, { Origin: '' }, { Origin: f.origin + '/' }, { 'X-Forwarded-Proto': 'http' }, { 'X-Forwarded-Proto': 'https, https' }]) assert.equal((await wire(f.port, '/api/session', {}, { ...headers, ...patch })).status, 403);
  assert.equal((await wire(f.port, '/api/health', undefined, { Host: new URL(f.origin).host, Forwarded: 'proto=https' })).status, 403);
  assert.equal((await wire(f.port, '/api/health', undefined, { ...headers, 'X-Forwarded-Host': 'evil.example.test', 'X-Forwarded-For': '192.0.2.4' })).status, 200); // Ignored, never used as identities.
  const duplicate = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: f.port, path: '/api/health', headers: ['Host', new URL(f.origin).host, 'Host', 'evil.example.test', 'X-Forwarded-Proto', 'https'] }, res => { res.resume(); resolve(res.statusCode!); }); req.on('error', reject); req.end();
  }); assert.equal(duplicate, 403);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});
test('untrusted socket cannot impersonate a configured proxy using Forwarded or X-Forwarded-*', async t => {
  const f = await hosted(t, { TRUSTED_PROXIES: '192.0.2.40' });
  const r = await wire(f.port, '/api/session', {}, { Host: new URL(f.origin).host, Origin: f.origin, Forwarded: 'for=192.0.2.40;proto=https;host=room.example.test', 'X-Forwarded-For': '192.0.2.40', 'X-Forwarded-Host': new URL(f.origin).host, 'X-Forwarded-Proto': 'https' });
  assert.equal(r.status, 403); assert.equal(r.headers['set-cookie'], undefined);
});
test('hosted restart keeps SQLite, session ownership, drafts, bounded quota and revocation rules', async t => {
  const f = await hosted(t), a = browserClient(f.port, f.origin), b = browserClient(f.port, f.origin);
  const q = await publish(a, 'thread', null, sampleQuestion);
  const privateData = { body: 'Synthetic private hosted-mode fixture.', sources: sampleQuestion.sources };
  const draft = await a.request('/api/drafts', { kind: 'reply', thread_id: q.id, data: privateData }); assert.equal(draft.status, 201);
  assert.equal((await b.request('/api/threads/' + q.id)).data.entries.length, 0);
  assert.equal((await b.request('/api/previews', { kind: 'reply', thread_id: q.id, id: draft.data.id, data: privateData })).status, 403);
  const g = await a.request('/api/collaborations', { thread_id: q.id, selected_ids: [q.id], agent_labels: ['Protocol hosted A', 'Protocol hosted B'], direct: true, acknowledged: true }); assert.equal(g.status, 201);
  assert.ok(g.data.expires - Date.now() <= 600000 && g.data.expires > Date.now());
  const agent = (name: string, args: any) => a.request('/api/agent/tools', { name, arguments: args }, { Authorization: 'Bearer ' + g.data.agents[0].token });
  const proposal = await agent('propose_reply', { thread_id: q.id, source_ids: [q.id], body: 'Synthetic default private proposal.' }); assert.equal(proposal.data.mode, 'draft');
  assert.equal((await b.request('/api/threads/' + q.id)).data.entries.length, 0);
  assert.equal((await agent('get_thread', { thread_id: 'another-thread' })).status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await agent('propose_reply', { thread_id: q.id, source_ids: [q.id], body: 'Synthetic discussion fixture.', mode: 'discuss' })).status, 200);
  assert.equal((await agent('propose_reply', { thread_id: q.id, source_ids: [q.id], body: 'Exceeds quota.', mode: 'discuss' })).status, 409);
  const outcome = await agent('submit_outcome', { thread_id: q.id, source_ids: [q.id], body: 'Synthetic fixture, no actual run.', result: 'not_applicable' }); assert.equal(outcome.data.entry.status, 'draft'); assert.equal(outcome.data.entry.verification, 'unverified');
  await a.request('/api/collaborations/' + g.data.id + '/revoke', {});
  await f.stop(); await f.start();
  const after = await a.request('/api/threads/' + q.id); assert.equal(after.data.thread.mine, true); assert.ok(after.data.entries.some((x: any) => x.id === draft.data.id && x.status === 'draft'));
  assert.equal((await b.request('/api/threads/' + q.id)).data.entries.length, 3);
  assert.equal((await agent('get_thread', { thread_id: q.id })).status, 403); assert.equal(f.errors, '');
});
test('adapter accepts explicit HTTPS only, keeps loopback HTTP, and rejects insecure origins and disabled TLS', () => {
  assert.equal(readAdapterBackend({}).origin, 'http://127.0.0.1:4317');
  assert.equal(readAdapterBackend({ KANE_BACKEND: 'https://room.example.test' }).origin, 'https://room.example.test');
  assert.equal(readAdapterBackend({ KANE_BACKEND: 'http://localhost:4317' }).protocol, 'http:');
  for (const value of ['http://room.example.test', 'http://localhost.evil.test', 'http://0.0.0.0:4317', 'http://192.0.2.1', 'https://user:secret@room.example.test', 'https://room.example.test/api', 'https://room.example.test/path/..', 'https://room.example.test?token=example', 'https://room.example.test#fragment', 'file:///tmp/backend', '']) assert.throws(() => readAdapterBackend({ KANE_BACKEND: value }));
  assert.throws(() => readAdapterBackend({ KANE_BACKEND: 'https://room.example.test', NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /verification must remain enabled/);
});
test('local TLS proxy simulation: stdio reaches HTTPS backend with scoped CA, rejects untrusted TLS and redirects', async t => {
  const dir = scratch(t), keyPath = join(dir, 'test.key'), certPath = join(dir, 'test.pem');
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' }); assert.equal(made.status, 0, 'OpenSSL is required for this local TLS simulation.');
  let backendPort = 0, redirectTo = '', received = 0, trapHits = 0;
  const trap = createServer((req, res) => { trapHits++; res.end('{}'); }); trap.listen(0, '127.0.0.1'); await once(trap, 'listening');
  t.after(() => { trap.closeAllConnections(); trap.close(); });
  const proxy = createTLS({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
    received++;
    if (redirectTo) { res.writeHead(307, { Location: redirectTo }); res.end(); return; }
    const upstream = httpRequest({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, upstreamResponse => { res.writeHead(upstreamResponse.statusCode!, upstreamResponse.headers); upstreamResponse.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end('{}'); }); req.pipe(upstream);
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const port = (proxy.address() as any).port, origin = `https://127.0.0.1:${port}`;
  const f = await hosted(t, { APP_ORIGIN: origin }); backendPort = f.port;
  const client = browserClient(port, origin, { origin, ca: readFileSync(certPath) });
  const q = await publish(client, 'thread', null, sampleQuestion);
  const g = await client.request('/api/collaborations', { thread_id: q.id, selected_ids: [q.id], agent_labels: ['TLS protocol A', 'TLS protocol B'], direct: false, acknowledged: true }); assert.equal(g.status, 201);
  const secret = g.data.agents[0].token;
  const adapter = await stdio(t, origin, secret, certPath);
  const read = await adapter.call('get_thread', { thread_id: q.id }); assert.equal(read.result.isError, false); assert.equal(JSON.parse(read.result.content[0].text).selected_materials[0].id, q.id);
  const draft = await adapter.call('propose_reply', { thread_id: q.id, source_ids: [q.id], body: 'Synthetic HTTPS adapter proposal.' }); assert.equal(JSON.parse(draft.result.content[0].text).mode, 'draft');
  const before = received;
  const untrusted = await stdio(t, origin, secret); const denied = await untrusted.call('get_thread', { thread_id: q.id }); assert.equal(denied.result.isError, true); assert.equal(received, before); assert.ok(!JSON.stringify(denied).includes(secret));
  redirectTo = `http://127.0.0.1:${(trap.address() as any).port}/would-leak-credential`;
  const redirected = await adapter.call('get_thread', { thread_id: q.id }); assert.equal(redirected.result.isError, true); assert.equal(trapHits, 0); assert.ok(!JSON.stringify(redirected).includes(secret));
});
test('adapter aborts an unresponsive local backend after its existing 10-second timeout without echoing credentials', async t => {
  const server = createServer(() => {}); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const secret = randomBytes(32).toString('base64url'), adapter = await stdio(t, `http://127.0.0.1:${(server.address() as any).port}`, secret);
  const start = Date.now(), r = await adapter.call('search_room', { query: 'fixture' });
  assert.equal(r.result.isError, true); assert.ok(Date.now() - start >= 9000 && Date.now() - start < 14500); assert.ok(!JSON.stringify(r).includes(secret));
});
