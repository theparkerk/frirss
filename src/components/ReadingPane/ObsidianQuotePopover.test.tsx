// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act, waitFor } from '@testing-library/react';
import ObsidianQuotePopover, { MIN_QUOTE_CHARS } from './ObsidianQuotePopover';
import type { Article } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const { pushToast, sendQuote } = vi.hoisted(() => ({ pushToast: vi.fn(), sendQuote: vi.fn() }));
vi.mock('../../stores/uiStore', () => ({
  useUiStore: (sel: (s: { pushToast: typeof pushToast }) => unknown) => sel({ pushToast }),
}));

// The real module pulls in the auth store (and its localStorage); only the
// payload shape and the call matter here.
vi.mock('../../api/obsidian', () => ({
  sendQuoteToObsidian: (q: unknown) => sendQuote(q),
  quotePayload: (a: Article, text: string) => ({
    text, title: a.title, author: a.author || undefined, url: a.url || undefined, feed: a.source,
  }),
}));

const article = {
  id: 'a1', title: 'Hello World', url: 'https://example.com/1', author: 'Jane', source: 'Feed',
  read: false, starred: false, labels: [], content: '', summary: '',
} as unknown as Article;

/** Fake a selection of `text` inside (or outside) `.article-content`. */
function selectText(text: string, inScope = true) {
  const host = document.createElement('div');
  if (inScope) host.className = 'article-content';
  const p = document.createElement('p');
  p.textContent = text;
  host.appendChild(p);
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(p);
  range.getBoundingClientRect = () => ({ left: 100, top: 200, width: 80, height: 16, right: 180, bottom: 216, x: 100, y: 200, toJSON: () => ({}) });
  const sel = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
  };
  vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection);
  document.dispatchEvent(new Event('selectionchange'));
  return sel;
}

beforeEach(() => {
  vi.useFakeTimers();
  sendQuote.mockReset();
  pushToast.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ObsidianQuotePopover', () => {
  it('shows a button once a selection inside the article settles', () => {
    render(<ObsidianQuotePopover article={article} />);
    expect(screen.queryByTestId('obsidian-quote-button')).toBeNull();
    selectText('a sentence worth keeping');
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId('obsidian-quote-button')).toBeTruthy();
  });

  it('ignores selections outside the article or shorter than the minimum', () => {
    render(<ObsidianQuotePopover article={article} />);
    selectText('outside the article body', false);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByTestId('obsidian-quote-button')).toBeNull();
    selectText('ab'.slice(0, MIN_QUOTE_CHARS - 1));
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByTestId('obsidian-quote-button')).toBeNull();
  });

  it('sends the selected text with the article metadata, then clears and toasts', async () => {
    sendQuote.mockResolvedValue({ path: 'x' });
    render(<ObsidianQuotePopover article={article} />);
    const sel = selectText('  quote me  ');
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.click(screen.getByTestId('obsidian-quote-button'));
    vi.useRealTimers();
    await waitFor(() => expect(sendQuote).toHaveBeenCalledTimes(1));
    expect(sendQuote).toHaveBeenCalledWith({
      text: 'quote me', title: 'Hello World', author: 'Jane', url: 'https://example.com/1', feed: 'Feed',
    });
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('obsidian.quoteSaved'));
    expect(sel.removeAllRanges).toHaveBeenCalled();
    expect(screen.queryByTestId('obsidian-quote-button')).toBeNull();
  });

  it('reports a failure without clearing the selection', async () => {
    sendQuote.mockRejectedValue(new Error('nope'));
    render(<ObsidianQuotePopover article={article} />);
    const sel = selectText('quote me please');
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.click(screen.getByTestId('obsidian-quote-button'));
    vi.useRealTimers();
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('obsidian.failed', { tone: 'error' }));
    expect(sel.removeAllRanges).not.toHaveBeenCalled();
  });
});
