# Series

Endpoints for browsing the library's series and listing the books within one series. A "series" is
a named grouping of books with an ordering index (e.g. book 1, 2, 3); BookOrbit tracks read
progress per series and can flag likely missing volumes.

All endpoints require a Bearer JWT (see [README](README.md#authentication)). Series and their books
are scoped to the libraries the signed-in user can access.

> **Pagination is zero-based here.** Both endpoints use `page` (default `0`) and `size` (default
> `50`, max `100`) query params and return the `{ items, total, page, size }` envelope (`Paged<T>`
> in `src/types.ts`); the per-series books endpoint adds a `seriesInfo` object.

### `GET /api/v1/series`

**Purpose:** Paginated, filterable list of series across the accessible libraries. Backs the series
browse view.
**Auth:** Bearer JWT required.
**Query params:**

| Param              | Type    | Default | Description                                                        |
| ------------------ | ------- | ------- | ------------------------------------------------------------------ |
| `q`                | string  | —       | Case-insensitive series-name search (max 500 chars).               |
| `page`             | integer | `0`     | Zero-based page index.                                             |
| `size`             | integer | `50`    | Page size, `1`–`100`.                                              |
| `sort`             | string  | `name`  | One of `name`, `bookCount`, `lastAddedAt`, `readProgress`.         |
| `order`            | string  | `asc`   | `asc` or `desc`.                                                   |
| `libraryId`        | integer | —       | Restrict to a single accessible library.                           |
| `completionStatus` | string  | —       | Filter by read state: `not_started`, `in_progress`, or `complete`. |
| `author`           | string  | —       | Filter to series by a given author name (max 500 chars).           |

**Returns:** `application/json` — `{ items: SeriesSummary[], total, page, size }`.

| Field          | Type           | Description                                                     |
| -------------- | -------------- | --------------------------------------------------------------- |
| `id`           | number         | Series id.                                                      |
| `name`         | string         | Series name.                                                    |
| `bookCount`    | number         | Number of books in the series (in accessible libraries).        |
| `readCount`    | number         | How many of those books the user has read.                      |
| `authors`      | string[]       | Distinct author names across the series.                        |
| `coverBookIds` | number[]       | Book ids whose covers represent the series (for a cover stack). |
| `lastAddedAt`  | string \| null | ISO timestamp of the most recently added book.                  |

**Example:**

```json
{
  "items": [
    {
      "id": 789,
      "name": "Series Name",
      "bookCount": 5,
      "readCount": 2,
      "authors": ["Author Name"],
      "coverBookIds": [456, 457, 458],
      "lastAddedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 0,
  "size": 50
}
```

### `GET /api/v1/series/{seriesId}/books`

**Purpose:** Paginated list of the books in one series, ordered by series index by default, plus a
`seriesInfo` block describing the series and any gaps in its numbering.
**Auth:** Bearer JWT required.
**Path params:** `seriesId` (integer) — the series id.
**Query params:**

| Param       | Type    | Default       | Description                               |
| ----------- | ------- | ------------- | ----------------------------------------- |
| `page`      | integer | `0`           | Zero-based page index.                    |
| `size`      | integer | `50`          | Page size, `1`–`100`.                     |
| `sort`      | string  | `seriesIndex` | One of `seriesIndex`, `title`, `addedAt`. |
| `order`     | string  | `asc`         | `asc` or `desc`.                          |
| `libraryId` | integer | —             | Restrict to one accessible library.       |

**Returns:** `application/json` — `{ items: BookCard[], total, page, size, seriesInfo }`. Responds
`404` if the series is not found in an accessible library (when `libraryId` is given and the series
exists in another library, it returns an empty page with `seriesInfo` instead).

Each `BookCard` item is the shared "book card" shape (see
[authors.md → `/authors/{id}/books`](authors.md#get-apiv1authorsidbooks) for the field table; a
subset is typed as `BookListItem` in `src/types.ts`). When a book belongs to multiple series, its
`seriesId`/`seriesName`/`seriesIndex` are set to the values for _this_ series.

The `seriesInfo` object (`SeriesDetail`):

| Field          | Type     | Description                                                                                    |
| -------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `id`           | number   | Series id.                                                                                     |
| `name`         | string   | Series name.                                                                                   |
| `bookCount`    | number   | Books in the series (accessible).                                                              |
| `readCount`    | number   | Books the user has read.                                                                       |
| `authors`      | string[] | Distinct author names.                                                                         |
| `possibleGaps` | number[] | Integer series indices that appear to be missing between the lowest and highest present index. |

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
  "total": 5,
  "page": 0,
  "size": 50,
  "seriesInfo": {
    "id": 789,
    "name": "Series Name",
    "bookCount": 5,
    "readCount": 2,
    "authors": ["Author Name"],
    "possibleGaps": [3]
  }
}
```
