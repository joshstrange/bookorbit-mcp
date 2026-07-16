# Annotations hub

The **annotations hub** is the _cross-library_ view of the user's highlights and notes: one
paginated, filterable list spanning every book, plus per-book counts, an export, and per-item
sync diagnostics. It lives under `/api/v1/annotations`.

This is distinct from the **per-book** annotations endpoint (`GET /books/{bookId}/annotations`,
documented in [books.md](books.md)), which returns one book's raw annotation rows. The hub adds
book title/author, deletion state, aggregate stats, and rich filtering across the whole library.

> **Chapter numbers are the reader's, not the MCP's.** Each annotation carries BookOrbit's own
> `chapterTitle`/`chapterIndex` from its reader model. These are **not** the section indices the
> MCP's `list_chapters`/`get_chapter` tools use — don't conflate them; match on `chapterTitle`
> if you need surrounding text.

All endpoints require a **Bearer JWT** and are read-only. (The controller also hosts write
routes — bulk trash/restyle, restore, purge, position retry — which are out of scope here.)

**Pagination shape.** The hub list uses `page`/`pageSize` (not `page`/`size`) and returns a
`stats` block alongside `items`/`total` — the [`AnnotationHubPage`](../../src/types.ts) envelope.

---

### `GET /api/v1/annotations`

**Purpose:** Paginated, filterable list of the user's annotations across all books. The primary
"show me my highlights/notes" call.
**Auth:** Bearer JWT required.
**Query params:**

| Param      | Type                  | Default     | Description                                         |
| ---------- | --------------------- | ----------- | --------------------------------------------------- |
| `page`     | int ≥ 1               | `1`         | Page number                                         |
| `pageSize` | int 1–100             | `25`        | Items per page                                      |
| `bookId`   | int ≥ 1               | —           | Restrict to one book                                |
| `search`   | string (≤200)         | —           | Full-text over highlight text / note                |
| `chapter`  | string (≤500)         | —           | Filter by chapter title                             |
| `colors`   | string (≤300)         | —           | Comma-separated hex colors                          |
| `styles`   | string (≤100)         | —           | Comma-separated styles (e.g. `highlight`)           |
| `origins`  | string (≤60)          | —           | Comma-separated origins (`web`, `koreader`, `kobo`) |
| `dateFrom` | ISO-8601              | —           | Only annotations created on/after                   |
| `dateTo`   | ISO-8601              | —           | Only annotations created on/before                  |
| `hasNote`  | boolean               | —           | When `true`, only annotations that carry a note     |
| `status`   | `active` \| `trashed` | `active`    | Live vs trashed annotations                         |
| `sortBy`   | `createdAt` \| `book` | `createdAt` | Sort key                                            |
| `sortDir`  | `asc` \| `desc`       | `desc`      | Sort direction                                      |

**Returns:** `application/json` — an [`AnnotationHubPage`](../../src/types.ts).

| Field      | Type   | Description                                                                                                                       |
| ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `items`    | array  | Hub annotations (see below)                                                                                                       |
| `total`    | number | Total matching the filters                                                                                                        |
| `page`     | number | Echoed page                                                                                                                       |
| `pageSize` | number | Echoed page size                                                                                                                  |
| `stats`    | object | `{ books, withNotes, originBreakdown: [{ origin, count }] }` — aggregates over the filtered set; origins with 0 count are omitted |

Each **item** (a [`HubAnnotation`](../../src/types.ts)):

| Field            | Type           | Description                                      |
| ---------------- | -------------- | ------------------------------------------------ |
| `id`             | number         | Annotation id                                    |
| `bookId`         | number         | Book id                                          |
| `bookTitle`      | string \| null | Book title                                       |
| `author`         | string \| null | Book author                                      |
| `text`           | string         | The highlighted passage                          |
| `note`           | string \| null | The user's comment; `null` for a plain highlight |
| `color`          | string \| null | Highlight color                                  |
| `style`          | string \| null | e.g. `highlight`                                 |
| `cfi`            | string \| null | EPUB CFI location                                |
| `chapterTitle`   | string \| null | Reader's chapter name (not an MCP section)       |
| `chapterIndex`   | number \| null | Reader's chapter index (not an MCP section)      |
| `positionStatus` | string \| null | Position resolution status (e.g. `exact`)        |
| `origin`         | string \| null | Source: `web` / `koreader` / `kobo`              |
| `jumpFileId`     | number \| null | File the annotation points into                  |
| `jumpFileFormat` | string \| null | That file's format                               |
| `pageno`         | number \| null | Page number, when known                          |
| `createdAt`      | string         | ISO-8601 creation time                           |
| `deletedAt`      | string \| null | ISO-8601 trash time; `null` when active          |

**Example:**

```json
{
  "items": [
    {
      "id": 123,
      "bookId": 456,
      "bookTitle": "Book Title",
      "author": "Author Name",
      "text": "A highlighted passage.",
      "note": "My note about it.",
      "color": "#ffd54f",
      "style": "highlight",
      "cfi": "epubcfi(/6/4!/4/2)",
      "chapterTitle": "Chapter One",
      "chapterIndex": 1,
      "positionStatus": "exact",
      "origin": "web",
      "jumpFileId": 789,
      "jumpFileFormat": "epub",
      "pageno": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "deletedAt": null
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 25,
  "stats": {
    "books": 1,
    "withNotes": 1,
    "originBreakdown": [{ "origin": "web", "count": 1 }]
  }
}
```

### `GET /api/v1/annotations/books`

**Purpose:** Which books have annotations, and how many each — for a book-filter facet.
**Auth:** Bearer JWT required.
**Query params:**

| Param        | Type                  | Default  | Description                                                            |
| ------------ | --------------------- | -------- | ---------------------------------------------------------------------- |
| `status`     | `active` \| `trashed` | `active` | Which annotation set to count                                          |
| `q`          | string (≤200)         | —        | Typeahead over book title / author                                     |
| `limit`      | int 1–50              | `20`     | Max facets returned                                                    |
| `selectedId` | int ≥ 1               | —        | A book id always included in the result, even outside the limit/search |

**Returns:** `application/json` — an array of book facets (close to
[`AnnotatedBookSummary`](../../src/types.ts), but `bookTitle`/`author` may be `null`).

| Field       | Type           | Description                        |
| ----------- | -------------- | ---------------------------------- |
| `bookId`    | number         | Book id                            |
| `bookTitle` | string \| null | Book title                         |
| `author`    | string \| null | Book author                        |
| `count`     | number         | Number of annotations on this book |

**Example:**

```json
[{ "bookId": 456, "bookTitle": "Book Title", "author": "Author Name", "count": 12 }]
```

### `GET /api/v1/annotations/export`

**Purpose:** Export the user's annotations as a downloadable file. Accepts **all** the filter
params of `GET /annotations` (so the same subset can be exported), plus a `format`.
**Auth:** Bearer JWT required.
**Query params:** every param from `GET /annotations` above, **plus** `format` — one of `md`
(default), `csv`, `json`. (`bookId` also names the file, e.g. `book-456-…`.)
**Returns:** a **file download**, not a JSON API body. `Content-Type` depends on `format`:

| `format`       | `Content-Type`                    | Filename                               |
| -------------- | --------------------------------- | -------------------------------------- |
| `md` (default) | `text/markdown; charset=utf-8`    | `<scope>-annotations-<timestamp>.md`   |
| `csv`          | `text/csv; charset=utf-8`         | `<scope>-annotations-<timestamp>.csv`  |
| `json`         | `application/json; charset=utf-8` | `<scope>-annotations-<timestamp>.json` |

The response carries `Content-Disposition: attachment; filename="…"`. `<scope>` is `library` for
a whole-library export or `book-<bookId>` when `bookId` is set.

### `GET /api/v1/annotations/{annotationId}/sync-detail`

**Purpose:** Diagnostics for how one annotation's position has been resolved across formats and
synced to devices. Useful for debugging KOReader/Kobo sync.
**Auth:** Bearer JWT required.
**Path params:** `annotationId` (integer).
**Returns:** `application/json` — a sync-detail object. `404` if the annotation isn't the user's.

| Field          | Type   | Description                                                                      |
| -------------- | ------ | -------------------------------------------------------------------------------- |
| `annotationId` | number | The annotation id                                                                |
| `origin`       | string | Where the annotation originated (`web` / `koreader` / `kobo`)                    |
| `version`      | number | Current annotation version                                                       |
| `positions`    | array  | Per-format resolution: `{ format, status, reason, converterVersion, updatedAt }` |
| `devices`      | array  | Per-device sync state (see below)                                                |

Each **device**:

| Field                | Type           | Description                                        |
| -------------------- | -------------- | -------------------------------------------------- |
| `source`             | string         | Device source (e.g. `koreader`, `kobo`)            |
| `deviceId`           | string         | Device identifier                                  |
| `deviceName`         | string \| null | Friendly name (Kobo devices only)                  |
| `lastAppliedVersion` | number         | Annotation version the device last applied         |
| `upToDate`           | boolean        | Whether the device is current with this annotation |
| `deleteAckedAt`      | string \| null | ISO-8601 when the device acknowledged a deletion   |
| `lastSyncedAt`       | string         | ISO-8601 of the device's last sync                 |

**Example:**

```json
{
  "annotationId": 123,
  "origin": "web",
  "version": 3,
  "positions": [
    {
      "format": "cfi",
      "status": "exact",
      "reason": null,
      "converterVersion": 1,
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "devices": [
    {
      "source": "koreader",
      "deviceId": "device-1",
      "deviceName": null,
      "lastAppliedVersion": 3,
      "upToDate": true,
      "deleteAckedAt": null,
      "lastSyncedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

</content>
