import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

/**
 * Per-domain cookies for full-text extraction (paywalled sites).
 *
 * `/api/extract` fetches article pages anonymously, so a subscription site
 * returns its paywall stub. Operators who are subscribed can drop a JSON file
 * next to the database — `EXTRACT_COOKIES_FILE`, default
 * `<FRIRSS_DATA_DIR>/extract-cookies.json` — shaped as:
 *
 *   [{ "domain": "wsj.com", "cookies": "a=b; c=d" }, ...]
 *
 * The file is re-read whenever its mtime changes, so refreshing an expired
 * session never needs a restart. Matching is by hostname suffix
 * (`wsj.com` matches `www.wsj.com`, never `notwsj.com`).
 *
 * Cookie values are secrets: they are never logged, and a fetch that carries
 * them is cached under a different key than the anonymous fetch of the same
 * URL (`cookieCacheSuffix`), so a paywall stub and the real article never
 * overwrite each other.
 */
export interface CookieEntry {
  domain: string;
  cookies: string;
}

/** Desktop Safari — what the same subscription would send from a browser. */
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

export function cookiesFilePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.EXTRACT_COOKIES_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  const dataDir = env.FRIRSS_DATA_DIR?.trim();
  return dataDir ? path.join(path.resolve(dataDir), 'extract-cookies.json') : null;
}

interface Store { file: string | null; mtimeMs: number; entries: CookieEntry[]; warned: boolean }
const store: Store = { file: null, mtimeMs: -1, entries: [], warned: false };

/** Forget the loaded file — tests point the store at a fresh temp file. */
export function resetCookieStore(): void {
  store.file = null;
  store.mtimeMs = -1;
  store.entries = [];
  store.warned = false;
}

function parseEntries(raw: string): CookieEntry[] {
  const data = JSON.parse(raw) as unknown;
  const list: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { cookieConfigs?: unknown }).cookieConfigs)
      ? (data as { cookieConfigs: unknown[] }).cookieConfigs
      : [];
  return list
    .filter((e): e is CookieEntry =>
      !!e && typeof e === 'object'
      && typeof (e as CookieEntry).domain === 'string'
      && typeof (e as CookieEntry).cookies === 'string')
    .map((e) => ({ domain: e.domain.trim().toLowerCase().replace(/^\./, ''), cookies: e.cookies.trim() }))
    .filter((e) => e.domain && e.cookies);
}

/** Current entries, re-read when the file changed. Missing file → none. */
export function loadCookieEntries(env: NodeJS.ProcessEnv = process.env): CookieEntry[] {
  const file = cookiesFilePath(env);
  if (!file) return [];
  if (file !== store.file) {
    store.file = file;
    store.mtimeMs = -1;
    store.entries = [];
  }
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    store.mtimeMs = -1;
    store.entries = [];
    return [];
  }
  if (mtimeMs === store.mtimeMs) return store.entries;
  try {
    store.entries = parseEntries(fs.readFileSync(file, 'utf8'));
    store.warned = false;
  } catch (err) {
    if (!store.warned) {
      console.warn('[extract] cookie file unreadable, extracting anonymously:', (err as Error).message);
      store.warned = true;
    }
    store.entries = [];
  }
  store.mtimeMs = mtimeMs;
  return store.entries;
}

/** Cookie header for a hostname, or null. Longest (most specific) domain wins. */
export function matchCookies(hostname: string, entries: CookieEntry[] = loadCookieEntries()): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  let best: CookieEntry | null = null;
  for (const e of entries) {
    if (host === e.domain || host.endsWith('.' + e.domain)) {
      if (!best || e.domain.length > best.domain.length) best = e;
    }
  }
  return best?.cookies ?? null;
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

/** Extra request headers for an article URL: `{}` unless a cookie entry matches. */
export function extractHeaders(url: string): Record<string, string> {
  const host = hostOf(url);
  const cookies = host ? matchCookies(host) : null;
  if (!cookies) return {};
  return { Cookie: cookies, 'User-Agent': BROWSER_UA };
}

/** Cache-key suffix: empty for an anonymous fetch, a digest of the cookies otherwise. */
export function cookieCacheSuffix(url: string): string {
  const host = hostOf(url);
  const cookies = host ? matchCookies(host) : null;
  if (!cookies) return '';
  return `#c:${createHash('sha1').update(cookies).digest('hex').slice(0, 12)}`;
}
