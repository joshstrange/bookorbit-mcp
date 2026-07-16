# Collections

Collections are user-owned, manually curated shelves of books (name + icon + an ordered set of
books) — distinct from series, which are metadata-driven. Each collection belongs to a single user;
these read-only endpoints only ever return the signed-in user's own collections (a superuser may
also read others').

All endpoints require a Bearer JWT (see [README](README.md#authentication)). Creating, editing, and
adding/removing books (`POST`/`PATCH`/`DELETE`) are write operations and out of scope here.

### `GET /api/v1/collections`

**Purpose:** List the user's collections, ordered by `displayOrder` then name.
**Auth:** Bearer JWT required.
**Query params:**

| Param     | Type   | Required | Description                                                                                                                                                         |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bookIds` | string | no       | Comma-separated book ids. When present, each returned collection also gets a `memberCount` — how many of those ids are already in it (for "add to collection" UIs). |

**Returns:** `application/json` — a bare array of `Collection` (not a page envelope).

| Field          | Type           | Description                                                                     |
| -------------- | -------------- | ------------------------------------------------------------------------------- |
| `id`           | number         | Collection id.                                                                  |
| `name`         | string         | Collection name.                                                                |
| `icon`         | string \| null | Icon identifier.                                                                |
| `description`  | string \| null | Optional description.                                                           |
| `syncToKobo`   | boolean        | Whether the collection syncs to Kobo devices.                                   |
| `displayOrder` | number         | Sort order among the user's collections.                                        |
| `bookCount`    | number         | Number of books in the collection.                                              |
| `memberCount`  | number         | Only when `bookIds` is supplied — how many of those ids are in this collection. |
| `createdAt`    | string         | ISO creation timestamp.                                                         |
| `updatedAt`    | string         | ISO last-updated timestamp.                                                     |

**Example:**

```json
[
  {
    "id": 123,
    "name": "Collection Name",
    "icon": "star",
    "description": "Collection description.",
    "syncToKobo": false,
    "displayOrder": 0,
    "bookCount": 8,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```

### `GET /api/v1/collections/{id}`

**Purpose:** Detail for one collection.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the collection id.
**Returns:** `application/json` — a single `Collection` (same fields as a list item above, without
`memberCount`). Responds `404` if the collection does not exist and `403` if it belongs to another
user (and the caller is not a superuser).

**Example:**

```json
{
  "id": 123,
  "name": "Collection Name",
  "icon": "star",
  "description": "Collection description.",
  "syncToKobo": false,
  "displayOrder": 0,
  "bookCount": 8,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### `GET /api/v1/collections/{id}/books`

**Purpose:** Paginated list of the books in one collection.
**Auth:** Bearer JWT required.
**Path params:** `id` (integer) — the collection id.
**Query params:**

| Param            | Type    | Default | Description                                                                        |
| ---------------- | ------- | ------- | ---------------------------------------------------------------------------------- |
| `page`           | integer | `0`     | Zero-based page index.                                                             |
| `size`           | integer | `50`    | Page size, `1`–`100`.                                                              |
| `collapseSeries` | boolean | —       | When `true`, collapse books of the same series into a single representative entry. |
| `q`              | string  | —       | Free-text search within the collection's books.                                    |

**Returns:** `application/json` — `{ items: BookCard[], total, page, size }`. Access is enforced as
for `GET /collections/{id}` (`404`/`403`). Each `BookCard` item is the shared "book card" shape
(see [authors.md → `/authors/{id}/books`](authors.md#get-apiv1authorsidbooks) for the field table;
a subset is typed as `BookListItem` in `src/types.ts`).

**Example:**

```json
{
  "items": [
    {
      "id": 456,
      "title": "Book Title",
      "authors": ["Author Name"],
      "seriesId": 789,
      "seriesName": "Series Name",
      "seriesIndex": 1,
      "files": [{ "id": 1, "format": "epub", "role": "primary", "sizeBytes": 123456 }],
      "publishedYear": 2024,
      "language": "en",
      "genres": ["Genre"],
      "hasCover": true,
      "readingProgress": 0.25,
      "addedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 8,
  "page": 0,
  "size": 50
}
```
