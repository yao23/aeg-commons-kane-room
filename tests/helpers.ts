import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
export const root = fileURLToPath(new URL('../', import.meta.url));
export async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const port = (s.address() as any).port; await new Promise<void>(resolve => s.close(() => resolve())); return port; }
export async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kane-acceptance-')), port = await freePort(), origin = `http://127.0.0.1:${port}`;
  let child: any, errors = '';
  async function start() {
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], { cwd: root, env: { ...process.env, PORT: String(port), APP_ORIGIN: origin, DB_PATH: join(dir, 'room.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', (b: any) => { errors += b; });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out. ' + errors)), 10000);
      child.stdout.on('data', (b: any) => { if (String(b).includes('Local:')) { clearTimeout(timer); resolve(); } });
      child.once('exit', (code: number) => { clearTimeout(timer); reject(new Error(`Server exited ${code}. ${errors}`)); });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; } }
  function client() {
    let cookie = '';
    return { get cookie() { return cookie; }, async request(path: string, body?: any, extra: any = {}) {
      const res = await fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie')!.split(';')[0];
      return { status: res.status, data: await res.json() };
    } };
  }
  await start();
  return { dir, origin, start, stop, client, get errors() { return errors; }, async close() { await stop(); rmSync(dir, { recursive: true, force: true }); } };
}
export const sampleSources = [{ kind: 'synthetic_sample', citation: 'Synthetic acceptance fixture. No Kane runner or real-world success is claimed.' }];
export const sampleQuestion = { title: 'Synthetic Kane CLI configuration mismatch', body: 'Synthetic scenario for testing collaboration. A CLI fixture disagrees about configuration, with no actual Kane run.', environment: 'Synthetic fixture; OS and version intentionally unspecified.', sources: sampleSources };
export async function publicEntry(client: any, kind: string, thread_id: string | null, data: any) {
  const p = await client.request('/previews', { kind, thread_id, data }); if (p.status !== 201) throw new Error(JSON.stringify(p));
  const r = await client.request('/publish', { preview_id: p.data.preview_id, acknowledged: true }); if (r.status !== 201) throw new Error(JSON.stringify(r)); return r.data;
}
