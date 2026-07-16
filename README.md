# bookorbit-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes the **text of your
ebooks** — managed by [Book Orbit](https://bookorbit.home.joshstrange.com) — to
LLMs, so an assistant can answer questions about _what happens inside a book_
without you copy-pasting chapters.

It is deliberately **navigation-first**: instead of dumping a whole 100k-word
book into the model's context (which would overwhelm it), the server lets the
model find a book, look at its chapter list, and pull only the pieces it needs.

## How it works

Book Orbit stores raw EPUB files and exposes a reader backend
(`/epub/{bookId}/info` + `/epub/{bookId}/file/{path}`). This server uses that
backend to read a book's structure, fetch only the needed chapters, strip the
XHTML to plain text, and cache the result on disk. Nothing is re-downloaded
after the first read.

Three guardrails keep the model from drowning:

1. **Structure before text** — `list_chapters` returns chapter labels and sizes,
   never the body.
2. **Bounded, paginated text** — `get_chapter` caps output (~24k chars) and pages
   through long chapters with `offset` / `nextOffset`.
3. **Snippet-only search** — `search_in_book` returns short snippets plus a
   chapter index + offset the model can re-fetch precisely.

## Tools

| Tool                                                         | What it does                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `search_books(query, limit?)`                                | Find books by title/author/series; returns `bookId` + formats + `hasEpub`.               |
| `get_book(bookId)`                                           | Full metadata (description, series, genres, files).                                      |
| `list_chapters(bookId)`                                      | Chapter list with per-chapter char/word counts (no text). Parses + caches on first call. |
| `get_chapter(bookId, chapter, offset?, maxChars?)`           | Plain text of one chapter, paginated.                                                    |
| `search_in_book(bookId, query, maxResults?, caseSensitive?)` | Keyword search within a book → snippets + locations.                                     |

**Typical flow:** `search_books` → `list_chapters` → `get_chapter` /
`search_in_book`.

## Requirements & scope

- **EPUB only** (v1). Books without an EPUB file return a clear error from the
  text tools.
- **Auth:** Book Orbit access tokens expire after ~15 minutes and there is no
  long-lived API key, so the server logs in with your **username + password** and
  refreshes / re-logs in automatically. A static `BOOKORBIT_TOKEN` is supported
  for quick tests but will not auto-refresh.
- Single-user / local: it acts as the account you configure.

## Configuration

Set these as environment variables (or in a local `.env` — see `.env.example`):

| Variable             | Required    | Notes                                                               |
| -------------------- | ----------- | ------------------------------------------------------------------- |
| `BOOKORBIT_URL`      | yes         | Base URL, e.g. `https://bookorbit.example.com` (trailing slash ok). |
| `BOOKORBIT_USERNAME` | recommended | Enables automatic token refresh.                                    |
| `BOOKORBIT_PASSWORD` | recommended |                                                                     |
| `BOOKORBIT_TOKEN`    | alternative | Static Bearer token; dev/testing only (expires ~15 min).            |
| `CACHE_DIR`          | optional    | Where extracted text is cached (default `~/.cache/bookorbit-mcp`).  |

## Install & build

```bash
npm install
npm run build
```

## Use with a Claude client

Add to your MCP client config (e.g. Claude Desktop's `claude_desktop_config.json`,
or `claude mcp add`). Point at the built entry and pass your credentials:

```json
{
  "mcpServers": {
    "bookorbit": {
      "command": "node",
      "args": ["/absolute/path/to/bookorbit-mcp/dist/server.js"],
      "env": {
        "BOOKORBIT_URL": "https://bookorbit.example.com",
        "BOOKORBIT_USERNAME": "your-username",
        "BOOKORBIT_PASSWORD": "your-password"
      }
    }
  }
}
```

## Development

```bash
npm test          # unit tests (offline; run against captured fixtures)
npm run typecheck # type-check only
npm run dev       # run the server from source over stdio

# Live checks against a real server (need .env with credentials):
node --import tsx scripts/smoke.mts      # exercises search → parse → chapter → search
node --import tsx scripts/mcp-check.mts   # drives the built server over the MCP stdio protocol
```

## Design notes

- **Chapters follow the TOC, not raw files.** A single EPUB spine file can bundle
  many chapters separated by `#fragment` anchors; the server resolves the table
  of contents into meaningful sections and slices each one by its anchor range.
- **Cache layout:** `~/.cache/bookorbit-mcp/<bookId>/book.json` (chapter list +
  sizes) and `text/section-NNN.txt` (extracted text per chapter).
- **Not included (v1):** semantic/RAG search, cross-library content search,
  PDF/MOBI, and any write operations. The cache layout leaves room to add a
  cross-book index later.
