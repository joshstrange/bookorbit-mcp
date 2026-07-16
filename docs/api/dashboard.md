# Dashboard

The dashboard endpoints back BookOrbit's home page. Each **widget** route returns a small,
self-contained JSON blob for one home-page card (currently-reading list, reading streak, goals,
challenges, and a handful of derived analytics). The **scroller** route returns a horizontally
scrolling shelf of book cards for a named list (recently added, continue reading, etc.).

All routes are read-only, are scoped to the signed-in user, and require a Bearer JWT. Widget
results are computed from the user's reading history and library and are lightly cached
server-side (a live tier of ~2 minutes, a stale tier of ~5 minutes); a client should treat them
as near-real-time, not instantaneous. Widgets whose underlying data is empty may return `null`
(noted per endpoint). All timestamps are ISO-8601 UTC; all `progress`/fraction values are `0`–`1`.

Widget results are per-user analytics, not raw library content, but the sanitized examples below
still use only generic placeholder values.

---

## Widgets

### `GET /api/v1/dashboard/widgets/currently-reading`

**Purpose:** the books the user has in progress, for the "Currently reading" card. Reuses the
`CurrentlyReading` shape in `src/types.ts`.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — `{ books: [...] }`.

| Field                | Type           | Description                                 |
| -------------------- | -------------- | ------------------------------------------- |
| `books`              | array          | In-progress books, most recently read first |
| `books[].bookId`     | number         | Book id                                     |
| `books[].title`      | string \| null | Book title                                  |
| `books[].authors`    | string[]       | Author display names                        |
| `books[].progress`   | number         | Reading progress, `0`–`1`                   |
| `books[].hasCover`   | boolean        | Whether a cover image is available          |
| `books[].fileId`     | number \| null | The file being read (for deep links)        |
| `books[].fileFormat` | string \| null | That file's format, e.g. `"epub"`           |

**Example:**

```json
{
  "books": [
    {
      "bookId": 123,
      "title": "Book Title",
      "authors": ["Author Name"],
      "progress": 0.42,
      "hasCover": true,
      "fileId": 456,
      "fileFormat": "epub"
    }
  ]
}
```

---

### `GET /api/v1/dashboard/widgets/reading-streak`

**Purpose:** the user's current and longest consecutive-days reading streak, plus a one-week
activity sparkline.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — streak counts and a 7-element day flag array.

| Field           | Type      | Description                                     |
| --------------- | --------- | ----------------------------------------------- |
| `currentStreak` | number    | Consecutive days read up to today               |
| `longestStreak` | number    | Best streak on record                           |
| `lastSevenDays` | boolean[] | 7 flags (oldest→newest); `true` = read that day |

**Example:**

```json
{
  "currentStreak": 3,
  "longestStreak": 12,
  "lastSevenDays": [false, true, true, false, true, true, true]
}
```

---

### `GET /api/v1/dashboard/widgets/reading-goal`

**Purpose:** progress toward the user's annual books-read goal (the goal itself is a user
setting; `goalBooks` is `null` if unset).
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — goal, completed count, and the year they refer to.

| Field            | Type           | Description                                         |
| ---------------- | -------------- | --------------------------------------------------- |
| `goalBooks`      | number \| null | Target books for the year; `null` if not configured |
| `completedBooks` | number         | Books completed so far this year                    |
| `year`           | number         | Calendar year (UTC) these counts cover              |

**Example:**

```json
{ "goalBooks": 24, "completedBooks": 9, "year": 2024 }
```

---

### `GET /api/v1/dashboard/widgets/monthly-challenge`

**Purpose:** an auto-selected reading challenge for the current month and the user's progress
toward it. The server picks one `challengeType` from those the user is eligible for.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — the challenge plus progress/target.

| Field           | Type    | Description                                                                                                          |
| --------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `challengeType` | string  | One of `"short-read"`, `"genre-explorer"`, `"finish-oldest"`, `"streak-builder"`, `"new-author"`, `"page-milestone"` |
| `title`         | string  | Human-readable challenge title                                                                                       |
| `description`   | string  | What the challenge asks for                                                                                          |
| `progress`      | number  | Current progress (units depend on `challengeType`)                                                                   |
| `target`        | number  | Value that completes the challenge                                                                                   |
| `completed`     | boolean | Whether the challenge is already met                                                                                 |
| `month`         | number  | Month (1–12, UTC)                                                                                                    |
| `year`          | number  | Year (UTC)                                                                                                           |

**Example:**

```json
{
  "challengeType": "short-read",
  "title": "Short Reads",
  "description": "Finish 3 books under 250 pages this month",
  "progress": 1,
  "target": 3,
  "completed": false,
  "month": 1,
  "year": 2024
}
```

---

### `GET /api/v1/dashboard/widgets/reading-rhythm`

**Purpose:** a 14-day reading-time series plus consistency stats, for the "Reading rhythm" card.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — a per-day array plus aggregates.

| Field                   | Type   | Description                                  |
| ----------------------- | ------ | -------------------------------------------- |
| `days`                  | array  | 14 day buckets, oldest→newest                |
| `days[].date`           | string | Calendar day, `YYYY-MM-DD` (UTC)             |
| `days[].readingSeconds` | number | Seconds read that day                        |
| `consistencyPercent`    | number | Share of days with any reading, `0`–`100`    |
| `avgSecondsPerDay`      | number | Mean reading seconds per day over the window |
| `activeDays`            | number | Days in the window with any reading          |
| `totalDays`             | number | Window length (14)                           |

**Example:**

```json
{
  "days": [
    { "date": "2024-01-01", "readingSeconds": 0 },
    { "date": "2024-01-02", "readingSeconds": 1800 }
  ],
  "consistencyPercent": 50,
  "avgSecondsPerDay": 900,
  "activeDays": 7,
  "totalDays": 14
}
```

---

### `GET /api/v1/dashboard/widgets/reading-dna`

**Purpose:** a five-axis "reading DNA" profile derived from the last ~6 months of activity, plus
a named archetype. Each axis has a numeric score and a short label.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — archetype, five scores, five labels, and a sample size.

| Field           | Type   | Description                                  |
| --------------- | ------ | -------------------------------------------- |
| `archetype`     | string | Overall profile name derived from the scores |
| `lengthScore`   | number | Book-length axis score                       |
| `varietyScore`  | number | Genre-variety axis score                     |
| `rhythmScore`   | number | Reading-consistency axis score               |
| `timeScore`     | number | Time-of-day axis score                       |
| `speedScore`    | number | Reading-pace axis score                      |
| `lengthLabel`   | string | Short label for the length axis              |
| `varietyLabel`  | string | Short label for the variety axis             |
| `rhythmLabel`   | string | Short label for the rhythm axis              |
| `timeLabel`     | string | Short label for the time axis                |
| `speedLabel`    | string | Short label for the speed axis               |
| `booksAnalyzed` | number | Number of books the profile is based on      |

**Example:**

```json
{
  "archetype": "The Explorer",
  "lengthScore": 60,
  "varietyScore": 80,
  "rhythmScore": 45,
  "timeScore": 70,
  "speedScore": 55,
  "lengthLabel": "Balanced",
  "varietyLabel": "Wide-ranging",
  "rhythmLabel": "Occasional",
  "timeLabel": "Night owl",
  "speedLabel": "Steady",
  "booksAnalyzed": 12
}
```

---

### `GET /api/v1/dashboard/widgets/diversity-score`

**Purpose:** a composite "reading diversity" score (genre, author, era, and language spread) with
per-dimension sub-scores.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — an overall score, label, and four sub-scores.

| Field           | Type   | Description                           |
| --------------- | ------ | ------------------------------------- |
| `score`         | number | Composite diversity score             |
| `label`         | string | Human-readable band for `score`       |
| `genreScore`    | number | Genre-diversity sub-score             |
| `authorScore`   | number | Author-diversity sub-score            |
| `eraScore`      | number | Publication-era diversity sub-score   |
| `languageScore` | number | Language-diversity sub-score          |
| `booksAnalyzed` | number | Number of books the score is based on |

**Example:**

```json
{
  "score": 72,
  "label": "Varied",
  "genreScore": 80,
  "authorScore": 75,
  "eraScore": 60,
  "languageScore": 40,
  "booksAnalyzed": 30
}
```

---

### `GET /api/v1/dashboard/widgets/year-projection`

**Purpose:** an end-of-year projection (books, pages, hours) extrapolated from the last ~30 days
of activity, with a trend indicator.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — projected totals plus year-to-date context.

| Field               | Type   | Description                                        |
| ------------------- | ------ | -------------------------------------------------- |
| `projectedBooks`    | number | Projected books finished by year end               |
| `projectedPages`    | number | Projected pages read by year end                   |
| `projectedHours`    | number | Projected reading hours by year end                |
| `booksCompletedYtd` | number | Books completed year-to-date                       |
| `daysRemaining`     | number | Days left in the year                              |
| `trend`             | string | Recent-pace trend: `"up"`, `"down"`, or `"stable"` |

**Example:**

```json
{
  "projectedBooks": 28,
  "projectedPages": 8400,
  "projectedHours": 210,
  "booksCompletedYtd": 9,
  "daysRemaining": 200,
  "trend": "up"
}
```

---

### `GET /api/v1/dashboard/widgets/library-overview`

**Purpose:** headline totals for the user's accessible libraries, for the "Library overview" card.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — library-wide counts and storage.

| Field                | Type   | Description                       |
| -------------------- | ------ | --------------------------------- |
| `totalBooks`         | number | Books across accessible libraries |
| `totalAuthors`       | number | Distinct authors                  |
| `totalSeries`        | number | Distinct series                   |
| `totalStorageBytes`  | number | Total on-disk size, in bytes      |
| `booksAddedThisYear` | number | Books added in the current year   |

**Example:**

```json
{
  "totalBooks": 1200,
  "totalAuthors": 430,
  "totalSeries": 180,
  "totalStorageBytes": 53687091200,
  "booksAddedThisYear": 64
}
```

---

### `GET /api/v1/dashboard/widgets/highlight-of-the-day`

**Purpose:** a single annotation (highlight/note) surfaced for today, chosen deterministically
from the user's annotations. Returns `null` when the user has no annotations.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — one highlight object, or `null`.

| Field          | Type           | Description                                       |
| -------------- | -------------- | ------------------------------------------------- |
| `text`         | string         | The highlighted passage                           |
| `note`         | string \| null | The user's own note; `null` for a plain highlight |
| `bookTitle`    | string \| null | Title of the book it came from                    |
| `bookId`       | number         | Book id                                           |
| `hasCover`     | boolean        | Whether that book has a cover                     |
| `chapterTitle` | string \| null | BookOrbit's own chapter name for the highlight    |
| `createdAt`    | string         | When the annotation was created (ISO-8601 UTC)    |

**Example:**

```json
{
  "text": "An illustrative highlighted sentence.",
  "note": "A note the reader left.",
  "bookTitle": "Book Title",
  "bookId": 123,
  "hasCover": true,
  "chapterTitle": "Chapter One",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

---

### `GET /api/v1/dashboard/widgets/long-wait`

**Purpose:** a single book that has sat unread the longest since being added, as a "you've been
meaning to read this" nudge. Returns `null` when there is no candidate.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — one book object, or `null`.

| Field         | Type           | Description                            |
| ------------- | -------------- | -------------------------------------- |
| `bookId`      | number         | Book id                                |
| `title`       | string \| null | Book title                             |
| `hasCover`    | boolean        | Whether a cover is available           |
| `addedAt`     | string         | When the book was added (ISO-8601 UTC) |
| `waitingDays` | number         | Days since it was added                |
| `pageCount`   | number \| null | Page count, if known                   |
| `genre`       | string \| null | A representative genre                 |
| `fileId`      | number \| null | A readable file id (for deep links)    |
| `fileFormat`  | string \| null | That file's format, e.g. `"epub"`      |

**Example:**

```json
{
  "bookId": 123,
  "title": "Book Title",
  "hasCover": true,
  "addedAt": "2024-01-01T00:00:00Z",
  "waitingDays": 540,
  "pageCount": 320,
  "genre": "Genre",
  "fileId": 456,
  "fileFormat": "epub"
}
```

---

### `GET /api/v1/dashboard/widgets/neglected-gems`

**Purpose:** highly rated but long-unread books, for the "Neglected gems" card.
**Auth:** Bearer JWT required.
**Path params:** none.
**Query params:** none.
**Returns:** `application/json` — `{ gems: [...] }`.

| Field                | Type           | Description                         |
| -------------------- | -------------- | ----------------------------------- |
| `gems`               | array          | Neglected but well-rated books      |
| `gems[].bookId`      | number         | Book id                             |
| `gems[].title`       | string \| null | Book title                          |
| `gems[].hasCover`    | boolean        | Whether a cover is available        |
| `gems[].rating`      | number         | Rating that qualifies it as a "gem" |
| `gems[].waitingDays` | number         | Days since it was added             |
| `gems[].genre`       | string \| null | A representative genre              |

**Example:**

```json
{
  "gems": [
    {
      "bookId": 123,
      "title": "Book Title",
      "hasCover": true,
      "rating": 4.5,
      "waitingDays": 300,
      "genre": "Genre"
    }
  ]
}
```

---

## Scrollers

### `GET /api/v1/dashboard/scrollers/{type}`

**Purpose:** a horizontally scrolling shelf of book cards for one named list. The list is chosen
by the `{type}` path segment.
**Auth:** Bearer JWT required.
**Path params:** `type` (enum, required) — one of:

| `type`               | Shelf                                                    |
| -------------------- | -------------------------------------------------------- |
| `recently-added`     | Most recently added books                                |
| `continue-reading`   | In-progress ebooks/PDFs                                  |
| `continue-listening` | In-progress audiobooks                                   |
| `want-to-read`       | Books marked want-to-read                                |
| `up-next-in-series`  | Next unread book in series the user is reading           |
| `random`             | A random sampling                                        |
| `smart-scope`        | Results of a saved smart scope (requires `smartScopeId`) |

**Query params:**

- `limit` (integer, optional, default `20`) — number of cards; clamped to `1`–`50`.
- `smartScopeId` (integer, optional, default `0`) — **required and must be positive** when
  `type` is `smart-scope`; ignored otherwise. Omitting it for `smart-scope` returns `400`.

**Returns:** `application/json` — a bare array of book cards (the same rich "book card" shape used
by the browse endpoints). Key fields per card:

| Field             | Type           | Description                                  |
| ----------------- | -------------- | -------------------------------------------- |
| `id`              | number         | Book id                                      |
| `status`          | string         | Book status                                  |
| `title`           | string \| null | Book title                                   |
| `authors`         | string[]       | Author display names                         |
| `seriesName`      | string \| null | Series name, if any                          |
| `seriesIndex`     | number \| null | Position within the series                   |
| `files`           | array          | File refs: `{ id, format, role, sizeBytes }` |
| `publishedYear`   | number \| null | Publication year                             |
| `language`        | string \| null | Language code                                |
| `genres`          | string[]       | Genre names                                  |
| `rating`          | number \| null | User rating                                  |
| `readingProgress` | number \| null | Progress, `0`–`1`                            |
| `readStatus`      | string \| null | Per-user read status                         |
| `pageCount`       | number \| null | Page count, if known                         |
| `narrators`       | string[]       | Narrator names (audiobooks)                  |
| `tags`            | string[]       | Tag names                                    |
| `hasCover`        | boolean        | Whether a cover is available                 |
| `addedAt`         | string         | When the book was added (ISO-8601 UTC)       |
| `updatedAt`       | string \| null | Last update (ISO-8601 UTC)                   |

(The card carries additional metadata fields — subtitle, publisher, ISBN, metadata-lock flags,
custom metadata — omitted here; see the browse-endpoint docs for the full card shape.)

**Example:** `GET /api/v1/dashboard/scrollers/recently-added?limit=2`

```json
[
  {
    "id": 123,
    "status": "active",
    "title": "Book Title",
    "authors": ["Author Name"],
    "seriesName": "Series Name",
    "seriesIndex": 1,
    "files": [{ "id": 456, "format": "epub", "role": "primary", "sizeBytes": 1048576 }],
    "publishedYear": 2020,
    "language": "en",
    "genres": ["Genre"],
    "rating": null,
    "readingProgress": null,
    "readStatus": null,
    "pageCount": 320,
    "narrators": [],
    "tags": ["tag"],
    "hasCover": true,
    "addedAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
]
```
