# BookOrbit HTTP API — read-only reference

This directory documents the **read-only (`GET`) surface** of the [BookOrbit](https://github.com/bookorbit/bookorbit)
server API, focused on the endpoints relevant to reading and browsing a library. It exists so
that work on this MCP server (and anyone reading the repo) has a human-readable map of what each
endpoint does and what payload it returns — **without** committing any real library data.

> This is documentation only. The authoritative, always-current path list is the live OpenAPI
> spec at `GET /api/docs-json` on any BookOrbit instance.

## Base URL & versioning

All endpoints live under a versioned prefix:

```
<BOOKORBIT_URL>/api/v1/...
```

`<BOOKORBIT_URL>` is your instance's base URL (e.g. `https://bookorbit.example.com`). A few
device-integration routes use `/api/v3/...`; those are out of scope here. The base URL is
normalized to strip a trailing slash before `/api/v1` is appended (see `src/bookorbit-client.ts`).

## Authentication

BookOrbit issues **short-lived (~15 minute) JWT access tokens** and has **no long-lived API
key**. The flow every authenticated request depends on:

1. `POST /api/v1/auth/login` with `{ "username", "password" }` → `{ "accessToken": "..." }`,
   and sets a `refresh_token` cookie.
2. Send the token on each request as `Authorization: Bearer <accessToken>`.
3. On a `401`, `POST /api/v1/auth/refresh` (with the refresh cookie) for a new access token, or
   fall back to a full re-login.

Unless an endpoint is explicitly marked **public**, assume a Bearer token is required. All
endpoints documented here are read-only and **safe** — they never modify data.

## How to read these docs

Each endpoint is documented in this shape:

````markdown
### `GET /api/v1/<path>`

**Purpose:** what it returns and why a client calls it.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Query params:** `q` (string, required) — search term.
**Returns:** `application/json` — one-line shape summary.

| Field | Type   | Description |
| ----- | ------ | ----------- |
| `id`  | number | Book id     |

**Example:**

```json
{ "id": 123, "title": "Book Title" }
```
````

Binary/streaming endpoints (covers, thumbnails, file downloads, comic pages, SSE streams) omit
the field table and example body — they state the content type instead. OPDS endpoints return
`application/atom+xml` and show a trimmed XML snippet rather than JSON.

### Conventions

- **Pagination.** List endpoints generally return either a bare JSON array or a page envelope.
  The two page shapes you'll see:
  - `{ "items": [...], "total": N, "page": 1, "size": 25 }` (browse endpoints), or
  - `{ "items": [...], "total": N, "page": 1, "pageSize": 25, "stats": {...} }` (hubs).
- **Sanitized examples.** Every example uses generic placeholder values, never real data:
  `"Book Title"`, `"Book Subtitle"`, `"Author Name"`, `"Series Name"`, `"Publisher Name"`,
  `"Genre"`, `"tag"`, `"Library Name"`; ids as `123`/`456`; timestamps as
  `"2024-01-01T00:00:00Z"`; EPUB CFI as `"epubcfi(/6/4!/4/2)"`; progress as a `0`–`1` fraction.
  Field names are real; values are illustrative.

## Sections

| Section            | File                                     | What it covers                                                                                         |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Books              | [books.md](books.md)                     | Search, book detail, files, progress, covers, per-book bookmarks/sessions/annotations, recommendations |
| EPUB reader        | [epub.md](epub.md)                       | EPUB structure (spine/TOC/metadata) and internal file fetch                                            |
| Comic reader       | [cbz.md](cbz.md)                         | CBZ page count and single-page image                                                                   |
| Reader preferences | [reader.md](reader.md)                   | Reader default settings and per-file overrides                                                         |
| Annotations hub    | [annotations.md](annotations.md)         | Cross-library highlights/notes list, per-book counts, export                                           |
| Collections        | [collections.md](collections.md)         | User collections and their books                                                                       |
| Libraries          | [libraries.md](libraries.md)             | Library list, detail, per-library stats and access                                                     |
| Authors            | [authors.md](authors.md)                 | Author list/detail, their books, images, metadata lookup                                               |
| Series             | [series.md](series.md)                   | Series list and per-series books                                                                       |
| Dashboard          | [dashboard.md](dashboard.md)             | Home-page widgets (currently reading, streaks, goals, …)                                               |
| Library statistics | [statistics.md](statistics.md)           | Library-wide analytics (distributions, timelines, top-N)                                               |
| Reading statistics | [user-statistics.md](user-statistics.md) | The signed-in user's personal reading analytics                                                        |
| OPDS               | [opds.md](opds.md)                       | OPDS Atom XML catalog feeds                                                                            |
| Metadata catalog   | [metadata.md](metadata.md)               | Faceted search over authors/series/genres/tags/…                                                       |

## What's intentionally excluded

- **All write operations** (`POST`/`PUT`/`PATCH`/`DELETE`) — this reference is read-only.
- **Integrations & infrastructure** sections: `auth` (beyond the flow above), `users`,
  `app-settings`, `email`, `kobo`, `koreader`, `migration`, `entity-manager`, `hardcover`,
  `storygraph`, `readwise`, `custom-icons`, `custom-metadata`, `fonts`, `notifications`,
  `book-dock`, `achievements`, `metadata-fetch`, `metadata-preferences`, `metadata-score`,
  `smart-scopes`, `opds-users`, `path`, `audit-log`, `health`, `release-notes`, and the Kobo
  `/api/v3` device routes.

For the complete, authoritative list of every path (including the excluded ones), query the live
spec: `curl <BOOKORBIT_URL>/api/docs-json`.
