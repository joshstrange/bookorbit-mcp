# bookorbit-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes the **text of your
ebooks** — managed by [BookOrbit](https://github.com/bookorbit/bookorbit) — to
LLMs, so an assistant can answer questions about _what happens inside a book_
without you copy-pasting chapters.

It is deliberately **navigation-first**: instead of dumping a whole 100k-word
book into the model's context (which would overwhelm it), the server lets the
model find a book, look at its chapter list, and pull only the pieces it needs.

## How it works

BookOrbit stores raw EPUB files and exposes a reader backend
(`/epub/{bookId}/info` + `/epub/{bookId}/file/{path}`). This server uses that
backend to read a selected book's structure, fetch its referenced XHTML, strip it
to plain text, and keep a bounded process-local cache. Before every content
operation it rechecks book and EPUB access and file-version metadata. Failed
authorization or upstream requests fail closed, never returning cached text.

Three guardrails keep the model from drowning:

1. **Structure before text** — `list_chapters` returns chapter labels and sizes,
   never the body.
2. **Bounded, paginated text** — `get_chapter` caps output (~24k chars) and pages
   through long chapters with `offset` / `nextOffset`.
3. **Snippet-only search** — `search_in_book` returns short snippets plus a
   chapter index + offset the model can re-fetch precisely.

## Tools

All tools are **read-only**.

**Find & read book text**

| Tool                                                         | What it does                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `search_books(query, limit?)`                                | Find books by title/author/series; returns `bookId` + formats + `hasEpub`.               |
| `browse_books(query?, page?, size?)`                         | One zero-based catalog page via read-safe `POST /books/query` (201 supported).           |
| `get_book(bookId)`                                           | Full metadata (description, series, genres, files).                                      |
| `list_chapters(bookId)`                                      | Chapter list with per-chapter char/word counts (no text). Parses + caches on first call. |
| `get_chapter(bookId, chapter, offset?, maxChars?)`           | Plain text of one chapter, paginated.                                                    |
| `search_in_book(bookId, query, maxResults?, caseSensitive?)` | Keyword search within a book → snippets + locations.                                     |

**Discovery & browse**

| Tool                                                                    | What it does                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `get_related_books(bookId, kind)`                                       | `similar` / `same_series` / `same_author` books for a book.                                                        |
| `list_series(page?, size?)`                                             | Library's series with book/read counts.                                                                            |
| `get_series_books(seriesId, page?, size?)`                              | Books in a series, in order.                                                                                       |
| `list_authors(page?, size?)`                                            | Library's authors with book counts.                                                                                |
| `get_author(authorId)`                                                  | One author, including their bio.                                                                                   |
| `get_author_books(authorId, page?, size?)`                              | Books by an author.                                                                                                |
| `list_collections()` / `get_collection(id)` / `get_collection_books(…)` | User collections, one collection's detail, and its books.                                                          |
| `list_smart_scopes()` / `get_smart_scope_books(…)`                      | Saved dynamic filters and the books they match.                                                                    |
| `list_libraries()`                                                      | Libraries with per-library book/size/format stats.                                                                 |
| `suggest_metadata(kind, q)`                                             | Typeahead over authors/series/genres/tags/publishers/languages/narrators/collections — resolve an exact name.      |
| `get_book_shelf(type, limit?)`                                          | A curated shelf: recently-added, want-to-read, up-next-in-series, continue-reading/listening, random, smart-scope. |
| `search_author_metadata(q, …)`                                          | External provider author-bio candidates (enrichment, not your library).                                            |

**Reading state & stats**

| Tool                                       | What it does                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `get_reading_progress(bookId)`             | Per-file progress (+ audiobook progress) for a book.                                                    |
| `list_currently_reading()`                 | Books you're reading now, with progress.                                                                |
| `get_reading_sessions(bookId, page?, …)`   | Reading-session history + aggregate stats for a book.                                                   |
| `get_library_stats()`                      | Library-wide totals (books/authors/series/storage/…).                                                   |
| `get_reading_stats()`                      | Your personal reading totals (started/completed/…).                                                     |
| `get_library_statistic(kind, libraryIds?)` | One library-wide chart: distributions, top-authors/series, timelines, metadata-health gauges.           |
| `get_reading_statistic(kind, days?, …)`    | One personal reading chart: peak-hours, favorite-days, heatmap, completion-latency, goal-trajectory, …  |
| `get_dashboard_widget(kind)`               | One "headline card": reading-streak, reading-goal, year-projection, neglected-gems, library-overview, … |

**Annotations** (your own highlights & notes)

| Tool                                          | What it does                                        |
| --------------------------------------------- | --------------------------------------------------- |
| `list_annotations(page?, pageSize?, bookId?)` | All highlights/notes across the library, paginated. |
| `list_annotated_books()`                      | Which books have annotations, with counts.          |
| `get_annotations(bookId)`                     | One book's highlights/notes, in chapter order.      |

**Images** (returned as image content, not text)

| Tool                                | What it does                                  |
| ----------------------------------- | --------------------------------------------- |
| `get_book_cover(bookId, size?)`     | A book's cover image (`full` or `thumbnail`). |
| `get_author_image(authorId, size?)` | An author's photo (`full` or `thumbnail`).    |

**Typical flow:** `search_books` → `list_chapters` → `get_chapter` /
`search_in_book`.

## Requirements & scope

- **EPUB only** (v1). Books without an EPUB file return a clear error from the
  text tools.
- **Auth:** Prefer a native scoped, read-only API key on current BookOrbit.
  Keys can expire or be revoked. Authentication/permission failures never switch
  to a password or another credential. Legacy account login remains opt-in.
- Single-user / local: it acts as the account you configure.

## Configuration

Set these as environment variables (or in a local `.env` — see `.env.example`):

| Variable                                    | Required      | Notes                                                                            |
| ------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| `BOOKORBIT_URL`                             | yes           | Base URL, e.g. `https://bookorbit.example.com` (trailing slash ok).              |
| `BOOKORBIT_API_KEY`                         | recommended   | Native scoped API key, injected at launch by a secret manager.                   |
| `BOOKORBIT_TOKEN`                           | compatibility | Static Bearer, native key or short-lived JWT; no refresh or fallback.            |
| `BOOKORBIT_AUTH_MODE`                       | legacy only   | Set `password` explicitly to enable account login when no key/token is selected. |
| `BOOKORBIT_USERNAME` / `BOOKORBIT_PASSWORD` | legacy only   | Only used in explicit password mode; may refresh/re-login.                       |

Key precedence is `BOOKORBIT_API_KEY` then `BOOKORBIT_TOKEN`, then explicit legacy
password mode. An empty selected key/token is a configuration error, not permission
to downgrade. Keep secrets out of source, command arguments, diagnostics and MCP
client files when possible; use your secret manager's process-environment injection.
Only legacy mode may call `/auth/login` or `/auth/refresh`.

`CACHE_DIR` is no longer used. Persistent extracted-content caching is not supported.
Old `~/.cache/bookorbit-mcp` files are neither read nor automatically deleted. Review
and remove them separately if no other installation needs them.

## Install & build

Use a currently patched **Node.js 24 LTS** release for normal use. Node.js 20
compatibility is still checked, but that line is end-of-life and is not recommended.
CI runs the canonical checks on both Node.js 20 and 24.

Tool arguments have a pre-schema budget of 128 combined object members and array
elements, including unknown properties. Both statistic tools accept at most 100
`libraryIds`. Oversized inputs are rejected before unbounded per-item validation;
invalid inputs never reach BookOrbit. This is not a transport byte limit: run this
local stdio server only with trusted MCP clients, not as a public endpoint.

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
        "BOOKORBIT_API_KEY": "<inject your scoped API key from a secret manager>"
      }
    }
  }
}
```

## Development

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test          # offline tests against synthetic fixtures, including source stdio
npm run build
BOOKORBIT_TEST_BUILT=1 npm test # repeat stdio checks against dist/server.js
npm run dev       # run the server from source over stdio

# Live checks against a real server (inject environment credentials first):
node --import tsx scripts/smoke.mts      # exercises search → parse → chapter → search
node --import tsx scripts/mcp-check.mts   # drives the built server over the MCP stdio protocol
```

## Design notes

- **Chapters follow the TOC, not raw files.** A single EPUB spine file can bundle
  many chapters separated by `#fragment` anchors; the server resolves the table
  of contents into meaningful sections and slices each one by its anchor range.
- **Content cache:** memory only, isolated per service/client instance, at most
  four books and 32 MiB of serialized metadata/text (not a total process-RSS cap).
  Every content operation rechecks live metadata and the pinned EPUB file's access.
  File identity/version and EPUB structure changes invalidate it. If no file hash
  or content version is available, content is rebuilt rather than reused.
- **Request limits:** 15-second deadline including body streaming, 8 MiB per
  response, no HTTP redirects, at most three concurrent spine fetches per build,
  500 spine files, 2000 sections and 16 MiB aggregate XHTML/extracted characters per
  book. Oversized books fail explicitly. The initial parse still fetches all
  referenced XHTML resources of one selected book, not only a requested chapter.
  Returned chapters/snippets remain bounded; no full-file download or library index.
- **Locations:** text results retain book ID, selected file ID, section index,
  spine path, anchor range and character offset. These section indices are not
  BookOrbit annotation chapter indices or EPUB CFIs.
- **Discovery, reading-state, stats, and annotation tools are live passthroughs**
  to BookOrbit and are **not cached** (that data is mutable); only extracted EPUB
  text is cached.
- **Not included (v1):** semantic/RAG search, cross-library content search,
  PDF/MOBI, and any write operations.

## Current API compatibility

The current contracts were checked against BookOrbit v3.8.0. Catalog/series/author/
collection/smart-scope pages are **zero-based**; annotations and reading sessions
are **one-based**. `browse_books` only submits the released, explicitly read-safe
query POST, not arbitrary HTTP operations. Book-detail author objects are normalized
to names. Existing discovery, statistics, annotation, progress and image tools are
retained. See [the compatibility audit](docs/compatibility.md) for route coverage.

Some dashboard widgets, including `list_currently_reading`, reading streak, reading
goal, monthly challenge, year projection, reading rhythm and highlight-of-the-day,
require App Attest in this release and reject native keys. Their tools return an
explicit server-policy error. No fabricated zero/empty statistics or password
fallback is supplied. Use the separate continue-reading/listening shelves when
those are useful, but they are not claimed to be equivalent to the denied widget.
Other permissions or library scope may also deny reads. HTTP failures surface as
sanitized errors without upstream response bodies.

Live scripts report only IDs/counts/status, require injected credentials, and do
not capture titles or content. `BOOKORBIT_CHECK_BOOK_ID` optionally selects an EPUB
for a check; otherwise the first EPUB in one bounded catalog page is selected.
The stdio check has a 180-second overall deadline; individual HTTP requests remain
bounded as above. Offline tests are not a claim of production readiness or server
health. Revocation, scope changes, file replacement and transport bounds are tested
using synthetic local HTTP fixtures, never by mutating a live account.
