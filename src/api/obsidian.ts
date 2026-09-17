import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import type { Article } from '../types';

/**
 * Client side of the Obsidian bridge (`/api/obsidian`, see
 * `server/obsidian.ts`). The server writes Markdown into a mounted vault;
 * the client only decides WHAT to send. Every control is hidden unless the
 * server reports the feature enabled.
 */

function authHeaders(): Record<string, string> {
  const { backendToken } = useAuthStore.getState();
  return {
    'Content-Type': 'application/json',
    ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}),
  };
}

// One status probe per token: the answer only changes with a redeploy.
let statusToken: string | null | undefined;
let statusPromise: Promise<boolean> | null = null;

export function fetchObsidianEnabled(): Promise<boolean> {
  const { backendToken } = useAuthStore.getState();
  if (!backendToken) return Promise.resolve(false);
  if (statusPromise && statusToken === backendToken) return statusPromise;
  statusToken = backendToken;
  statusPromise = fetch('/api/obsidian/status', { headers: authHeaders() })
    .then(async (r) => (r.ok ? !!((await r.json()) as { enabled?: boolean }).enabled : false))
    .catch(() => false);
  return statusPromise;
}

/** For tests: forget the cached probe. */
export function resetObsidianStatus(): void {
  statusToken = undefined;
  statusPromise = null;
}

/** `true` once the server has confirmed `OBSIDIAN_VAULT_DIR` is configured. */
export function useObsidianEnabled(): boolean {
  const backendToken = useAuthStore((s) => s.backendToken);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    fetchObsidianEnabled().then((v) => { if (live) setEnabled(v); });
    return () => { live = false; };
  }, [backendToken]);
  return enabled;
}

export class ObsidianError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function post(path: string, body: unknown): Promise<{ path: string; filename?: string }> {
  const r = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = ((await r.json()) as { error?: string }).error || msg; } catch { /* keep statusText */ }
    throw new ObsidianError(r.status, msg);
  }
  return (await r.json()) as { path: string; filename?: string };
}

export interface QuotePayload {
  text: string;
  title: string;
  author?: string;
  url?: string;
  feed: string;
}

export function sendQuoteToObsidian(q: QuotePayload) {
  return post('/api/obsidian/quote', q);
}

export function quotePayload(article: Article, text: string): QuotePayload {
  return {
    text,
    title: article.title,
    author: article.author || undefined,
    url: article.url || undefined,
    feed: article.source,
  };
}

export interface SavePayload {
  title: string;
  url?: string;
  author?: string;
  feed: string;
  /** Full text already extracted on this device, if any. */
  html?: string;
  /** Whatever the feed shipped — the server's last resort. */
  summaryHtml?: string;
}

export function savePayload(article: Article, extractedHtml: string | null): SavePayload {
  return {
    title: article.title,
    url: article.url || undefined,
    author: article.author || undefined,
    feed: article.source,
    html: extractedHtml || undefined,
    summaryHtml: article.content || article.summary || undefined,
  };
}

export function saveArticleToObsidian(a: SavePayload) {
  return post('/api/obsidian/save', a);
}

type Notify = {
  pushToast: (msg: string, opts?: { tone?: 'error' }) => void;
  t: (key: string) => string;
};

/** Save + toast, shared by the reading pane and the list's context menu. */
export async function saveArticleAndNotify(
  article: Article,
  extractedHtml: string | null,
  { pushToast, t }: Notify,
): Promise<void> {
  try {
    await saveArticleToObsidian(savePayload(article, extractedHtml));
    pushToast(t('obsidian.articleSaved'));
  } catch {
    pushToast(t('obsidian.failed'), { tone: 'error' });
  }
}
