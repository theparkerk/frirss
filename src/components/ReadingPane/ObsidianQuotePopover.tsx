import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { clampToViewport } from '../../lib/clampToViewport';
import { quotePayload, sendQuoteToObsidian } from '../../api/obsidian';
import type { Article } from '../../types';

/** Shortest selection worth a quote — a stray double-click is not one. */
export const MIN_QUOTE_CHARS = 3;
/** Settle time after the last `selectionchange` before the button appears. */
const SETTLE_MS = 220;
/** Container whose text can be quoted. */
export const QUOTE_SCOPE_SELECTOR = '.article-content';

interface Props {
  article: Article;
}

interface Anchor { x: number; y: number; text: string }

function selectionInScope(): Anchor | null {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (text.length < MIN_QUOTE_CHARS) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el || !el.closest(QUOTE_SCOPE_SELECTOR)) return null;
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return { x: rect.left + rect.width / 2, y: rect.top, text };
}

/**
 * Floating « Send quote to Obsidian » button over a text selection in the
 * article body. A deliberate button rather than save-on-select: on a phone,
 * selecting text to copy it must not spray quotes into the vault.
 */
export default function ObsidianQuotePopover({ article }: Props) {
  const { t } = useTranslation();
  const pushToast = useUiStore((s) => s.pushToast);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Follow the selection: show once it settles, hide as soon as it collapses.
  useEffect(() => {
    const onChange = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setAnchor(selectionInScope()), SETTLE_MS);
    };
    const onScroll = () => setAnchor(null);
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  // A new article means a new selection context.
  useEffect(() => { setAnchor(null); }, [article.id]);

  // Place the button above the selection, clamped to the viewport.
  useEffect(() => {
    if (!anchor) { setPos(null); return; }
    const w = btnRef.current?.offsetWidth ?? 200;
    const h = btnRef.current?.offsetHeight ?? 36;
    setPos(clampToViewport({
      x: anchor.x - w / 2, y: anchor.y - h - 10, w, h,
      vw: window.innerWidth, vh: window.innerHeight,
    }));
  }, [anchor]);

  const send = useCallback(async () => {
    if (!anchor || busy) return;
    setBusy(true);
    try {
      await sendQuoteToObsidian(quotePayload(article, anchor.text));
      window.getSelection()?.removeAllRanges();
      setAnchor(null);
      pushToast(t('obsidian.quoteSaved'));
    } catch {
      pushToast(t('obsidian.failed'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [anchor, busy, article, pushToast, t]);

  if (!anchor) return null;

  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.left ?? anchor.x,
    top: pos?.top ?? anchor.y,
    zIndex: 90,
    visibility: pos ? 'visible' : 'hidden',
    background: 'var(--panel-bg)',
    color: 'var(--accent)',
    border: '1px solid var(--panel-border)',
    borderRadius: '999px',
    boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
    padding: '8px 14px',
    minHeight: '40px',
  };

  return createPortal(
    <button
      ref={btnRef}
      type="button"
      data-testid="obsidian-quote-button"
      className="obsidian-quote-btn flex items-center gap-2 text-xs font-semibold"
      style={style}
      // `pointerdown` would clear the selection before `click` on some browsers.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => { void send(); }}
      disabled={busy}
      aria-label={t('obsidian.sendQuote')}
      title={t('obsidian.sendQuote')}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
      <span>{busy ? '…' : t('obsidian.sendQuote')}</span>
    </button>,
    document.body,
  );
}
