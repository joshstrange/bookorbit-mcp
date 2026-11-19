# Current BookOrbit API compatibility

Contract reference: BookOrbit **v3.8.0**, commit
[`450c18e2acf79ddd39b6dee022a523281448e5e6`](https://github.com/bookorbit/bookorbit/tree/450c18e2acf79ddd39b6dee022a523281448e5e6).
Paths below are relative to `/api/v1`. This is a source-contract audit of the MCP
surface, not a claim that every route or returned statistic has been live-tested.

## Authentication and server policy

Native scoped API keys are preferred. A selected key or static Bearer never
refreshes, logs in or falls back to another credential. Legacy password login is
explicitly opt-in. See [configuration and migration](../README.md#configuration).
All tools remain read-only; a read-safe query POST is not a mutation.

Some dashboard routes require App Attest and reject native keys even when the
account can view the corresponding data in the app. These denials remain errors,
not fabricated empty data or a reason to switch credentials.

## Route changes and retained behavior

| Tools                                                        | Current contract                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_books`                                               | `GET /books/search?q=&limit=`; bare array, limit 1–20.                                                                                                                                                                                                                      |
| `browse_books`                                               | Read-safe `POST /books/query`; `{q?,pagination:{page,size}}`, HTTP 201, `{items,total,page,size}`. Zero-based. No generic filters or mutations.                                                                                                                             |
| `get_book`                                                   | `GET /books/:id`; author objects normalized to names, file IDs retained.                                                                                                                                                                                                    |
| `list_chapters`, `get_chapter`, `search_in_book`             | Authorize with `GET /books/:id`; pin the first EPUB file ID in `/epub/:id/info?fileId=` and `/epub/:id/file/*?fileId=`. Preserve TOC/anchor sections and bounded output, include source location.                                                                           |
| `list_annotations`                                           | `GET /annotations?page=&pageSize=&bookId=`; `{items,total,page,pageSize,stats}`, one-based.                                                                                                                                                                                 |
| `list_annotated_books`                                       | `GET /annotations/books`; ranked preview (default limit 20), not an exhaustive inventory. Returned count is not a library total.                                                                                                                                            |
| `get_annotations`                                            | `GET /books/:id/annotations`; uncached array. Reader chapter numbering is not MCP section numbering.                                                                                                                                                                        |
| `get_related_books`                                          | `GET /books/:id/recommendations`, `series-books` or `author-books`; existing dispatch preserved.                                                                                                                                                                            |
| `list_series`, `get_series_books`                            | `GET /series`, `/series/:id/books`; zero-based page/size.                                                                                                                                                                                                                   |
| `list_authors`, `get_author`, `get_author_books`             | `GET /authors`, `/authors/:id`, `/authors/:id/books`; zero-based page/size.                                                                                                                                                                                                 |
| `list_collections`, `get_collection`, `get_collection_books` | `GET /collections?bookIds=`, `/collections/:id`, `/collections/:id/books`; zero-based page/size, including the omitted-page default.                                                                                                                                        |
| `list_smart_scopes`, `get_smart_scope_books`                 | List GET preserved. Book-list GET requires App Attest; read-safe `POST /smart-scopes/:id/books/query` invokes the same query service with nested pagination and `sort: []`. Zero-based, including omitted-page default. No key-policy bypass.                               |
| `list_libraries`                                             | `GET /libraries` plus best-effort `/libraries/:id/stats`; failed stats remain null, not zero.                                                                                                                                                                               |
| `get_reading_progress`                                       | `GET /books/:id/progress` plus best-effort `/audio-progress`. File IDs retained; optional audio null is not proof of no listening history.                                                                                                                                  |
| `get_reading_sessions`                                       | `GET /books/:id/sessions?page=&pageSize=`; one-based.                                                                                                                                                                                                                       |
| `list_currently_reading`                                     | `GET /dashboard/widgets/currently-reading`; requires App Attest, native-key denial remains explicit.                                                                                                                                                                        |
| `get_library_stats`, `get_reading_stats`                     | `GET /statistics/summary`, `/user-statistics/summary`; uncached JSON.                                                                                                                                                                                                       |
| `get_library_statistic`, `get_reading_statistic`             | Existing 19 library and 16 personal statistic kinds retained, with repeatable library IDs and per-kind options. Chart bodies remain passthrough JSON.                                                                                                                       |
| `suggest_metadata`                                           | `GET /metadata/:kind?q=`; typeahead, not list-everything. Whitespace query can return `[]`.                                                                                                                                                                                 |
| `get_dashboard_widget`                                       | Existing 11-kind dispatch preserved. `reading-streak`, `reading-goal`, `monthly-challenge`, `reading-rhythm`, `year-projection` and `highlight-of-the-day` require App Attest. Other kinds have ordinary GET routes.                                                        |
| `get_book_shelf`                                             | `GET /dashboard/scrollers/:type?limit=&smartScopeId=`; normalize current `{books,total}` and legacy arrays. Count is received shelf length, not total. Seven types preserved. Continue-reading/listening shelves are not equivalent to the denied currently-reading widget. |
| `search_author_metadata`                                     | `GET /authors/metadata/search`; external-provider lookup, not library metadata. Default live checks omit it to avoid unnecessary provider calls.                                                                                                                            |
| `get_book_cover`, `get_author_image`                         | Existing cover/image/thumbnail routes; bounded image bytes returned as MCP image blocks.                                                                                                                                                                                    |

## Reliability and retention

- HTTP: **15 seconds** across headers and streamed body, **8 MiB** per response,
  no redirects. Applies to legacy login/refresh too. Normal TLS validation stays
  enabled. Errors omit upstream bodies and transport URLs/queries; only known-safe
  network error codes are retained.
- Content cache: process memory only, isolated per service/client instance, at most
  **four books / 32 MiB** serialized metadata and text. This is not a process RSS
  limit. Old disk caches are neither read, migrated nor deleted.
- Every content operation rechecks live book and pinned EPUB access and compares
  file version/hash, metadata and structure. Missing version evidence forces a
  rebuild. Denials or request failures purge cached content and fail closed.
- Builds fetch at most **three spine files concurrently**, drain workers on error,
  and cap a selected book at **500 files / 2000 sections / 16 MiB aggregate XHTML /
  16 MiB extracted characters**. The first parse fetches referenced XHTML for one
  selected book, not just one requested chapter. No EPUB zip or library index.
- Before publishing a build, reread book/file metadata and EPUB structure. Reject
  detected changes rather than returning mixed-edition text. Section reads reject
  concurrent cache replacement/eviction. This is observational revalidation, not
  a server-side atomic snapshot; unreported changes cannot be proven absent.

## Evidence and source navigation

Synthetic HTTP and source/built stdio tests cover native-key precedence, explicit
legacy configuration, no credential downgrade, query shapes, pagination, response
bounds, redirects, mid-body timeout, revocation, version drift, cache isolation and
build races. The stdio surface test discovers and calls all 34 tools, including a
simulated App Attest denial and both image tools. Empty fixture responses are
wiring coverage, not validation of every nonempty server response or enum kind.
See [reproducible commands](../README.md#development). Live qualification is a
separate deployment-specific check.

Useful locations in the pinned upstream source:

- [API-key policy guard](https://github.com/bookorbit/bookorbit/blob/450c18e2acf79ddd39b6dee022a523281448e5e6/server/src/common/guards/api-key-policy.guard.ts)
- [Book routes and query service](https://github.com/bookorbit/bookorbit/tree/450c18e2acf79ddd39b6dee022a523281448e5e6/server/src/modules/book)
- [Smart-scope routes](https://github.com/bookorbit/bookorbit/tree/450c18e2acf79ddd39b6dee022a523281448e5e6/server/src/modules/smart-scope)

The older endpoint notes under `docs/api/` remain useful background, but this
version-pinned audit governs the compatibility changes described here.
