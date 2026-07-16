# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP (Model Context Protocol) server that exposes the **text of ebooks** stored in a
self-hosted [BookOrbit](https://github.com/bookorbit/bookorbit) instance to LLMs. It is
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

These hit a real BookOrbit instance and are **not** part of `npm test`:

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
tools.ts  ->  book-service.ts  ->  bookorbit-client.ts   (HTTP to BookOrbit)
                     |          ->  epub-structure.ts     (TOC/spine -> sections)
                     |          ->  html-to-text.ts       (XHTML slice -> text)
                     +--------->  cache.ts                (disk, per bookId)
```

`book-service.ts` is the orchestrator; the other modules are pure/single-purpose and are
unit-tested in isolation. Everything is keyed by **bookId**, not fileId.

### Non-obvious design decisions

- **The MCP does NOT download/parse EPUB zips.** BookOrbit exposes a server-side reader
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

- **Auth is short-lived.** BookOrbit access tokens expire in ~15 minutes and there is no
  long-lived API key. `bookorbit-client.ts` logs in with username/password, sends the JWT as a
  Bearer token, captures the `refresh_token` cookie, and on a 401 tries `/auth/refresh` then a
  full re-login (`reauthenticate`). BookOrbit's search param is `q` (not `query`), and the base
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
  BookOrbit's own `chapterTitle`/`chapterIndex`, which are its reader model's numbering and are
  **not** the `list_chapters`/`get_chapter` section indices — do not conflate them; match on
  `chapterTitle` if you need the surrounding text.

- **Discovery / reading-state / stats tools are the same live-passthrough pattern** as the
  annotation tools (call the client directly, NOT cached). Added on top of the reader + annotation
  tools:
  - _Related & browse:_ `get_related_books` (`GET /books/{id}/recommendations|series-books|
author-books` via a `kind` arg), `list_series` / `get_series_books`, `list_authors` /
    `get_author` / `get_author_books`, `list_collections` / `get_collection` /
    `get_collection_books`, `list_smart_scopes` / `get_smart_scope_books`, `list_libraries`
    (enriched with `GET /libraries/{id}/stats`), `search_author_metadata`
    (`GET /authors/metadata/search` — EXTERNAL provider bios, not library data).
  - _Reading state:_ `get_reading_progress` (`GET /books/{id}/progress` + best-effort
    `/audio-progress`), `list_currently_reading`, `get_reading_sessions`.
  - _Stats:_ `get_library_stats` (`GET /statistics/summary`), `get_reading_stats`
    (`GET /user-statistics/summary`). Plus two **`kind`-dispatch** tools that cover the rest of
    the analytics surface (one enum arg = one path suffix, like `get_related_books`):
    `get_library_statistic` (`GET /statistics/{kind}` — 19 distribution/timeline/top-N/gauge
    charts) and `get_reading_statistic` (`GET /user-statistics/{kind}` — 16 personal
    reading-activity charts). Both take repeatable `libraryIds`; reading also takes a `days`
    window plus per-kind extras (`year`/`week` for `session-timeline`, `comparePrevious` for
    `progress-funnel`, `goalBooks` for `goal-trajectory`). `summary` is intentionally NOT a
    dispatch `kind` — it keeps its dedicated tool. Bodies are pass-through JSON (the ~35 analytic
    shapes aren't individually typed); the kind unions live in `types.ts`
    (`LIBRARY_STAT_KINDS`/`USER_STAT_KINDS`).
  - _Metadata typeahead:_ `suggest_metadata` (`GET /metadata/{kind}?q=` — authors, series,
    genres, tags, publishers, languages, narrators, the user's collections; `kind` enum
    `METADATA_FACET_KINDS`). A case/accent-insensitive **contains** match used to resolve an exact
    facet name before browsing/filtering; `q` is required and an empty `q` returns `[]` (there is
    no "list everything" mode). Repeatable `libraryIds` is built by the `statsParams` helper in
    `bookorbit-client.ts`.
  - _Dashboard & shelves:_ `get_dashboard_widget` (`GET /dashboard/widgets/{kind}` — 11 compact
    "headline card" widgets: reading-streak/goal/year-projection, reading-dna/diversity-score,
    neglected-gems/long-wait/highlight-of-the-day, library-overview, …; `kind` enum
    `DASHBOARD_WIDGET_KINDS`). These are the pre-computed siblings of the `get_reading_statistic`
    charts (`library-overview` ≈ a subset of `get_library_stats`). `currently-reading` is NOT a
    dispatch `kind` — it keeps `list_currently_reading`. `get_book_shelf`
    (`GET /dashboard/scrollers/{type}` — 7 curated shelves: recently-added, continue-reading/
    listening, want-to-read, up-next-in-series, random, smart-scope; `type` enum
    `BOOK_SHELF_TYPES`, trimmed by `shapeBookListItem`). `smart-scope` requires a `smartScopeId`
    (validated tool-side; from `list_smart_scopes`).
  - _Images (the only non-text tools):_ `get_book_cover` (`GET /books/{id}/cover|thumbnail`) and
    `get_author_image` (`GET /authors/{id}/image|thumbnail`) return an MCP **image** content block
    (base64 via `okImage` in `tools.ts`), not JSON. The client's `getImage` reads bytes off
    `authFetch` (which throws `BookOrbitError` on a 404 → "no cover"). A `size` arg picks
    full/thumbnail. This is the server's only departure from text-only output.
  - **Two pagination conventions:** the browse endpoints use `page`/`size` (helpers `pageParams`/
    `pageQuery` in `bookorbit-client.ts`), but `/books/{id}/sessions` uses `page`/`pageSize` — do
    not unify them. The browse `/books` endpoints (`series`, `authors`, `collections`, `smart-
scopes`) all return the same rich item, trimmed by `shapeBookListItem` in `tools.ts`; related-
    books arrays are lighter, trimmed by `shapeRelatedBook`. `get_reading_progress` explicitly
    drops the `kobo*` fields.
  - **Metadata facets — resolved:** these earlier "returned empty" because they're **`q`-driven
    typeahead** (empty/whitespace `q` ⇒ `[]`), not list-everything endpoints. With a search term
    they work, and are now exposed via `suggest_metadata` (above).

### Testing note

`test/fixtures/` are **synthetic** (`epub-info.json`, `chapter-bundle.xhtml`) and deliberately
mimic the real API's structure (bundled `#chNNN` anchors, nested TOC, a spine file missing from
the TOC). Do **not** replace them with real book content — this is a public repo and real EPUB
text is copyrighted. Regenerate structure-preserving fixtures instead if the shape needs to
change.

## Scope (v1)

EPUB only (for _text_), read-only, single-user/local, keyword (not semantic) search scoped to
one book. In scope: reading the user's own annotations (highlights/notes), and read-only library
navigation — discovery/browse (series, authors, collections, smart scopes, related books,
libraries), reading state (progress, currently-reading, sessions), and statistics — see the
tools above. Out of scope by design: RAG/embeddings, cross-library content search, PDF/MOBI
_text extraction_, bookmarks, and any write operations (including creating/editing annotations).
The cache layout leaves room for a later cross-book index.
