import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { fetchUpstream, finishError } from './proxy.js';
import { readBoundedText } from './extract.js';
import { extractArticle, ExtractorBusyError, withExtractSlot } from '../extract.js';
import { extractHeaders } from '../extractCookies.js';
import {
  appendQuote, obsidianConfig, saveArticle, VaultPathError,
  type ObsidianConfig, type QuoteInput, type SaveInput,
} from '../obsidian.js';

/**
 * `/api/obsidian` — send a quote or a whole article to an Obsidian vault.
 * Everything here is a no-op unless `OBSIDIAN_VAULT_DIR` is set; see
 * `server/obsidian.ts` for the file layout.
 */
const router = Router();
router.use(requireAuth);

// Each call writes a file; sixty a minute is generous for a human reader and
// bounds what a leaked token can spray into the vault.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Obsidian writes, slow down', code: 'rate_limited' },
});

const MAX_QUOTE_CHARS = 20_000;
const MAX_HTML_BYTES = 5_000_000;
const BODY_TIMEOUT_MS = 20_000;
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;

function disabled(res: Response) {
  return res.status(404).json({ error: 'Obsidian export not configured', code: 'obsidian_disabled' });
}

function str(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > max ? s.slice(0, max) : s;
}

function httpUrl(v: unknown): string | undefined {
  const s = str(v, 4000);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
}

function fail(res: Response, err: unknown, what: string) {
  if (err instanceof VaultPathError) {
    return res.status(400).json({ error: 'Target path escapes the vault', code: 'vault_path' });
  }
  console.error(`[obsidian] ${what} failed:`, (err as Error).message);
  return res.status(500).json({ error: `Could not write ${what} to the vault` });
}

router.get('/status', (_req: Request, res: Response) => {
  res.json({ enabled: !!obsidianConfig() });
});

router.post('/quote', writeLimiter, async (req: Request, res: Response) => {
  const cfg = obsidianConfig();
  if (!cfg) return disabled(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const text = str(body.text, MAX_QUOTE_CHARS);
  const title = str(body.title);
  const feed = str(body.feed) || '';
  if (!text || text.length < 3) return res.status(400).json({ error: 'Quote text too short' });
  if (!title) return res.status(400).json({ error: 'Missing article title' });
  const q: QuoteInput = { text, title, feed, author: str(body.author) || undefined, url: httpUrl(body.url) };
  try {
    const out = await appendQuote(cfg, q);
    res.json({ ok: true, path: out.path });
  } catch (err) {
    fail(res, err, 'quote');
  }
});

/**
 * Best available body for a saved note:
 *   1. `html` the client already extracted (full text, shown on screen);
 *   2. a fresh server-side extraction of `url` (with paywall cookies, if any);
 *   3. `summaryHtml` — whatever the feed shipped.
 */
async function pickBody(
  url: string | undefined,
  html: string | null,
  summaryHtml: string | null,
): Promise<{ html: string; title?: string; byline?: string } | { error: unknown }> {
  if (html) return { html };
  if (url) {
    try {
      const upstream = await fetchUpstream(url, { headers: { Accept: 'text/html', ...extractHeaders(url) } });
      const ctype = upstream.headers.get('content-type') || '';
      if (upstream.ok && HTML_TYPES.test(ctype)) {
        const page = await readBoundedText(upstream, MAX_HTML_BYTES, BODY_TIMEOUT_MS);
        const article = await withExtractSlot(() => extractArticle(url, page));
        if (article?.content) return { html: article.content, title: article.title, byline: article.byline };
      } else {
        upstream.body?.cancel().catch(() => {});
      }
    } catch (err) {
      if (!summaryHtml) return { error: err };
    }
  }
  if (summaryHtml) return { html: summaryHtml };
  return { error: new Error('No content to save') };
}

router.post('/save', writeLimiter, async (req: Request, res: Response) => {
  const cfg: ObsidianConfig | null = obsidianConfig();
  if (!cfg) return disabled(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = str(body.title) || 'Untitled';
  const url = httpUrl(body.url);
  const author = str(body.author) || undefined;
  const feed = str(body.feed) || '';
  const html = typeof body.html === 'string' && body.html.trim() ? body.html : null;
  const summaryHtml = typeof body.summaryHtml === 'string' && body.summaryHtml.trim() ? body.summaryHtml : null;
  if (!url && !html && !summaryHtml) return res.status(400).json({ error: 'Nothing to save' });

  const picked = await pickBody(url, html, summaryHtml);
  if ('error' in picked) {
    if (picked.error instanceof ExtractorBusyError) return res.status(503).json({ error: 'Extractor busy' });
    if (picked.error instanceof Error && picked.error.message === 'No content to save') {
      return res.status(422).json({ error: 'Not extractable' });
    }
    return finishError(res, picked.error, url ? new URL(url).origin : '<no url>', 'Obsidian save:');
  }

  const a: SaveInput = { title, url, author: author ?? picked.byline ?? undefined, feed, html: picked.html };
  try {
    const out = await saveArticle(cfg, a);
    res.json({ ok: true, path: out.path, filename: out.filename });
  } catch (err) {
    fail(res, err, 'article');
  }
});

export default router;
