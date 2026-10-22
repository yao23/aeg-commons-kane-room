import { isIP } from 'node:net';
import { isAbsolute, resolve, dirname } from 'node:path';
import { accessSync, constants, statSync } from 'node:fs';

type Env = Record<string, string | undefined>;
export type AppConfig = {
  mode: 'local' | 'hosted'; listenHost: string; port: number; origin: string; host: string;
  dbPath: string; trustedProxies: string[]; secureCookie: boolean;
};
function requireConfig(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function originURL(value: string, label: string): URL {
  let u: URL;
  try { u = new URL(value); } catch { throw new Error(`${label} must be a valid origin.`); }
  requireConfig(/^https?:\/\/[^/?#\\]+\/?$/.test(value) && value === value.trim() && !u.username && !u.password && u.pathname === '/' && !value.includes('?') && !value.includes('#'), `${label} must be an origin without credentials, path, query or fragment.`);
  requireConfig(u.port !== '0', `${label} cannot use port zero.`);
  requireConfig(['http:', 'https:'].includes(u.protocol), `${label} must use HTTP or HTTPS.`);
  return u;
}
export const isLoopbackHost = (hostname: string) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
export function normalizePeer(address: string): string {
  const lower = address.toLowerCase();
  if (isIP(lower) !== 6) return lower;
  const canonical = new URL(`http://[${lower}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
export function readAppConfig(env: Env, root: string): AppConfig {
  const mode = env.APP_MODE === undefined ? 'local' : env.APP_MODE;
  requireConfig(mode === 'local' || mode === 'hosted', 'APP_MODE must be local or hosted.');
  const rawPort = env.PORT === undefined ? '4317' : env.PORT;
  requireConfig(/^\d+$/.test(rawPort), 'PORT must be an integer from 1 to 65535.');
  const port = Number(rawPort);
  requireConfig(Number.isSafeInteger(port) && port >= 1 && port <= 65535, 'PORT must be an integer from 1 to 65535.');
  const listenHost = env.LISTEN_HOST === undefined ? '127.0.0.1' : env.LISTEN_HOST;
  requireConfig((isIP(listenHost) !== 0 && !listenHost.includes('%')) || listenHost === 'localhost', 'LISTEN_HOST must be an IP address or localhost.');
  const rawOrigin = env.APP_ORIGIN === undefined && mode === 'local' ? `http://127.0.0.1:${port}` : env.APP_ORIGIN;
  requireConfig(!!rawOrigin, 'Hosted mode requires an explicit HTTPS APP_ORIGIN.');
  const u = originURL(rawOrigin, 'APP_ORIGIN');
  const proxies = env.TRUSTED_PROXIES ? env.TRUSTED_PROXIES.split(',').map(x => x.trim()) : [];
  requireConfig(proxies.every(x => isIP(x) !== 0 && !x.includes('%')), 'TRUSTED_PROXIES accepts comma-separated exact IP addresses only, not names, wildcards, CIDRs or hop counts.');
  if (mode === 'local') {
    requireConfig(isLoopbackHost(listenHost), 'Local mode must listen on loopback. Use explicit hosted mode for a non-loopback listener.');
    requireConfig(u.protocol === 'http:' && isLoopbackHost(u.hostname) && Number(u.port || 80) === port, 'Local APP_ORIGIN must be loopback HTTP with the listening PORT.');
    requireConfig(!proxies.length, 'TRUSTED_PROXIES is only used in hosted mode.');
  } else {
    requireConfig(u.protocol === 'https:', 'Hosted APP_ORIGIN must use HTTPS.');
    requireConfig(proxies.length > 0, 'Hosted mode requires explicit TRUSTED_PROXIES for the TLS-terminating proxy.');
    requireConfig(!!env.DB_PATH && isAbsolute(env.DB_PATH), 'Hosted mode requires an explicit absolute DB_PATH on persistent storage.');
  }
  requireConfig(env.DB_PATH !== '' && env.DB_PATH !== ':memory:', 'DB_PATH must be a file path, not empty or in-memory.');
  return { mode, listenHost, port, origin: u.origin, host: u.host, dbPath: resolve(env.DB_PATH ?? `${root}/data/kane.sqlite`), trustedProxies: [...new Set(proxies.map(normalizePeer))], secureCookie: mode === 'hosted' };
}
export function checkDatabaseLocation(config: AppConfig) {
  if (config.mode !== 'hosted') return;
  try {
    const parent = dirname(config.dbPath);
    requireConfig(statSync(parent).isDirectory(), 'DB_PATH parent is not a directory.');
    accessSync(parent, constants.W_OK);
  } catch { throw new Error('Hosted DB_PATH parent must already exist and be writable. Mount persistent storage before startup; no fallback database is created.'); }
}
export function readAdapterBackend(env: Env): URL {
  const u = originURL(env.KANE_BACKEND === undefined ? 'http://127.0.0.1:4317' : env.KANE_BACKEND, 'KANE_BACKEND');
  requireConfig(u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname)), 'KANE_BACKEND must be explicit HTTPS or loopback HTTP for local development.');
  requireConfig(u.protocol !== 'https:' || env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS verification must remain enabled for HTTPS KANE_BACKEND.');
  return new URL(u.origin);
}
