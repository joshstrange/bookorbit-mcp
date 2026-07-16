# Libraries

A **library** in BookOrbit is a named, ordered collection of books backed by one or more
watched folders on disk. Every book belongs to exactly one library, and access is granted
per-user (viewer/editor). These endpoints let a client list the libraries the signed-in user can
see, inspect one, and read per-library statistics. A couple of admin-only management reads
(access lists, bulk-rename preview/status) are documented here for completeness.

All endpoints require a **Bearer JWT** (see [README](README.md#authentication)) and are
read-only. The write/streaming routes on this controller (create/update/delete, reorder,
prescan, access grants, metadata-write and bulk-rename _execute_ SSE streams) are out of scope.

---

### `GET /api/v1/libraries`

**Purpose:** List the libraries the signed-in user can access (superusers see all), each with
its folders. This is the primary "what libraries exist" call.
**Auth:** Bearer JWT required.
**Returns:** `application/json` — a bare array of library objects. Each library is the full
config row (many fields; only the commonly-used ones are typed as
[`Library`](../../src/types.ts)), with `organizationMode` normalized and a `folders` array
appended.

| Field              | Type    | Description                                                                   |
| ------------------ | ------- | ----------------------------------------------------------------------------- |
| `id`               | number  | Library id                                                                    |
| `name`             | string  | Display name                                                                  |
| `icon`             | string  | Library icon (emoji or icon token)                                            |
| `displayOrder`     | number  | Sort order in the UI                                                          |
| `organizationMode` | string  | `book_per_folder` or `book_per_file`                                          |
| `watch`            | boolean | Whether folders are watched for changes                                       |
| `folders`          | array   | `{ id, path, createdAt }` — the backing folders                               |
| …                  | …       | Many more config fields (format priority, file-write settings, thresholds, …) |

**Example:**

```json
[
  {
    "id": 123,
    "name": "Library Name",
    "icon": "📚",
    "displayOrder": 0,
    "organizationMode": "book_per_folder",
    "watch": true,
    "folders": [
      { "id": 1, "path": "/books/library-name", "createdAt": "2024-01-01T00:00:00Z" }
    ]
  }
]
```

### `GET /api/v1/libraries/{id}`

**Purpose:** Fetch one library with its folders.
**Auth:** Bearer JWT; caller needs at least `viewer` access to the library.
**Path params:** `id` (integer) — the library id.
**Returns:** `application/json` — a single library object with the same shape as an element of
`GET /libraries` (config fields + normalized `organizationMode` + `folders`). `404` if the
library doesn't exist.

### `GET /api/v1/libraries/{id}/stats`

**Purpose:** Per-library totals — book count, total size, and a per-format breakdown. Counts
only books currently present on disk, and sizes only each book's primary file.
**Auth:** Bearer JWT; `viewer` access required.
**Path params:** `id` (integer).
**Returns:** `application/json` — matches [`LibraryStats`](../../src/types.ts).

| Field            | Type   | Description                                                    |
| ---------------- | ------ | -------------------------------------------------------------- |
| `totalBooks`     | number | Count of present books                                         |
| `totalSizeBytes` | number | Sum of primary-file sizes, in bytes                            |
| `formatCounts`   | object | Map of format → count of primary files (e.g. `{ "epub": 40 }`) |

**Example:**

```json
{
  "totalBooks": 42,
  "totalSizeBytes": 123456789,
  "formatCounts": { "epub": 40, "pdf": 2 }
}
```

### `GET /api/v1/libraries/{libraryId}/access`

**Purpose:** List which users have access to a library, and at what level. Administrative.
**Auth:** Bearer JWT with the `ManageLibraries` permission.
**Path params:** `libraryId` (integer).
**Returns:** `application/json` — an array of access rows.

| Field         | Type   | Description              |
| ------------- | ------ | ------------------------ |
| `userId`      | number | The user granted access  |
| `accessLevel` | string | e.g. `viewer` / `editor` |
| `username`    | string | Login name               |
| `name`        | string | Display name             |

**Example:**

```json
[{ "userId": 456, "accessLevel": "editor", "username": "username", "name": "User Name" }]
```

### `GET /api/v1/libraries/{id}/bulk-rename/preview`

**Purpose:** Preview what a file-rename pass would do to the library's books — the new path each
book would get under the configured naming pattern, and why some would be skipped. Results are
computed once and cached ~60s server-side, then paginated/filtered. Administrative.
**Auth:** Bearer JWT with `editor` access **and** the `ManageLibraries` permission.
**Path params:** `id` (integer).
**Query params:** `page` (int, default `1`), `pageSize` (int, default `50`),
`status` (optional, one of `will_rename` / `unchanged` / `collision` / `no_pattern` / `error`).
**Returns:** `application/json` — a page of preview items plus per-status totals.

| Field           | Type   | Description                               |
| --------------- | ------ | ----------------------------------------- |
| `items`         | array  | Preview items (see below)                 |
| `total`         | number | Count after the `status` filter           |
| `totalByStatus` | object | Count per status across the whole library |

Each **item**:

| Field         | Type           | Description                                                        |
| ------------- | -------------- | ------------------------------------------------------------------ |
| `bookId`      | number         | Book id                                                            |
| `title`       | string         | Book title (`"Untitled"` if unknown)                               |
| `currentPath` | string         | Current absolute file path                                         |
| `newPath`     | string \| null | Proposed absolute path (`null` when nothing to rename)             |
| `status`      | string         | `will_rename` / `unchanged` / `collision` / `no_pattern` / `error` |
| `reason`      | string?        | Present when skipped/blocked (collision, no pattern, error)        |

**Example:**

```json
{
  "items": [
    {
      "bookId": 123,
      "title": "Book Title",
      "currentPath": "/books/library-name/old-name.epub",
      "newPath": "/books/library-name/Author Name/Book Title.epub",
      "status": "will_rename"
    }
  ],
  "total": 1,
  "totalByStatus": {
    "will_rename": 1,
    "unchanged": 0,
    "collision": 0,
    "no_pattern": 0,
    "error": 0
  }
}
```

### `GET /api/v1/libraries/{id}/bulk-rename/status`

**Purpose:** Whether a bulk-rename pass is currently running for this library (the rename itself
runs as an SSE stream on a separate `POST` route, out of scope here).
**Auth:** Bearer JWT with `editor` access **and** the `ManageLibraries` permission.
**Path params:** `id` (integer).
**Returns:** `application/json` — `{ "running": boolean }`.

**Example:**

```json
{ "running": false }
```

</content>
