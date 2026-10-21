import { createServer } from 'node:http';
import { readFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store, Fault, exact, insist, str } from './store.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4317);
const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
const url = new URL(origin);
insist(['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:' && Number(url.port || 80) === port, 'This MVP only supports a loopback HTTP origin matching PORT.');
process.umask(0o077);
const dbPath = resolve(process.env.DB_PATH || `${root}/data/kane.sqlite`);
const store = new Store(dbPath);
store.setReferences(JSON.parse(readFileSync(`${root}/curated-references.json`, 'utf8')));
chmodSync(dbPath, 0o600);
const limits = new Map<string, { count: number; until: number }>();
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send = (status: number, data: any) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  try {
    insist(req.headers.host === url.host, 'Invalid Host header.', 403);
    if (req.headers.origin) insist(req.headers.origin === origin, 'Cross-origin requests are not allowed.', 403);
    const target = new URL(req.url || '/', origin), path = target.pathname;
    const key = req.socket.remoteAddress || 'local', time = Date.now();
    if (limits.size > 1000) for (const [k, v] of limits) if (v.until < time) limits.delete(k);
    const limit = limits.get(key); if (!limit || limit.until < time) limits.set(key, { count: 1, until: time + 60000 });
    else insist(++limit.count <= 500, 'Too many requests. Try again in a minute.', 429);
    if (req.method === 'GET' && ['/', '/app.js', '/styles.css'].includes(path)) {
      const name = path === '/' ? 'index.html' : path.slice(1);
      const mime: any = { 'index.html': 'text/html', 'app.js': 'text/javascript', 'styles.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': `${mime[name]}; charset=utf-8` }); res.end(readFileSync(`${root}/public/${name}`)); return;
    }
    if (req.method === 'GET' && path === '/api/health') { send(200, { ok: true, room: 'kane', storage: 'sqlite' }); return; }
    insist(path.startsWith('/api/'), 'Not found.', 404);
    const write = !['GET', 'HEAD'].includes(req.method || '');
    if (write) {
      insist(req.headers['content-type']?.split(';')[0] === 'application/json', 'Use application/json.', 415);
      if (path !== '/api/agent/tools') insist(req.headers.origin === origin, 'A matching Origin is required for browser writes.', 403);
    }
    let body: any = {};
    if (write) {
      let raw = ''; for await (const chunk of req) { raw += chunk; insist(Buffer.byteLength(raw) <= 48000, 'Request too large.', 413); }
      try { body = JSON.parse(raw); } catch { throw new Fault(400, 'Invalid JSON.'); }
    }
    if (path === '/api/agent/tools' && req.method === 'POST') {
      exact(body, ['name', 'arguments']);
      const auth = req.headers.authorization || '';
      insist(auth.startsWith('Bearer '), 'Agent bearer token required.', 401);
      send(200, store.agentTool(auth.slice(7), str(body.name, 'Tool', 100), body.arguments || {})); return;
    }
    const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('kane_session='))?.slice(13);
    // Reads remain anonymous until a visitor explicitly starts a session through a write.
    let owner: string | undefined;
    if (cookie) owner = store.authenticate(cookie);
    if (write && !owner) {
      const s = store.session(); owner = s.id;
      res.setHeader('Set-Cookie', `kane_session=${s.raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
    }
    if (path === '/api/session' && req.method === 'GET') { send(200, { active: !!owner, label: owner ? `Guest ${owner.slice(0, 5)}` : 'Visitor', recovery: 'Session access depends on this browser cookie. No account or recovery is provided in this MVP.' }); return; }
    if (path === '/api/session' && req.method === 'POST') { exact(body, []); send(200, { active: true, label: `Guest ${owner!.slice(0, 5)}` }); return; }
    if (path === '/api/search' && req.method === 'GET') { send(200, store.search(target.searchParams.get('q') || '', owner)); return; }
    if (path === '/api/references' && req.method === 'GET') { send(200, { references: store.references }); return; }
    if (path === '/api/recent' && req.method === 'GET') {
      const rows = store.db.prepare("SELECT * FROM entries WHERE kind='thread' AND status='public' ORDER BY updated DESC LIMIT 20").all();
      const count: any = store.db.prepare("SELECT count(*) AS n FROM entries WHERE kind='thread' AND status='public' AND EXISTS (SELECT 1 FROM json_each(entries.data,'$.sources') AS source WHERE json_extract(source.value,'$.kind')='user_report')").get();
      send(200, { threads: rows.map(r => store.view(r, owner)), real_question_count: count.n }); return;
    }
    if (path === '/api/mine' && req.method === 'GET') { send(200, { entries: owner ? store.mine(owner) : [] }); return; }
    const threadMatch = path.match(/^\/api\/threads\/([A-Za-z0-9_-]+)$/);
    if (threadMatch && req.method === 'GET') { send(200, store.thread(threadMatch[1], owner)); return; }
    const copyMatch = path.match(/^\/api\/cards\/([A-Za-z0-9_-]+)\/copy$/);
    if (copyMatch && req.method === 'GET') { send(200, store.copy(copyMatch[1], owner)); return; }
    if (path === '/api/drafts' && req.method === 'POST') {
      exact(body, ['kind', 'thread_id', 'data', 'id']); send(201, store.draft(owner!, body.kind, body.thread_id || null, body.data, body.id)); return;
    }
    if (path === '/api/previews' && req.method === 'POST') {
      exact(body, ['kind', 'thread_id', 'data', 'id']); send(201, store.preview(owner!, body.kind, body.thread_id || null, body.data, body.id)); return;
    }
    if (path === '/api/publish' && req.method === 'POST') {
      exact(body, ['preview_id', 'acknowledged']); send(201, store.publish(owner!, str(body.preview_id, 'Preview', 100), body.acknowledged)); return;
    }
    if (path === '/api/collaborations' && req.method === 'POST') { send(201, store.collaboration(owner!, body)); return; }
    if (path === '/api/collaborations' && req.method === 'GET') { send(200, { authorizations: owner ? store.collaborations(owner, target.searchParams.get('thread_id') || '') : [] }); return; }
    const revokeMatch = path.match(/^\/api\/collaborations\/([A-Za-z0-9_-]+)\/revoke$/);
    if (revokeMatch && req.method === 'POST') { exact(body, []); send(200, store.revoke(owner!, revokeMatch[1])); return; }
    throw new Fault(404, 'Not found.');
  } catch (error) {
    if (error instanceof Fault) send(error.status, { error: error.message, ...(error.question ? { decision_question: error.question } : {}) });
    else { console.error(error); send(500, { error: 'Internal server error. No content was published. Try again.' }); }
  }
});
server.listen(port, '127.0.0.1', () => console.log(`AEG Commons — Kane Room\nLocal: ${origin}\nSQLite: ${dbPath}`));
function shutdown() {
  server.close(() => { store.db.close(); process.exit(0); });
  // Do not let a browser's remaining HTTP connection block a local restart forever.
  setTimeout(() => server.closeAllConnections(), 1000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
