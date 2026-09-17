# Proposal for upstream (Fripix/Frirss): "Export to Markdown folder" + extraction cookies

Draft issue text — not yet posted. Post it at https://github.com/Fripix/Frirss/issues/new
if/when you want to offer the feature upstream; the implementation lives on
https://github.com/theparkerk/frirss/tree/obsidian.

---

**Title:** Feature: export a selection or an article as Markdown into a mounted folder (Obsidian/Logseq/plain notes)

Hi — thanks for FriRSS, it replaced a home-grown Obsidian RSS plugin for me.

The one thing I needed on top was a way to get **quotes and articles into my
notes** without leaving the reader. I built it as a small, self-contained
addition and would be happy to upstream it if you're interested:

- `OBSIDIAN_VAULT_DIR` (a bind-mounted folder; unset = feature off and no UI):
  - selecting text in the reading pane shows a floating "Send quote" button →
    `POST /api/obsidian/quote` appends a Markdown block to one quotes file;
  - "Save to Obsidian" (pane toolbar, mobile sheet, list context menu) →
    `POST /api/obsidian/save` writes `YYYY-MM-DD - Title.md` with frontmatter,
    body = client-extracted full text, else a server extraction, else the feed
    summary (Turndown for HTML → Markdown).
  - Every path is resolved under the folder and rejected if it escapes it;
    JWT + rate limit like the other routes; ~450 lines incl. tests, all in new
    files except a handful of one-line hooks.
- Separately, `EXTRACT_COOKIES_FILE`: per-domain cookies (+ browser UA) for
  `/api/extract`, so subscribers get full text from paywalled sites. Suffix
  matching on the hostname, hot-reloaded, cache key carries a cookie digest.

Naming could be generic ("notes folder") rather than Obsidian-specific — the
output is plain Markdown. Would you take a PR for either or both?
