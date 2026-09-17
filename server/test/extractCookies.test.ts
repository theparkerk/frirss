import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  BROWSER_UA, cookieCacheSuffix, cookiesFilePath, extractHeaders, loadCookieEntries,
  matchCookies, resetCookieStore,
} from '../extractCookies.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'frirss-cookies-'));
  file = path.join(dir, 'extract-cookies.json');
  process.env.EXTRACT_COOKIES_FILE = file;
  resetCookieStore();
});
afterEach(() => {
  delete process.env.EXTRACT_COOKIES_FILE;
  resetCookieStore();
  rmSync(dir, { recursive: true, force: true });
});

describe('cookiesFilePath', () => {
  it('prefers EXTRACT_COOKIES_FILE, else the data dir, else nothing', () => {
    expect(cookiesFilePath({ EXTRACT_COOKIES_FILE: '/x/c.json' })).toBe(path.resolve('/x/c.json'));
    expect(cookiesFilePath({ FRIRSS_DATA_DIR: '/data' })).toBe(path.resolve('/data/extract-cookies.json'));
    expect(cookiesFilePath({})).toBeNull();
  });
});

describe('loadCookieEntries', () => {
  it('yields nothing when the file is missing, without throwing', () => {
    expect(loadCookieEntries()).toEqual([]);
    expect(extractHeaders('https://www.wsj.com/a')).toEqual({});
    expect(cookieCacheSuffix('https://www.wsj.com/a')).toBe('');
  });

  it('accepts the bare array and the ReadOB data.json shape', () => {
    writeFileSync(file, JSON.stringify([{ domain: 'wsj.com', cookies: 'a=1' }]));
    expect(loadCookieEntries()).toEqual([{ domain: 'wsj.com', cookies: 'a=1' }]);
    resetCookieStore();
    writeFileSync(file, JSON.stringify({ cookieConfigs: [{ domain: '.LATimes.com', cookies: ' b=2 ' }] }));
    expect(loadCookieEntries()).toEqual([{ domain: 'latimes.com', cookies: 'b=2' }]);
  });

  it('re-reads when the file changes', () => {
    writeFileSync(file, JSON.stringify([{ domain: 'wsj.com', cookies: 'a=1' }]));
    utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect(matchCookies('www.wsj.com')).toBe('a=1');
    writeFileSync(file, JSON.stringify([{ domain: 'wsj.com', cookies: 'a=2' }]));
    utimesSync(file, new Date(1_700_000_100_000), new Date(1_700_000_100_000));
    expect(matchCookies('www.wsj.com')).toBe('a=2');
  });

  it('treats an unreadable file as no cookies', () => {
    writeFileSync(file, '{not json');
    expect(loadCookieEntries()).toEqual([]);
  });
});

describe('matchCookies', () => {
  const entries = [
    { domain: 'wsj.com', cookies: 'w=1' },
    { domain: 'sub.wsj.com', cookies: 's=1' },
    { domain: 'theverge.com', cookies: 'v=1' },
  ];
  it('matches the host and its subdomains, most specific first', () => {
    expect(matchCookies('wsj.com', entries)).toBe('w=1');
    expect(matchCookies('www.wsj.com', entries)).toBe('w=1');
    expect(matchCookies('deep.sub.wsj.com', entries)).toBe('s=1');
    expect(matchCookies('WWW.THEVERGE.COM', entries)).toBe('v=1');
  });
  it('never matches a lookalike domain', () => {
    expect(matchCookies('notwsj.com', entries)).toBeNull();
    expect(matchCookies('wsj.com.evil.example', entries)).toBeNull();
    expect(matchCookies('example.com', entries)).toBeNull();
  });
});

describe('extractHeaders / cookieCacheSuffix', () => {
  it('sends Cookie + a browser UA only for configured hosts, and keys the cache apart', () => {
    writeFileSync(file, JSON.stringify([{ domain: 'wsj.com', cookies: 'a=1; b=2' }]));
    expect(extractHeaders('https://www.wsj.com/articles/x')).toEqual({ Cookie: 'a=1; b=2', 'User-Agent': BROWSER_UA });
    expect(extractHeaders('https://example.com/x')).toEqual({});
    const suffix = cookieCacheSuffix('https://www.wsj.com/articles/x');
    expect(suffix).toMatch(/^#c:[0-9a-f]{12}$/);
    expect(suffix).not.toContain('a=1');
    expect(cookieCacheSuffix('https://example.com/x')).toBe('');
    expect(extractHeaders('not a url')).toEqual({});
  });
});
