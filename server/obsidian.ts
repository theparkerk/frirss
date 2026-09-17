import { promises as fs } from 'fs';
import path from 'path';
import TurndownService from 'turndown';

/**
 * Obsidian bridge — writes Markdown straight into an Obsidian vault that is
 * bind-mounted into the container (`OBSIDIAN_VAULT_DIR`). Obsidian Sync (or
 * any other vault sync) carries the files to every device.
 *
 * Two outputs, both mirroring what the ReadOB Obsidian plugin used to write so
 * downstream notes keep working unchanged:
 *   - quotes: one append-only file (`OBSIDIAN_QUOTES_FILE`), one block per quote;
 *   - articles: one `YYYY-MM-DD - Title.md` note per save (`OBSIDIAN_SAVE_DIR`),
 *     `type: web-clip` frontmatter + the article body converted to Markdown.
 *
 * The feature is OFF unless `OBSIDIAN_VAULT_DIR` is set: the route answers 404
 * and the client hides every Obsidian control.
 */

export interface ObsidianConfig {
  /** Absolute path of the vault root inside the container. */
  vaultDir: string;
  /** Vault-relative path of the quotes file. */
  quotesFile: string;
  /** Vault-relative folder for saved articles. */
  saveDir: string;
}

export const DEFAULT_QUOTES_FILE = '!! Inbox !!/Quotes/Reading Highlights.md';
export const DEFAULT_SAVE_DIR = '!! Inbox !!/ReadItLater';

export function obsidianConfig(env: NodeJS.ProcessEnv = process.env): ObsidianConfig | null {
  const vaultDir = env.OBSIDIAN_VAULT_DIR?.trim();
  if (!vaultDir) return null;
  return {
    vaultDir: path.resolve(vaultDir),
    quotesFile: env.OBSIDIAN_QUOTES_FILE?.trim() || DEFAULT_QUOTES_FILE,
    saveDir: env.OBSIDIAN_SAVE_DIR?.trim() || DEFAULT_SAVE_DIR,
  };
}

/** A vault-relative path that resolves outside the vault. */
export class VaultPathError extends Error {}

/**
 * Resolve a vault-relative path and refuse anything that escapes the vault —
 * `..` segments, absolute paths, or a prefix collision such as
 * `/vault-other` next to `/vault`.
 */
export function resolveInVault(vaultDir: string, rel: string): string {
  const root = path.resolve(vaultDir);
  const abs = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new VaultPathError('Path escapes the vault');
  }
  return abs;
}

/** Local calendar date, `YYYY-MM-DD` — the container runs with `TZ` set. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Same rules as ReadOB's `sanitizeFilename`: strip the characters no filesystem
 * or Obsidian accepts, collapse whitespace, cap at 100 characters.
 */
export function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 100)
    .trim();
  return cleaned || 'Untitled';
}

// ── Quotes ───────────────────────────────────────────────────────────

export interface QuoteInput {
  text: string;
  title: string;
  author?: string;
  url?: string;
  feed: string;
}

/** One quote block, byte-for-byte the layout ReadOB appended. */
export function quoteBlock(q: QuoteInput, date: string): string {
  const text = q.text.trim().split('\n').join('\n> ');
  return [
    '',
    `### ${date}`,
    '',
    `> ${text}`,
    '',
    `— *${q.title}*${q.author ? ` by ${q.author}` : ''}`,
    q.url ? `[Source](${q.url})` : '',
    `Feed: ${q.feed}`,
    '',
    '---',
  ].filter(Boolean).join('\n');
}

/** Header written once, when the quotes file does not exist yet. */
export function quotesHeader(date: string): string {
  return [
    '---',
    'type: highlights',
    'tags: [quotes, reading]',
    `last-updated: ${date}`,
    '---',
    '',
    '# Reading Highlights',
    '',
    'Quotes saved from FriRSS.',
    '',
    '---',
  ].join('\n');
}

export async function appendQuote(
  cfg: ObsidianConfig,
  q: QuoteInput,
  now: Date = new Date(),
): Promise<{ path: string }> {
  const date = todayISO(now);
  const abs = resolveInVault(cfg.vaultDir, cfg.quotesFile);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const block = quoteBlock(q, date);
  try {
    await fs.access(abs);
    await fs.appendFile(abs, '\n' + block, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    await fs.writeFile(abs, quotesHeader(date) + '\n' + block, { encoding: 'utf8', flag: 'wx' });
  }
  return { path: cfg.quotesFile };
}

// ── Articles ─────────────────────────────────────────────────────────

export interface SaveInput {
  title: string;
  url?: string;
  author?: string;
  feed: string;
  /** Article body as HTML (already the best version the caller has). */
  html: string;
}

let turndown: TurndownService | null = null;
function converter(): TurndownService {
  if (turndown) return turndown;
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  // Never let executable or interactive markup through into a note.
  td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'input', 'select', 'textarea']);
  // Keep images with their alt text.
  td.addRule('images', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as HTMLImageElement;
      const alt = el.getAttribute('alt') || '';
      const src = el.getAttribute('src') || '';
      return src ? `![${alt}](${src})` : '';
    },
  });
  turndown = td;
  return td;
}

/** Frontmatter string value: one line, inner quotes escaped. */
function fmString(s: string): string {
  return `"${s.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Frontmatter (ReadOB's `type: web-clip` schema) + Markdown body. */
export function articleMarkdown(a: SaveInput, date: string): string {
  const markdown = converter().turndown(a.html).trim();
  const frontmatter = [
    '---',
    'type: web-clip',
    `title: ${fmString(a.title)}`,
    `source: ${fmString(a.url || '')}`,
    `author: ${fmString(a.author || '')}`,
    `feed: ${fmString(a.feed)}`,
    `date-saved: ${date}`,
    'tags: [read-later]',
    'status: unread',
    '---',
    '',
  ].join('\n');
  return frontmatter + markdown + '\n';
}

export async function saveArticle(
  cfg: ObsidianConfig,
  a: SaveInput,
  now: Date = new Date(),
): Promise<{ path: string; filename: string }> {
  const date = todayISO(now);
  const dirAbs = resolveInVault(cfg.vaultDir, cfg.saveDir);
  await fs.mkdir(dirAbs, { recursive: true });
  const base = `${date} - ${sanitizeFilename(a.title)}`;
  const content = articleMarkdown(a, date);
  // `wx` refuses to overwrite: the first free ` (n)` suffix wins, like ReadOB.
  for (let n = 1; n <= 99; n++) {
    const filename = n === 1 ? `${base}.md` : `${base} (${n}).md`;
    const abs = resolveInVault(cfg.vaultDir, path.posix.join(cfg.saveDir, filename));
    try {
      await fs.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
      return { path: path.posix.join(cfg.saveDir, filename), filename };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Too many notes with this title today');
}
