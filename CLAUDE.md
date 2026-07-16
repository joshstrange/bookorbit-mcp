# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server that exposes the **text of ebooks** stored in a
self-hosted [Book Orbit](https://bookorbit.home.joshstrange.com) instance to LLMs. It is
**navigation-first**: rather than dumping whole books into context, it lets a model find a
book, inspect its chapter list, and pull only the pieces it needs.

## Commands

```bash
npm install            # install deps
npm run build          # tsc -> dist/ (bin: dist/server.js)
npm run dev            # run the server from source over stdio (tsx)
npm test               # all unit tests (offline, against fixtures)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier --write .
npm run format:check   # prettier --check . (CI enforces this)

# Run one test file:
node --import tsx --test test/html-to-text.test.ts
# Filter by test name:
node --import tsx --test --test-name-pattern="paginates" test/tools.test.ts
```

CI (`.github/workflows/ci.yml`) runs, in order: format:check → lint → typecheck → test → build.
Keep all five green.

### Live checks (need a real server; read `.env`)

These hit a real Book Orbit instance and are **not** part of `npm test`:

```bash
node --import tsx scripts/smoke.mts      # search -> parse -> chapter -> in-book search
node --import tsx scripts/mcp-check.mts   # drives the BUILT server over the MCP stdio protocol
```

Config comes from env (or a local `.env`, gitignored — see `.env.example`): `BOOKORBIT_URL`,
plus either `BOOKORBIT_USERNAME`+`BOOKORBIT_PASSWORD` (preferred) or a static `BOOKORBIT_TOKEN`
(dev only). Optional `CACHE_DIR`.

## Architecture (the big picture)

Request flow for a tool call:

```
tools.ts  ->  book-service.ts  ->  bookorbit-client.ts   (HTTP to Book Orbit)
                     |          ->  epub-structure.ts     (TOC/spine -> sections)
                     |          ->  html-to-text.ts       (XHTML slice -> text)
                     +--------->  cache.ts                (disk, per bookId)
```

`book-service.ts` is the orchestrator; the other modules are pure/single-purpose and are
unit-tested in isolation. Everything is keyed by **bookId**, not fileId.

### Non-obvious design decisions

- **The MCP does NOT download/parse EPUB zips.** Book Orbit exposes a server-side reader
  backend — `GET /epub/{bookId}/info` (spine + nested TOC + metadata) and
  `GET /epub/{bookId}/file/{path}` (one internal XHTML file). The client uses those; there is
  intentionally no zip/EPUB library dependency.

- **A "chapter" = a flattened-TOC section, not a spine file.** One EPUB spine file often
  bundles many chapters separated by `#fragment` anchors (e.g. `bundle.xhtml#ch002`).
  `epub-structure.ts` resolves the nested TOC + spine into an ordered `Section[]`, each with a
  `spineHref` and an anchor range `[startAnchor, endAnchor)`. `html-to-text.ts` fetches the
  spine file's XHTML and extracts only that anchor range. Spine files absent from the TOC get a
  whole-file fallback section. This is why the section list is much longer/finer than the spine.

- **"Don't overwhelm the LLM" is enforced in `tools.ts`, structurally:** `list_chapters`
  returns sizes but no body text; `get_chapter` caps output (`DEFAULT_MAX_CHARS`) and paginates
  via `offset`/`nextOffset`; `search_in_book` returns snippets plus a re-fetchable
  chapter+offset. Preserve these guarantees when editing tools.

- **Auth is short-lived.** Book Orbit access tokens expire in ~15 minutes and there is no
  long-lived API key. `bookorbit-client.ts` logs in with username/password, sends the JWT as a
  Bearer token, captures the `refresh_token` cookie, and on a 401 tries `/auth/refresh` then a
  full re-login (`reauthenticate`). Book Orbit's search param is `q` (not `query`), and the base
  URL is normalized to strip a trailing slash.

- **Cache is build-once, per book.** First `getParsedBook(bookId)` fetches every referenced
  spine file, extracts each section's text, computes char/word counts, and writes
  `<CACHE_DIR>/<bookId>/book.json` + `text/section-NNN.txt`. Later calls read from disk.
  Concurrent builds of the same book are de-duplicated via an in-flight map.

- **Annotations (a.k.a. notes/highlights) are a live, uncached passthrough.** Three read-only
  tools — `list_annotations` (all annotations across the library, paginated via `page`/`pageSize`
  over `GET /annotations`, optional `bookId` filter), `list_annotated_books` (which books have
  annotations + counts, `GET /annotations/books`), and `get_annotations` (one book's highlights/
  notes, `GET /books/{bookId}/annotations`) — call the client directly, like `search_books`/
  `get_book`, and are NOT cached (annotations are mutable user data). Each annotation carries
  Book Orbit's own `chapterTitle`/`chapterIndex`, which are its reader model's numbering and are
  **not** the `list_chapters`/`get_chapter` section indices — do not conflate them; match on
  `chapterTitle` if you need the surrounding text.

### Testing note

`test/fixtures/` are **synthetic** (`epub-info.json`, `chapter-bundle.xhtml`) and deliberately
mimic the real API's structure (bundled `#chNNN` anchors, nested TOC, a spine file missing from
the TOC). Do **not** replace them with real book content — this is a public repo and real EPUB
text is copyrighted. Regenerate structure-preserving fixtures instead if the shape needs to
change.

## Scope (v1)

EPUB only, read-only, single-user/local, keyword (not semantic) search scoped to one book.
Reading the user's own annotations (highlights/notes) is in scope — see the annotations tools
above. Out of scope by design: RAG/embeddings, cross-library content search, PDF/MOBI,
bookmarks, and any write operations (including creating/editing annotations). The cache layout
leaves room for a later cross-book index.
