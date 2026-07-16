# Authors

Endpoints for browsing the library's authors, listing an author's books, and fetching author
images. Also covers the read-only slices of the **metadata / enrichment** subsystem (external
metadata-provider lookups and enrichment status) — the write operations that drive enrichment
(`POST`/`PUT`/`PATCH`/`DELETE` under `/authors/...`) are out of scope for this read-only reference.

All endpoints require a Bearer JWT (see [README](README.md#authentication)). Author visibility is
scoped to the libraries the signed-in user can access; the two `enrichment/*` routes documented
here additionally require the `ManageMetadataConfig` permission.

> **Pagination is zero-based here.** The browse endpoints (`/authors`, `/authors/{id}/books`) use
> `page` (default `0`) and `size` (default `50`, max `100`) query params and return the
> `{ items, total, page, size }` envelope (`Paged<T>` in `src/types.ts`).

## List, detail, and books

### `GET /api/v1/authors`

**Purpose:** Paginated, filterable list of authors across the accessible libraries. Backs the
authors browse view.
**Auth:** Bearer JWT required.
**Query params:**

| Param          | Type    | Default | Description                                                              |
| -------------- | ------- | ------- | ------------------------------------------------------------------------ |
| `q`            | string  | —       | Case-insensitive name search (max 500 chars).                            |
| `page`         | integer | `0`     | Zero-based page index.                                                   |
| `size`         | integer | `50`    | Page size, `1`–`100`.                                                    |
| `sort`         | string  | `name`  | One of `name`, `sortName`, `bookCount`, `lastAddedAt`, `lastEnrichedAt`. |
| `order`        | string  | `asc`   | `asc` or `desc`.                                                         |
| `libraryId`    | integer | —       | Restrict to a single library the user can access.                        |
| `hasPhoto`     | boolean | —       | Only authors that have (`true`) / lack (`false`) an image.               |
| `minBookCount` | integer | —       | Only authors with at least this many books.                              |

**Returns:** `application/json` — `{ items: AuthorSummary[], total, page, size }`.

| Field         | Type           | Description                                             |
| ------------- | -------------- | ------------------------------------------------------- |
| `id`          | number         | Author id.                                              |
| `name`        | string         | Display name.                                           |
| `sortName`    | string \| null | Sort-friendly name (e.g. "Last, First").                |
| `description` | string \| null | Author bio.                                             |
| `imageUrl`    | string \| null | Relative URL of the author thumbnail, or null if none.  |
| `bookCount`   | number         | Number of books by this author in accessible libraries. |
| `lastAddedAt` | string \| null | ISO timestamp of the most recently added book.          |

**Example:**

```json
{
  "items": [
    {
      "id": 123,
      "name": "Author Name",
      "sortName": "Name, Author",
      "description": "Author bio text.",
      "imageUrl": "/api/v1/authors/123/thumbnail",
      "bookCount": 12,
      "lastAddedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 0,
  "size": 50
}
```

### `GET /api/v1/authors/{id}`

**Purpose:** Detail for one author.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the author id.
**Returns:** `application/json` — a single `AuthorDetail`. Same fields as an `AuthorSummary` item
above (`id`, `name`, `sortName`, `description`, `imageUrl`, `bookCount`, `lastAddedAt`); on detail,
`imageUrl` prefers the full-size image and falls back to the thumbnail. Responds `404` if the
author is not found in an accessible library.

**Example:**

```json
{
  "id": 123,
  "name": "Author Name",
  "sortName": "Name, Author",
  "description": "Author bio text.",
  "imageUrl": "/api/v1/authors/123/image",
  "bookCount": 12,
  "lastAddedAt": "2024-01-01T00:00:00Z"
}
```

### `GET /api/v1/authors/{id}/books`

**Purpose:** Paginated list of books by one author. Returns full "book card" items (the same shape
the series and collection `/books` endpoints return; a subset is typed as `BookListItem` in
`src/types.ts`).
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the author id.
**Query params:**

| Param       | Type    | Default   | Description                                 |
| ----------- | ------- | --------- | ------------------------------------------- |
| `page`      | integer | `0`       | Zero-based page index.                      |
| `size`      | integer | `50`      | Page size, `1`–`100`.                       |
| `sort`      | string  | `addedAt` | One of `title`, `publishedYear`, `addedAt`. |
| `order`     | string  | `desc`    | `asc` or `desc`.                            |
| `libraryId` | integer | —         | Restrict to one accessible library.         |

**Returns:** `application/json` — `{ items: BookCard[], total, page, size }`. Responds `404` if the
author is not found. Each `BookCard` carries (selected fields):

| Field             | Type           | Description                                   |
| ----------------- | -------------- | --------------------------------------------- |
| `id`              | number         | Book id.                                      |
| `title`           | string \| null | Book title.                                   |
| `subtitle`        | string \| null | Subtitle.                                     |
| `authors`         | string[]       | Author display names.                         |
| `seriesId`        | number \| null | Series id, if in a series.                    |
| `seriesName`      | string \| null | Series name.                                  |
| `seriesIndex`     | number \| null | Position within the series.                   |
| `files`           | array          | File refs: `{ id, format, role, sizeBytes }`. |
| `publishedYear`   | number \| null | Publication year.                             |
| `language`        | string \| null | Language code.                                |
| `genres`          | string[]       | Genre names.                                  |
| `tags`            | string[]       | Tag names.                                    |
| `hasCover`        | boolean        | Whether a cover image exists.                 |
| `readingProgress` | number \| null | `0`–`1` fraction, or null.                    |
| `addedAt`         | string         | ISO timestamp the book was added.             |

> The card includes further metadata fields (`rating`, `narrators`, `publisher`, `pageCount`,
> `isbn13`, `metadataScore`, `readStatus`, …); the table above lists the commonly used ones.

**Example:**

```json
{
  "items": [
    {
      "id": 456,
      "title": "Book Title",
      "subtitle": "Book Subtitle",
      "authors": ["Author Name"],
      "seriesId": 789,
      "seriesName": "Series Name",
      "seriesIndex": 1,
      "files": [{ "id": 1, "format": "epub", "role": "primary", "sizeBytes": 123456 }],
      "publishedYear": 2024,
      "language": "en",
      "genres": ["Genre"],
      "tags": ["tag"],
      "hasCover": true,
      "readingProgress": 0.25,
      "addedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 0,
  "size": 50
}
```

## Metadata lookup

These call external author-metadata providers (currently only `audnexus`). They do **not** read or
write library data; they surface provider candidates a client can apply to an author.

### `GET /api/v1/authors/metadata/providers`

**Purpose:** List the available external metadata providers.
**Auth:** Bearer JWT required.
**Returns:** `application/json` — an array of `AuthorMetadataProviderInfo`.

| Field          | Type    | Description                                                            |
| -------------- | ------- | ---------------------------------------------------------------------- |
| `key`          | string  | Provider key (e.g. `audnexus`).                                        |
| `label`        | string  | Human-readable provider name.                                          |
| `identifiable` | boolean | Whether the provider supports direct lookup by id (`metadata/lookup`). |

**Example:**

```json
[{ "key": "audnexus", "label": "Audnexus", "identifiable": true }]
```

### `GET /api/v1/authors/metadata/search`

**Purpose:** Search external providers for author-metadata candidates by name.
**Auth:** Bearer JWT required.
**Query params:**

| Param       | Type    | Required | Description                                               |
| ----------- | ------- | -------- | --------------------------------------------------------- |
| `q`         | string  | yes      | Author name to search for.                                |
| `region`    | string  | no       | Provider region hint (e.g. a locale/country code).        |
| `limit`     | integer | no       | Max candidates, `1`–`25`.                                 |
| `providers` | string  | no       | Comma-separated provider keys to query (defaults to all). |

**Returns:** `application/json` — an array of `AuthorMetadataCandidate`.

| Field         | Type                | Description                                        |
| ------------- | ------------------- | -------------------------------------------------- |
| `provider`    | string              | Provider key that produced the candidate.          |
| `providerId`  | string              | Provider-specific id (use with `metadata/lookup`). |
| `name`        | string              | Candidate author name.                             |
| `description` | string \| undefined | Candidate bio.                                     |
| `imageUrl`    | string \| undefined | Candidate image URL.                               |
| `sourceUrl`   | string \| undefined | Link to the provider page.                         |

**Example:**

```json
[
  {
    "provider": "audnexus",
    "providerId": "PROVIDER_ID",
    "name": "Author Name",
    "description": "Author bio text.",
    "imageUrl": "https://provider.example.com/image.jpg",
    "sourceUrl": "https://provider.example.com/author/PROVIDER_ID"
  }
]
```

### `GET /api/v1/authors/metadata/lookup`

**Purpose:** Fetch one author-metadata candidate directly by provider + provider id (for providers
where `identifiable` is `true`).
**Auth:** Bearer JWT required.
**Query params:**

| Param      | Type   | Required | Description                     |
| ---------- | ------ | -------- | ------------------------------- |
| `provider` | string | yes      | Provider key (e.g. `audnexus`). |
| `id`       | string | yes      | The provider-specific id.       |
| `region`   | string | no       | Provider region hint.           |

**Returns:** `application/json` — a single `AuthorMetadataCandidate` (same fields as
`metadata/search`), or `null` if nothing matched.

### `GET /api/v1/authors/metadata/stream`

**Purpose:** Same inputs as `metadata/search`, but streams candidates as they arrive from each
provider instead of waiting for all of them.
**Auth:** Bearer JWT required.
**Query params:** identical to `metadata/search` (`q` required; `region`, `limit`, `providers`
optional).
**Returns:** `text/event-stream` (Server-Sent Events). Each `data:` event is one
`AuthorMetadataCandidate` (see `metadata/search`). No batch JSON body.

## Enrichment status

Enrichment is the background process that fills author bios/images from providers. These read-only
routes require the `ManageMetadataConfig` permission.

### `GET /api/v1/authors/enrichment/config`

**Purpose:** Current auto-enrichment configuration.
**Auth:** Bearer JWT + `ManageMetadataConfig` permission.
**Returns:** `application/json` — `AuthorAutoEnrichmentConfig`.

| Field             | Type    | Description                                                   |
| ----------------- | ------- | ------------------------------------------------------------- |
| `enabled`         | boolean | Whether auto-enrichment runs.                                 |
| `triggerOnImport` | boolean | Whether importing a book schedules enrichment.                |
| `writeMode`       | string  | `missing_only` or `always_refetch`.                           |
| `conditions`      | object  | `{ neverEnriched, missingBio, missingPhoto }` (all booleans). |

**Example:**

```json
{
  "enabled": true,
  "triggerOnImport": true,
  "writeMode": "missing_only",
  "conditions": { "neverEnriched": true, "missingBio": true, "missingPhoto": false }
}
```

### `GET /api/v1/authors/enrichment/failed`

**Purpose:** Paginated list of authors whose enrichment failed.
**Auth:** Bearer JWT + `ManageMetadataConfig` permission.
**Query params:** `page` (integer, default `1` — **one-based here**), `limit` (integer, default
`50`, capped at `100`).
**Returns:** `application/json` — `{ items: AuthorEnrichmentFailedItem[], total, page, limit }`.

| Field        | Type           | Description                                             |
| ------------ | -------------- | ------------------------------------------------------- |
| `authorId`   | number         | The author that failed enrichment.                      |
| `name`       | string \| null | Author name at time of failure.                         |
| `error`      | string \| null | Failure message.                                        |
| `httpStatus` | number \| null | Provider HTTP status, if the failure was an HTTP error. |
| `failedAt`   | string         | ISO timestamp of the failure.                           |

**Example:**

```json
{
  "items": [
    {
      "authorId": 123,
      "name": "Author Name",
      "error": "Provider request failed",
      "httpStatus": 503,
      "failedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

## Images (binary)

### `GET /api/v1/authors/{id}/image`

**Purpose:** The full-size author image.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the author id.
**Returns:** binary image (content type per stored file, e.g. `image/jpeg`), with `ETag` and
`Cache-Control: no-cache`. Responds `404` if the author has no image.

### `GET /api/v1/authors/{id}/thumbnail`

**Purpose:** The smaller author thumbnail (as referenced by `imageUrl` in list responses).
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the author id.
**Returns:** `image/jpeg`, with `ETag` and `Cache-Control: no-cache`. Responds `404` if the author
has no thumbnail.
