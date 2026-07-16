# Books

The core of the library API: finding books, reading a single book's full metadata, its
reading state (progress, annotations, bookmarks, sessions), content-based recommendations, and
the binary routes that stream covers and the book files themselves. Unless noted, every
endpoint requires a Bearer JWT and is served by `BookController` (`@Controller('books')`); the
per-book sub-resources (`annotations`, `bookmarks`, `sessions`) live on their own controllers
mounted under the same `books/...` prefix. Results are visibility-scoped to the caller — a book
you cannot access returns `404`.

---

## Search & list

### `GET /api/v1/books/search`

**Purpose:** Keyword search across every library the caller can see, matching book title,
series name, and author name. This is the entry point the MCP uses to resolve a title to a
`bookId`.
**Auth:** Bearer JWT required.
**Query params:**

| Param   | Type    | Description                                                                                                                  |
| ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `q`     | string  | **Required.** Search term, 1–500 chars. Matched (accent-insensitive, substring) against title, series name, and author name. |
| `limit` | integer | Optional. Max results, 1–20. Default `10`.                                                                                   |

**Returns:** `application/json` — a bare array of `BookSearchResult`, ordered by title.

| Field         | Type           | Description                                                |
| ------------- | -------------- | ---------------------------------------------------------- |
| `id`          | number         | Book id.                                                   |
| `title`       | string \| null | Book title.                                                |
| `seriesName`  | string \| null | Series name, or null.                                      |
| `authors`     | string[]       | Author display names, in author display order.             |
| `libraryId`   | number         | Owning library id.                                         |
| `libraryName` | string         | Owning library name.                                       |
| `updatedAt`   | string \| null | ISO 8601 timestamp of the book's last update.              |
| `formats`     | string[]       | Distinct supported file formats present (e.g. `["epub"]`). |

**Example:**

```json
[
  {
    "id": 123,
    "title": "Book Title",
    "seriesName": "Series Name",
    "authors": ["Author Name"],
    "libraryId": 1,
    "libraryName": "Library Name",
    "updatedAt": "2024-01-01T00:00:00Z",
    "formats": ["epub"]
  }
]
```

---

## Single book

### `GET /api/v1/books/{id}`

**Purpose:** The complete metadata record for one book — everything the detail page shows:
bibliographic fields, authors, genres/tags, series memberships, ratings, attached files, and
per-user read status.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — a single `BookDetailDto` object. Selected fields (the record
is large; only the commonly used fields are listed):

| Field                                     | Type                                | Description                                                       |
| ----------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `id`                                      | number                              | Book id.                                                          |
| `libraryId` / `libraryName`               | number / string                     | Owning library.                                                   |
| `status`                                  | string                              | Processing status (e.g. `"ready"`).                               |
| `folderPath`                              | string                              | On-disk folder for the book.                                      |
| `addedAt`                                 | string                              | ISO 8601 timestamp the book was added.                            |
| `updatedAt`                               | string \| null                      | ISO 8601 timestamp of last update.                                |
| `title`                                   | string \| null                      | Title.                                                            |
| `subtitle`                                | string \| null                      | Subtitle.                                                         |
| `description`                             | string \| null                      | Description / blurb.                                              |
| `isbn10` / `isbn13`                       | string \| null                      | ISBNs.                                                            |
| `publisher`                               | string \| null                      | Publisher name.                                                   |
| `publishedDate`                           | string \| null                      | Publication date string as stored.                                |
| `publishedYear`                           | number \| null                      | Publication year.                                                 |
| `language`                                | string \| null                      | BCP-47 / ISO language code.                                       |
| `pageCount`                               | number \| null                      | Page count.                                                       |
| `seriesId` / `seriesName` / `seriesIndex` | number/string/number \| null        | Primary series membership.                                        |
| `seriesMemberships`                       | object[]                            | All series this book belongs to.                                  |
| `rating`                                  | number \| null                      | The user's own rating.                                            |
| `personalNote`                            | string \| null                      | The user's private note.                                          |
| `personalNoteUpdatedAt`                   | string \| null                      | When the note was last edited.                                    |
| `communityRatings`                        | object[]                            | Ratings sourced from external providers.                          |
| `coverSource`                             | `"extracted"` \| `"custom"` \| null | Where the cover came from, or null if none.                       |
| `providerIds`                             | object                              | External provider ids (Google Books, Goodreads, …).               |
| `authors`                                 | object[]                            | `{ id, name, sortName }` per author.                              |
| `genres`                                  | string[]                            | Genre names.                                                      |
| `tags`                                    | string[]                            | Tag names.                                                        |
| `files`                                   | object[]                            | Attached files — see below.                                       |
| `readStatus`                              | object \| null                      | Per-user read status (`unread`/`reading`/`finished`, timestamps). |
| `audioMetadata`                           | object \| null                      | Narrators, duration, chapters — present for audiobooks.           |
| `comicMetadata`                           | object \| null                      | Comic-specific fields — present for CBZ/CBR/CB7.                  |
| `collections`                             | object[]                            | `{ id, name }` collections containing this book.                  |
| `lockedFields`                            | string[]                            | Metadata fields locked against auto-refresh.                      |

Each entry of `files` (`BookFileDto`):

| Field             | Type           | Description                                                         |
| ----------------- | -------------- | ------------------------------------------------------------------- |
| `id`              | number         | File id (globally unique; used by the `files/{fileId}/...` routes). |
| `format`          | string \| null | e.g. `"epub"`, `"pdf"`, `"m4b"`.                                    |
| `role`            | string         | e.g. `"primary"`.                                                   |
| `sizeBytes`       | number \| null | File size in bytes.                                                 |
| `absolutePath`    | string         | Server-side path.                                                   |
| `createdAt`       | string         | ISO 8601 timestamp.                                                 |
| `filename`        | string \| null | Original filename.                                                  |
| `durationSeconds` | number \| null | Audio duration, for audiobook files.                                |

**Example:**

```json
{
  "id": 123,
  "libraryId": 1,
  "libraryName": "Library Name",
  "status": "ready",
  "title": "Book Title",
  "subtitle": "Book Subtitle",
  "authors": [{ "id": 456, "name": "Author Name", "sortName": "Name, Author" }],
  "seriesName": "Series Name",
  "seriesIndex": 1,
  "publisher": "Publisher Name",
  "publishedYear": 2024,
  "language": "en",
  "genres": ["Genre"],
  "tags": ["tag"],
  "coverSource": "extracted",
  "files": [
    {
      "id": 789,
      "format": "epub",
      "role": "primary",
      "sizeBytes": 1048576,
      "absolutePath": "/data/library/book.epub",
      "createdAt": "2024-01-01T00:00:00Z",
      "filename": "book.epub",
      "durationSeconds": null
    }
  ],
  "addedAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

---

### `GET /api/v1/books/{id}/progress`

**Purpose:** The caller's reading progress for a book, **one entry per file** that has progress
(a book with both an EPUB and an audiobook can have two).
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — an array of progress objects (empty if no progress recorded).

| Field                              | Type           | Description                                  |
| ---------------------------------- | -------------- | -------------------------------------------- |
| `fileId`                           | number         | The file this progress row is for.           |
| `cfi`                              | string \| null | EPUB CFI locator, or null.                   |
| `pageNumber`                       | number \| null | Page number, when known.                     |
| `percentage`                       | number         | Progress percent `0`–`100` (`0` when unset). |
| `koboLocationSource`               | string \| null | Kobo sync bookkeeping.                       |
| `koboLocationType`                 | string \| null | Kobo sync bookkeeping.                       |
| `koboLocationValue`                | string \| null | Kobo sync bookkeeping.                       |
| `koboContentSourceProgressPercent` | number \| null | Kobo-reported progress percent.              |
| `koreaderProgress`                 | string \| null | KOReader locator string, or null.            |
| `updatedAt`                        | string \| null | ISO 8601 timestamp of last update.           |

**Example:**

```json
[
  {
    "fileId": 789,
    "cfi": "epubcfi(/6/4!/4/2)",
    "pageNumber": 42,
    "percentage": 37,
    "koboLocationSource": null,
    "koboLocationType": null,
    "koboLocationValue": null,
    "koboContentSourceProgressPercent": null,
    "koreaderProgress": null,
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

---

### `GET /api/v1/books/{id}/audio-progress`

**Purpose:** The caller's audiobook playback position for a book (single row, spanning the
book's audio files).
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — a single `AudiobookProgress` object, or `null` if none.

| Field             | Type   | Description                                |
| ----------------- | ------ | ------------------------------------------ |
| `userId`          | number | The owning user.                           |
| `bookId`          | number | The book.                                  |
| `currentFileId`   | number | The audio file currently being played.     |
| `positionSeconds` | number | Offset within `currentFileId`, in seconds. |
| `percentage`      | number | Overall progress percent `0`–`100`.        |
| `updatedAt`       | string | ISO 8601 timestamp of last update.         |

**Example:**

```json
{
  "userId": 1,
  "bookId": 123,
  "currentFileId": 789,
  "positionSeconds": 1234.5,
  "percentage": 42,
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

---

### `GET /api/v1/books/{bookId}/annotations`

**Purpose:** The caller's highlights and notes on a book. Two response modes: pass no `page`
param to get a plain array; pass `page` to get a paginated, filterable envelope with aggregate
stats (the shape the annotations UI uses).
**Auth:** Bearer JWT required.
**Path params:** `bookId` (integer) — the book id.
**Query params (paginated mode only — supplying any of these without `page` still returns the
array unless `page` is present):**

| Param                 | Type     | Description                                                             |
| --------------------- | -------- | ----------------------------------------------------------------------- |
| `page`                | integer  | Page number, ≥1. **Presence of this param switches to paginated mode.** |
| `pageSize`            | integer  | Page size, 1–100. Default `25`.                                         |
| `sortBy`              | enum     | `position` or `createdAt`.                                              |
| `sortDir`             | enum     | `asc` or `desc`.                                                        |
| `colors`              | string   | Filter by highlight color(s).                                           |
| `search`              | string   | Free-text filter over highlighted text / note (≤200 chars).             |
| `chapter`             | string   | Filter to a chapter title (≤500 chars).                                 |
| `dateFrom` / `dateTo` | ISO date | Restrict to a creation-date range.                                      |

**Returns:** `application/json`.

Without `page` — a bare array of `AnnotationResponseDto`:

| Field            | Type           | Description                                                                                           |
| ---------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `id`             | number         | Annotation id.                                                                                        |
| `bookId`         | number         | The book.                                                                                             |
| `cfi`            | string \| null | EPUB CFI locator for the highlight, or null.                                                          |
| `jumpFileId`     | number \| null | File the annotation points into, if resolved.                                                         |
| `pageno`         | number \| null | Page number, when known.                                                                              |
| `text`           | string         | The highlighted passage.                                                                              |
| `color`          | string         | Highlight color.                                                                                      |
| `style`          | string         | Highlight style (e.g. `"highlight"`).                                                                 |
| `note`           | string \| null | The user's comment; null for a plain highlight.                                                       |
| `chapterTitle`   | string \| null | BookOrbit's own chapter title (its reader model's numbering — **not** the EPUB-reader section index). |
| `chapterIndex`   | number \| null | BookOrbit's own chapter index (same caveat).                                                          |
| `origin`         | string         | Where it came from (e.g. `"web"`, `"koreader"`, `"kobo"`).                                            |
| `positionStatus` | string \| null | Locator resolution status (e.g. `"exact"`), or null.                                                  |
| `createdAt`      | string         | ISO 8601 timestamp.                                                                                   |

With `page` — an envelope: `{ items, total, page, pageSize, stats }`, where `items` are the
same annotation objects (timestamps as ISO strings) and `stats` carries aggregate counts plus a
`chapters` list of the book's distinct annotated chapters.

**Example (array mode):**

```json
[
  {
    "id": 123,
    "bookId": 456,
    "cfi": "epubcfi(/6/4!/4/2)",
    "jumpFileId": 789,
    "pageno": 42,
    "text": "A highlighted passage.",
    "color": "yellow",
    "style": "highlight",
    "note": "A reader note.",
    "chapterTitle": "Chapter One",
    "chapterIndex": 0,
    "origin": "web",
    "positionStatus": "exact",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

---

### `GET /api/v1/books/{bookId}/bookmarks`

**Purpose:** The caller's bookmarks (saved locations) in a book.
**Auth:** Bearer JWT required.
**Path params:** `bookId` (integer) — the book id.
**Returns:** `application/json` — a bare array of `BookmarkResponseDto`.

| Field             | Type           | Description                                                  |
| ----------------- | -------------- | ------------------------------------------------------------ |
| `id`              | number         | Bookmark id.                                                 |
| `bookId`          | number         | The book.                                                    |
| `cfi`             | string \| null | EPUB CFI locator; null for audio bookmarks.                  |
| `title`           | string         | Bookmark label.                                              |
| `positionSeconds` | number \| null | Absolute audio position in seconds; null for EPUB bookmarks. |
| `createdAt`       | string         | ISO 8601 timestamp.                                          |

**Example:**

```json
[
  {
    "id": 123,
    "bookId": 456,
    "cfi": "epubcfi(/6/4!/4/2)",
    "title": "Bookmark Title",
    "positionSeconds": null,
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

---

### `GET /api/v1/books/{bookId}/sessions`

**Purpose:** The caller's reading-session history for a book, plus aggregate stats — a paginated
list of individual reading sessions.
**Auth:** Bearer JWT required.
**Path params:** `bookId` (integer) — the book id.
**Query params:**

| Param                 | Type     | Description                                                                  |
| --------------------- | -------- | ---------------------------------------------------------------------------- |
| `page`                | integer  | Page number, ≥1. Default `1`.                                                |
| `pageSize`            | integer  | Page size, 1–100. Default `25`.                                              |
| `sortBy`              | enum     | `startedAt` (default), `durationSeconds`, `progressDelta`, or `endProgress`. |
| `sortDir`             | enum     | `asc` or `desc` (default `desc`).                                            |
| `dateFrom` / `dateTo` | ISO date | Restrict to a date range.                                                    |
| `format`              | string   | Restrict to sessions on a given file format.                                 |

**Returns:** `application/json` — a `BookReadingSessionListResponse` envelope:
`{ items, total, page, pageSize, stats }`.

Each `items` entry (`BookReadingSession`):

| Field             | Type           | Description                                 |
| ----------------- | -------------- | ------------------------------------------- |
| `id`              | number         | Session id.                                 |
| `startedAt`       | string         | ISO 8601 start time.                        |
| `endedAt`         | string         | ISO 8601 end time.                          |
| `durationSeconds` | number         | Active reading time in seconds.             |
| `progressDelta`   | number \| null | Progress percent gained during the session. |
| `endProgress`     | number \| null | Progress percent at session end.            |
| `format`          | string \| null | File format read.                           |
| `source`          | string \| null | `"web"`, `"koreader"`, `"manual"`, etc.     |

`stats` (`BookReadingSessionStats`): `totalSessions`, `totalSeconds`, `avgDurationSeconds`,
`firstSessionAt`, `lastSessionAt`, `dailySummary` (`{ day, totalMinutes }[]`),
`paceProgressDelta`, `paceDurationSeconds`, `progressSummary` (`{ day, endProgress }[]`), and
`bySource` (per-source time/session slices).

**Example:**

```json
{
  "items": [
    {
      "id": 123,
      "startedAt": "2024-01-01T00:00:00Z",
      "endedAt": "2024-01-01T00:30:00Z",
      "durationSeconds": 1800,
      "progressDelta": 5,
      "endProgress": 42,
      "format": "epub",
      "source": "web"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 25,
  "stats": {
    "totalSessions": 1,
    "totalSeconds": 1800,
    "avgDurationSeconds": 1800,
    "firstSessionAt": "2024-01-01T00:00:00Z",
    "lastSessionAt": "2024-01-01T00:00:00Z",
    "dailySummary": [{ "day": "2024-01-01", "totalMinutes": 30 }],
    "paceProgressDelta": 5,
    "paceDurationSeconds": 1800,
    "progressSummary": [{ "day": "2024-01-01", "endProgress": 42 }],
    "bySource": [{ "bucket": "app", "totalSeconds": 1800, "totalSessions": 1 }]
  }
}
```

---

### `GET /api/v1/books/files/{fileId}/progress`

**Purpose:** The caller's progress for a single file (keyed by `fileId`, not `bookId`). Always
returns an object — a zeroed default when no progress is stored.
**Auth:** Bearer JWT required.
**Path params:** `fileId` (integer) — the file id.
**Returns:** `application/json` — a single progress object. When no progress exists, the default
below is returned; when it exists, the stored row is returned (same locator fields plus
persistence bookkeeping such as `updatedAt`).

| Field                              | Type           | Description                            |
| ---------------------------------- | -------------- | -------------------------------------- |
| `cfi`                              | string \| null | EPUB CFI locator, or null.             |
| `pageNumber`                       | number \| null | Page number, when known.               |
| `percentage`                       | number         | Progress percent (`0` in the default). |
| `koboLocationSource`               | string \| null | Kobo sync bookkeeping.                 |
| `koboLocationType`                 | string \| null | Kobo sync bookkeeping.                 |
| `koboLocationValue`                | string \| null | Kobo sync bookkeeping.                 |
| `koboContentSourceProgressPercent` | number \| null | Kobo-reported progress percent.        |
| `koreaderProgress`                 | string \| null | KOReader locator string, or null.      |

**Example:**

```json
{
  "cfi": null,
  "pageNumber": null,
  "percentage": 0,
  "koboLocationSource": null,
  "koboLocationType": null,
  "koboLocationValue": null,
  "koboContentSourceProgressPercent": null,
  "koreaderProgress": null
}
```

---

### `GET /api/v1/books/{id}/metadata-from-file`

**Purpose:** Parse the book's **primary file on disk** and return the metadata embedded in it
(as opposed to the library's stored metadata). Used to preview what a metadata write-back would
pull from the file.
**Auth:** Bearer JWT required. **Requires the `LibraryEditMetadata` permission.**
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — a loose object whose keys depend on the file format (EPUB, PDF,
MOBI/AZW3/AZW, CBZ/CBR/CB7). Returns `{}` when the book has no format or no parseable metadata.
Typical keys: `title`, `subtitle`, `description`, `publisher`, `publishedDate`,
`publishedYear`, `language`, `pageCount`, `isbn10`, `isbn13`, `seriesName`, `seriesIndex`,
external provider ids (`googleBooksId`, `goodreadsId`, `amazonId`, `hardcoverId`, …), `authors`
(string[]), and `genres` (string[]). Fields absent in the file are omitted.

**Example:**

```json
{
  "title": "Book Title",
  "subtitle": "Book Subtitle",
  "description": "A description.",
  "publisher": "Publisher Name",
  "publishedYear": 2024,
  "language": "en",
  "seriesName": "Series Name",
  "seriesIndex": 1,
  "authors": ["Author Name"],
  "genres": ["Genre"]
}
```

---

### `GET /api/v1/books/{id}/kobo-state`

**Purpose:** The Kobo-sync view of a book for the caller: whether it is eligible for Kobo sync,
which sync collections include it, the current Kobo reading state, and per-device sync
snapshots.
**Auth:** Bearer JWT required. **Requires the `KoboSync` permission** — without it the endpoint
returns a disabled shape (`eligibleForKoboSync: false`, empty `syncCollections`/`snapshots`,
`readingState: null`).
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — a `BookKoboState` object.

| Field                 | Type           | Description                                               |
| --------------------- | -------------- | --------------------------------------------------------- |
| `eligibleForKoboSync` | boolean        | Whether the book is in at least one Kobo sync collection. |
| `syncCollections`     | string[]       | Names of the sync collections containing the book.        |
| `readingState`        | object \| null | Current Kobo reading state, or null.                      |
| `snapshots`           | object[]       | Per-device sync snapshot rows.                            |

`readingState` (when present): `status` (string \| null), `progressPercent` (number `0`–`100`
\| null), `createdAtKobo`, `lastModifiedKobo`, `priorityTimestamp`, `updatedAt` (ISO string).
Each `snapshots` entry: `deviceId`, `deviceName`, `snapshotId`, `snapshotUpdatedAt`,
`inSnapshot`, `synced`, `pendingDelete`, `isNew`, `removedByDevice`, `fileHash`, `metadataHash`.

**Example:**

```json
{
  "eligibleForKoboSync": true,
  "syncCollections": ["Collection Name"],
  "readingState": {
    "status": "Reading",
    "progressPercent": 42,
    "createdAtKobo": "2024-01-01T00:00:00Z",
    "lastModifiedKobo": "2024-01-01T00:00:00Z",
    "priorityTimestamp": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  },
  "snapshots": []
}
```

---

### `GET /api/v1/books/{id}/write-log`

**Purpose:** History of metadata write-backs to the book's file(s) — what was written, when, by
whom, and whether it succeeded.
**Auth:** Bearer JWT required. **Requires the `LibraryEditMetadata` permission.**
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — `{ "entries": WriteLogEntry[] }` (most recent first, capped at
20).

Each `entries` element (`WriteLogEntry`):

| Field           | Type           | Description                             |
| --------------- | -------------- | --------------------------------------- |
| `id`            | number         | Log entry id.                           |
| `format`        | string         | File format written (e.g. `"epub"`).    |
| `status`        | string         | Outcome (e.g. `"success"`, `"failed"`). |
| `fieldsWritten` | string[]       | Names of the metadata fields written.   |
| `triggeredBy`   | string         | What triggered the write.               |
| `writtenAt`     | string         | ISO 8601 timestamp.                     |
| `durationMs`    | number \| null | Write duration in milliseconds.         |
| `errorMessage`  | string \| null | Failure message, or null on success.    |

**Example:**

```json
{
  "entries": [
    {
      "id": 123,
      "format": "epub",
      "status": "success",
      "fieldsWritten": ["title", "authors"],
      "triggeredBy": "manual",
      "writtenAt": "2024-01-01T00:00:00Z",
      "durationMs": 120,
      "errorMessage": null
    }
  ]
}
```

---

## Recommendations

These three routes (served by `RecommendationController`) suggest other books related to a given
book. All return a **bare array** of light-weight related-book objects and are visibility-scoped
to the caller's accessible libraries. Each may return `[]` (e.g. no embedding, no series, or no
other books by the author).

### `GET /api/v1/books/{id}/recommendations`

**Purpose:** Content-similar books, ranked by a blend of embedding similarity, shared
authors/genres/tags, series membership, and rating proximity (top 25).
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — an array of `BookRecommendation`.

| Field         | Type           | Description                            |
| ------------- | -------------- | -------------------------------------- |
| `id`          | number         | Recommended book id.                   |
| `title`       | string \| null | Title.                                 |
| `updatedAt`   | string \| null | ISO 8601 timestamp, or null.           |
| `hasCover`    | boolean        | Whether the book has a cover.          |
| `authors`     | string[]       | Author display names.                  |
| `isAudiobook` | boolean        | Present when the book is an audiobook. |
| `isComic`     | boolean        | Present when the book is a comic.      |

**Example:**

```json
[
  {
    "id": 123,
    "title": "Book Title",
    "updatedAt": "2024-01-01T00:00:00Z",
    "hasCover": true,
    "authors": ["Author Name"],
    "isAudiobook": false,
    "isComic": false
  }
]
```

### `GET /api/v1/books/{id}/series-books`

**Purpose:** Other books in the same series as the given book.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — an array of `SeriesBookRecommendation` (same as
`BookRecommendation` plus `seriesIndex`).

| Field         | Type           | Description                            |
| ------------- | -------------- | -------------------------------------- |
| `id`          | number         | Book id.                               |
| `title`       | string \| null | Title.                                 |
| `updatedAt`   | string \| null | ISO 8601 timestamp, or null.           |
| `seriesIndex` | number \| null | Position within the series.            |
| `hasCover`    | boolean        | Whether the book has a cover.          |
| `authors`     | string[]       | Author display names.                  |
| `isAudiobook` | boolean        | Present when the book is an audiobook. |
| `isComic`     | boolean        | Present when the book is a comic.      |

**Example:**

```json
[
  {
    "id": 123,
    "title": "Book Title",
    "updatedAt": "2024-01-01T00:00:00Z",
    "seriesIndex": 2,
    "hasCover": true,
    "authors": ["Author Name"],
    "isAudiobook": false,
    "isComic": false
  }
]
```

### `GET /api/v1/books/{id}/author-books`

**Purpose:** Other books by the same author(s) as the given book.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Returns:** `application/json` — an array of `BookRecommendation` (same shape as
`/recommendations`).

**Example:**

```json
[
  {
    "id": 123,
    "title": "Book Title",
    "updatedAt": "2024-01-01T00:00:00Z",
    "hasCover": true,
    "authors": ["Author Name"],
    "isAudiobook": false,
    "isComic": false
  }
]
```

---

## Binary & streaming

These endpoints return raw bytes (or, for cover search, a small JSON list) rather than a book
JSON payload. Covers/thumbnails support conditional requests (`ETag` + `If-None-Match` → `304`)
and file serving supports HTTP `Range`.

### `GET /api/v1/books/{id}/cover`

**Purpose:** The book's full-size cover image.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Query params:** `t` (string, optional) — a cache-busting token; when present the response is
served `immutable` for a year, otherwise `private, max-age=86400`.
**Returns:** the cover image bytes. Content type is derived from the file (e.g. `image/jpeg`,
`image/png`). Sends `ETag`; honors `If-None-Match` with a `304`. `404` if the book has no cover.

### `GET /api/v1/books/{id}/thumbnail`

**Purpose:** A small thumbnail of the book's cover.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the book id.
**Query params:** `t` (string, optional) — cache-busting token (same semantics as `/cover`).
**Returns:** JPEG thumbnail bytes (`image/jpeg`). Sends `ETag`; honors `If-None-Match` with a
`304`. `404` if the book has no thumbnail.

### `GET /api/v1/books/files/{fileId}/serve`

**Purpose:** Stream a book file for **in-browser** consumption (the reader loads the EPUB/PDF/
audio this way). Keyed by `fileId` (globally unique).
**Auth:** Bearer JWT required.
**Path params:** `fileId` (integer) — the file id.
**Returns:** the file bytes with a format-appropriate content type (e.g.
`application/epub+zip`, `application/pdf`, `audio/mp4`, `application/vnd.comicbook+zip`), served
`inline` with `Accept-Ranges: bytes`. Honors the `Range` request header (returns `206 Partial
Content`, or `416` for an unsatisfiable range).

### `GET /api/v1/books/files/{fileId}/download`

**Purpose:** Download a book file as an **attachment** (saved to disk, with a resolved
filename).
**Auth:** Bearer JWT required. **Requires the `LibraryDownload` permission.**
**Path params:** `fileId` (integer) — the file id.
**Returns:** the file bytes with a format-appropriate content type, served as
`Content-Disposition: attachment` with `Accept-Ranges: bytes` and `Content-Length`.

### `GET /api/v1/books/export/download`

**Purpose:** Download multiple books at once as a single ZIP archive.
**Auth:** Bearer JWT required. **Requires the `LibraryDownload` permission** (and is blocked for
demo-restricted accounts).
**Query params:**

| Param     | Type   | Description                                                                                                    |
| --------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `bookIds` | string | **Required.** Comma-separated list of positive integer book ids (e.g. `?bookIds=1,2,3`).                       |
| `scope`   | enum   | Optional. `primary` (default — one primary file per book), `all` (all formats), or `audio` (audio files only). |

**Returns:** `application/zip` — a streamed ZIP archive containing the selected files
(`Content-Disposition: attachment`, filename `books.zip`). Aborts cleanly if the client
disconnects.

### `GET /api/v1/books/cover/search`

**Purpose:** Search external providers for candidate cover images (used when replacing a book's
cover). Unlike the other routes in this section, this returns **JSON**, not image bytes.
**Auth:** Bearer JWT required. **Requires the `LibraryEditMetadata` permission.**
**Query params:**

| Param         | Type    | Description                                                                                                 |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `title`       | string  | **Required.** Title to search for (trimmed, non-empty).                                                     |
| `author`      | string  | Optional. Author to refine the search.                                                                      |
| `isAudiobook` | boolean | Optional. Bias toward audiobook cover art.                                                                  |
| `provider`    | enum    | Optional. `duckduckgo`, `itunes`, `audiobookcovers`, or `all`. Defaults to the configured default provider. |

**Returns:** `application/json` — a bare array of `CoverSearchResult`.

| Field        | Type             | Description                                                         |
| ------------ | ---------------- | ------------------------------------------------------------------- |
| `url`        | number \| string | Either a direct image URL or a numeric id to feed to `cover/proxy`. |
| `previewUrl` | string           | URL for a small preview of the candidate.                           |
| `sourceUrl`  | string           | The provider's source page / origin URL.                            |
| `width`      | number           | Image width in pixels.                                              |
| `height`     | number           | Image height in pixels.                                             |
| `source`     | string           | Provider name that returned the candidate.                          |

**Example:**

```json
[
  {
    "url": "https://images.example.com/cover.jpg",
    "previewUrl": "https://images.example.com/cover-preview.jpg",
    "sourceUrl": "https://provider.example.com/item/123",
    "width": 400,
    "height": 600,
    "source": "duckduckgo"
  }
]
```

### `GET /api/v1/books/cover/proxy`

**Purpose:** Proxy (fetch and re-serve) a remote cover image through the server — used to render
candidates from `cover/search` without the browser hitting the third-party host directly.
**Auth:** Bearer JWT required. **Requires the `LibraryEditMetadata` permission.**
**Query params:**

| Param | Type   | Description                                                                         |
| ----- | ------ | ----------------------------------------------------------------------------------- |
| `url` | string | **Required.** The remote image URL (http/https, ≤2048 chars) to fetch and re-serve. |

**Returns:** the fetched image bytes, with the upstream image's content type. Responds `400` if
the URL is invalid or the image cannot be fetched.
