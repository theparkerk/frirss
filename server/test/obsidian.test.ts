import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { vi } from 'vitest';
import {
  appendQuote, articleMarkdown, obsidianConfig, quoteBlock, resolveInVault,
  sanitizeFilename, saveArticle, VaultPathError, DEFAULT_QUOTES_FILE, DEFAULT_SAVE_DIR,
} from '../obsidian.js';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const obsidianRoutes = (await import('../routes/obsidian.js')).default;

let vault: string;
const NOW = new Date(2026, 8, 17, 10, 0, 0); // 2026-09-17 local

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), 'frirss-vault-'));
  process.env.OBSIDIAN_VAULT_DIR = vault;
  delete process.env.OBSIDIAN_QUOTES_FILE;
  delete process.env.OBSIDIAN_SAVE_DIR;
});
afterEach(() => {
  delete process.env.OBSIDIAN_VAULT_DIR;
  rmSync(vault, { recursive: true, force: true });
});

describe('obsidianConfig', () => {
  it('is disabled without OBSIDIAN_VAULT_DIR', () => {
    expect(obsidianConfig({})).toBeNull();
    expect(obsidianConfig({ OBSIDIAN_VAULT_DIR: '   ' })).toBeNull();
  });
  it('falls back to the ReadOB folders', () => {
    const cfg = obsidianConfig({ OBSIDIAN_VAULT_DIR: '/v' })!;
    expect(cfg.quotesFile).toBe(DEFAULT_QUOTES_FILE);
    expect(cfg.saveDir).toBe(DEFAULT_SAVE_DIR);
  });
});

describe('resolveInVault', () => {
  it('accepts paths inside the vault, refuses escapes', () => {
    expect(resolveInVault('/v', 'a/b.md')).toBe(path.resolve('/v/a/b.md'));
    expect(() => resolveInVault('/v', '../x.md')).toThrow(VaultPathError);
    expect(() => resolveInVault('/v', '/etc/passwd')).toThrow(VaultPathError);
    expect(() => resolveInVault('/v', '../v-other/x.md')).toThrow(VaultPathError);
  });
});

describe('sanitizeFilename', () => {
  it('strips forbidden characters and caps the length', () => {
    expect(sanitizeFilename('A/B: "C" <D>|E?*')).toBe('AB C DE');
    expect(sanitizeFilename('x'.repeat(150))).toHaveLength(100);
    expect(sanitizeFilename('   ')).toBe('Untitled');
    expect(sanitizeFilename('ends with dot.')).toBe('ends with dot');
  });
});

describe('quoteBlock', () => {
  it('matches the ReadOB layout exactly', () => {
    const block = quoteBlock({
      text: 'first line\nsecond line',
      title: 'An Article',
      author: 'Jane Doe',
      url: 'https://example.com/a',
      feed: 'Example Feed',
    }, '2026-09-17');
    // ReadOB filtered empty lines out (`.filter(Boolean)`), so the real file
    // has none between the parts — matched here on purpose.
    expect(block).toBe([
      '### 2026-09-17',
      '> first line',
      '> second line',
      '— *An Article* by Jane Doe',
      '[Source](https://example.com/a)',
      'Feed: Example Feed',
      '---',
    ].join('\n'));
  });
  it('omits author and source when absent', () => {
    const block = quoteBlock({ text: 'q', title: 'T', feed: 'F' }, '2026-09-17');
    expect(block).toContain('— *T*\nFeed: F');
    expect(block).not.toContain('[Source]');
  });
});

describe('appendQuote', () => {
  it('creates the file with a header, then appends', async () => {
    const cfg = obsidianConfig()!;
    await appendQuote(cfg, { text: 'one', title: 'T', feed: 'F' }, NOW);
    const file = path.join(vault, DEFAULT_QUOTES_FILE);
    const first = readFileSync(file, 'utf8');
    expect(first.startsWith('---\ntype: highlights\n')).toBe(true);
    expect(first).toContain('# Reading Highlights');
    expect(first.match(/### 2026-09-17/g)).toHaveLength(1);

    await appendQuote(cfg, { text: 'two', title: 'T', feed: 'F' }, NOW);
    const second = readFileSync(file, 'utf8');
    expect(second.startsWith(first)).toBe(true);
    expect(second).toContain('> two');
    expect(second.match(/# Reading Highlights/g)).toHaveLength(1);
  });
  it('honours OBSIDIAN_QUOTES_FILE and refuses an escaping value', async () => {
    process.env.OBSIDIAN_QUOTES_FILE = 'Notes/q.md';
    await appendQuote(obsidianConfig()!, { text: 'one', title: 'T', feed: 'F' }, NOW);
    expect(existsSync(path.join(vault, 'Notes/q.md'))).toBe(true);
    process.env.OBSIDIAN_QUOTES_FILE = '../outside.md';
    await expect(appendQuote(obsidianConfig()!, { text: 'one', title: 'T', feed: 'F' }, NOW))
      .rejects.toBeInstanceOf(VaultPathError);
  });
});

describe('articleMarkdown', () => {
  it('writes ReadOB web-clip frontmatter and converts the body', () => {
    const md = articleMarkdown({
      title: 'Say "hi"',
      url: 'https://example.com/a',
      author: 'Jane',
      feed: 'Feed',
      html: '<h2>Head</h2><p>Some <em>text</em> and <img src="https://x/y.png" alt="pic"></p><script>alert(1)</script>',
    }, '2026-09-17');
    expect(md.startsWith([
      '---',
      'type: web-clip',
      'title: "Say \\"hi\\""',
      'source: "https://example.com/a"',
      'author: "Jane"',
      'feed: "Feed"',
      'date-saved: 2026-09-17',
      'tags: [read-later]',
      'status: unread',
      '---',
      '',
    ].join('\n'))).toBe(true);
    expect(md).toContain('## Head');
    expect(md).toContain('Some *text* and ![pic](https://x/y.png)');
    expect(md).not.toContain('alert(1)');
  });
});

describe('saveArticle', () => {
  it('names the note by date and title, de-duplicating with (n)', async () => {
    const cfg = obsidianConfig()!;
    const a = { title: 'A: Title?', feed: 'F', html: '<p>body</p>' };
    const first = await saveArticle(cfg, a, NOW);
    const second = await saveArticle(cfg, a, NOW);
    const third = await saveArticle(cfg, a, NOW);
    expect(first.filename).toBe('2026-09-17 - A Title.md');
    expect(second.filename).toBe('2026-09-17 - A Title (2).md');
    expect(third.filename).toBe('2026-09-17 - A Title (3).md');
    expect(readdirSync(path.join(vault, DEFAULT_SAVE_DIR)).sort()).toHaveLength(3);
  });
});

describe('/api/obsidian routes', () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/obsidian', obsidianRoutes);

  it('reports enabled / disabled and refuses writes when disabled', async () => {
    expect((await request(app).get('/api/obsidian/status')).body).toEqual({ enabled: true });
    delete process.env.OBSIDIAN_VAULT_DIR;
    expect((await request(app).get('/api/obsidian/status')).body).toEqual({ enabled: false });
    const r = await request(app).post('/api/obsidian/quote').send({ text: 'hello there', title: 'T', feed: 'F' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('obsidian_disabled');
  });

  it('appends a quote', async () => {
    const r = await request(app).post('/api/obsidian/quote')
      .send({ text: 'a memorable sentence', title: 'T', author: 'A', url: 'https://example.com/x', feed: 'F' });
    expect(r.status).toBe(200);
    expect(r.body.path).toBe(DEFAULT_QUOTES_FILE);
    const txt = readFileSync(path.join(vault, DEFAULT_QUOTES_FILE), 'utf8');
    expect(txt).toContain('> a memorable sentence');
    expect(txt).toContain('[Source](https://example.com/x)');
  });

  it('rejects a too-short quote and a non-http source url is dropped', async () => {
    expect((await request(app).post('/api/obsidian/quote').send({ text: 'ab', title: 'T', feed: 'F' })).status).toBe(400);
    const r = await request(app).post('/api/obsidian/quote')
      .send({ text: 'long enough', title: 'T', feed: 'F', url: 'javascript:alert(1)' });
    expect(r.status).toBe(200);
    expect(readFileSync(path.join(vault, DEFAULT_QUOTES_FILE), 'utf8')).not.toContain('javascript:');
  });

  it('saves an article from the html the client already has', async () => {
    const r = await request(app).post('/api/obsidian/save')
      .send({ title: 'Saved', url: 'https://example.com/s', feed: 'F', html: '<p>Full <b>text</b></p>' });
    expect(r.status).toBe(200);
    expect(r.body.filename).toBe(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')} - Saved.md`);
    const txt = readFileSync(path.join(vault, r.body.path), 'utf8');
    expect(txt).toContain('type: web-clip');
    expect(txt).toContain('Full **text**');
  });

  it('falls back to the feed summary when there is no url', async () => {
    const r = await request(app).post('/api/obsidian/save')
      .send({ title: 'Summary only', feed: 'F', summaryHtml: '<p>short</p>' });
    expect(r.status).toBe(200);
    expect(readFileSync(path.join(vault, r.body.path), 'utf8')).toContain('short');
  });

  it('refuses an empty save', async () => {
    expect((await request(app).post('/api/obsidian/save').send({ title: 'x', feed: 'F' })).status).toBe(400);
  });
});
