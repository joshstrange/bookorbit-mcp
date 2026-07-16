# Reading statistics

Personal reading analytics for the **signed-in user** — as opposed to the library-wide totals
in [statistics.md](statistics.md). Every endpoint here is scoped to the calling user's own
reading activity, derived from their **reading sessions** (time spent) and **reading progress**
(how far through each book they've gotten). The controller is mounted at
`/api/v1/user-statistics` and every route is a read-only `GET`.

Results are computed from the same underlying session/progress data but sliced many different
ways: daily buckets, a calendar heatmap, hour-of-day and day-of-week rollups, completion
timelines, funnels, survival curves, goal trajectories, genre/author breakdowns, and a session
timeline. Responses are cached server-side per user for ~5 minutes, so values may lag the most
recent reading by a few minutes.

> A "reading source" (a.k.a. `bucket`) tags where a session came from. There are exactly three
> buckets: `"bookorbit"` (the native web/manual reader — also the fallback for untagged or
> unknown sources), `"koreader"`, and `"kobo"`. Many responses break reading time down by this
> bucket.

## Common query parameters

Most endpoints accept the same two optional filters (from `UserDailyReadingQueryDto` /
`UserStatisticsFilterQueryDto`); the per-endpoint sections below only call out parameters
**beyond** these two.

| Param        | Type                   | Description                                                                                                                                        |
| ------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libraryIds` | integer[] (repeatable) | Restrict to one or more libraries. Repeat the key (`?libraryIds=1&libraryIds=2`) or send a single value. Omitted ⇒ all libraries the user can see. |
| `days`       | integer, `1`–`3650`    | Size of the trailing look-back window, counted back from today (UTC). Each endpoint has its own default (noted below).                             |

Endpoints that take neither, or additional, params say so explicitly. `days` is ignored by
`summary` and `session-timeline`.

---

### `GET /api/v1/user-statistics/summary`

**Purpose:** Top-line counts of the user's tracked/started/in-progress/completed books plus mean
progress — the headline numbers for a reading-stats page.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds` only (no `days`).
**Returns:** `application/json` — a single `UserStatisticsSummary` object.

| Field                 | Type   | Description                                                          |
| --------------------- | ------ | -------------------------------------------------------------------- |
| `trackedBooks`        | number | Books the user has any reading state for                             |
| `startedBooks`        | number | Books with at least one recorded reading session                     |
| `inProgressBooks`     | number | Started but not completed                                            |
| `completedBooks`      | number | Books marked/detected as finished                                    |
| `meanProgressPercent` | number | Mean progress across tracked books, `0`–`100`, rounded to 2 decimals |

**Example:**

```json
{
  "trackedBooks": 120,
  "startedBooks": 85,
  "inProgressBooks": 30,
  "completedBooks": 55,
  "meanProgressPercent": 62.5
}
```

---

### `GET /api/v1/user-statistics/daily-reading`

**Purpose:** One data point per day of reading activity over the window — reading seconds,
progress gained, and event count. Only days with activity are returned (sparse).
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`).
**Returns:** `application/json` — an array of `UserDailyReadingStat`.

| Field            | Type   | Description                                                            |
| ---------------- | ------ | ---------------------------------------------------------------------- |
| `day`            | string | Calendar day, `YYYY-MM-DD` (UTC)                                       |
| `readingSeconds` | number | Total seconds read that day                                            |
| `progressDelta`  | number | Progress gained that day, as a `0`–`1` fraction, rounded to 4 decimals |
| `eventsCount`    | number | Number of reading/progress events that day                             |

**Example:**

```json
[
  {
    "day": "2024-01-01",
    "readingSeconds": 1800,
    "progressDelta": 0.045,
    "eventsCount": 6
  },
  {
    "day": "2024-01-03",
    "readingSeconds": 3600,
    "progressDelta": 0.09,
    "eventsCount": 11
  }
]
```

---

### `GET /api/v1/user-statistics/reading-heatmap`

**Purpose:** A calendar-heatmap series: like `daily-reading` but **dense** — every day in the
window is present (zero-filled) and each day additionally carries a per-source breakdown, for a
GitHub-style contribution grid.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`).
**Returns:** `application/json` — an array of `UserDailyReadingStat`, one entry per day in the
window, oldest first. Adds a `bySource` field the sparse `daily-reading` endpoint omits.

| Field            | Type   | Description                                                                                                  |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `day`            | string | Calendar day, `YYYY-MM-DD` (UTC)                                                                             |
| `readingSeconds` | number | Total seconds read that day (`0` on idle days)                                                               |
| `progressDelta`  | number | Progress gained that day, `0`–`1` fraction, 4 decimals                                                       |
| `eventsCount`    | number | Reading/progress events that day                                                                             |
| `bySource`       | object | Reading seconds split by source bucket; keys `bookorbit`, `koreader`, `kobo` (always all three, zero-filled) |

**Example:**

```json
[
  {
    "day": "2024-01-01",
    "readingSeconds": 1800,
    "progressDelta": 0.045,
    "eventsCount": 6,
    "bySource": { "bookorbit": 1200, "koreader": 600, "kobo": 0 }
  },
  {
    "day": "2024-01-02",
    "readingSeconds": 0,
    "progressDelta": 0,
    "eventsCount": 0,
    "bySource": { "bookorbit": 0, "koreader": 0, "kobo": 0 }
  }
]
```

---

### `GET /api/v1/user-statistics/reading-pace`

**Purpose:** One point per reading session mapping session length against progress gained — a
scatter-plot of reading pace, tagged by source and format.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `1825`).
**Returns:** `application/json` — an array of `UserReadingPacePoint` (one per qualifying session).

| Field             | Type   | Description                                               |
| ----------------- | ------ | --------------------------------------------------------- |
| `durationSeconds` | number | Session length in seconds                                 |
| `progressDelta`   | number | Progress gained during the session, as a `0`–`1` fraction |
| `bucket`          | string | Source bucket: `bookorbit`, `koreader`, or `kobo`         |
| `format`          | string | File format read, e.g. `"epub"`                           |

**Example:**

```json
[
  {
    "durationSeconds": 1500,
    "progressDelta": 0.03,
    "bucket": "bookorbit",
    "format": "epub"
  },
  {
    "durationSeconds": 2400,
    "progressDelta": 0.05,
    "bucket": "koreader",
    "format": "epub"
  }
]
```

---

### `GET /api/v1/user-statistics/peak-hours`

**Purpose:** Reading activity rolled up by hour of day (`0`–`23`), for finding when the user
reads most. Hours are bucketed in the user's own timezone (from their settings; UTC if unset).
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`).
**Returns:** `application/json` — a fixed 24-element array of `UserPeakHourStat`, ordered `hour`
`0`→`23` (idle hours zero-filled).

| Field            | Type   | Description                                                                              |
| ---------------- | ------ | ---------------------------------------------------------------------------------------- |
| `hour`           | number | Hour of day, `0`–`23` (user timezone)                                                    |
| `readingSeconds` | number | Total seconds read in that hour across the window                                        |
| `eventsCount`    | number | Reading events in that hour                                                              |
| `byFormat`       | object | Reading seconds keyed by file format (e.g. `{ "epub": 1200 }`); only formats seen appear |
| `bySource`       | object | Reading seconds by source bucket; keys `bookorbit`, `koreader`, `kobo`                   |

**Example:**

```json
[
  {
    "hour": 0,
    "readingSeconds": 0,
    "eventsCount": 0,
    "byFormat": {},
    "bySource": { "bookorbit": 0, "koreader": 0, "kobo": 0 }
  },
  {
    "hour": 21,
    "readingSeconds": 5400,
    "eventsCount": 14,
    "byFormat": { "epub": 5400 },
    "bySource": { "bookorbit": 3600, "koreader": 1800, "kobo": 0 }
  }
]
```

---

### `GET /api/v1/user-statistics/favorite-days`

**Purpose:** Reading activity rolled up by day of week, for finding which weekdays the user reads
most.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`).
**Returns:** `application/json` — a fixed 7-element array of `UserFavoriteDayStat`, ordered
`dayOfWeek` `0`→`6` (idle days zero-filled).

| Field            | Type   | Description                                                            |
| ---------------- | ------ | ---------------------------------------------------------------------- |
| `dayOfWeek`      | number | Day-of-week index, `0`–`6`                                             |
| `readingSeconds` | number | Total seconds read on that weekday across the window                   |
| `eventsCount`    | number | Reading events on that weekday                                         |
| `byFormat`       | object | Reading seconds keyed by file format                                   |
| `bySource`       | object | Reading seconds by source bucket; keys `bookorbit`, `koreader`, `kobo` |

**Example:**

```json
[
  {
    "dayOfWeek": 0,
    "readingSeconds": 7200,
    "eventsCount": 20,
    "byFormat": { "epub": 7200 },
    "bySource": { "bookorbit": 7200, "koreader": 0, "kobo": 0 }
  },
  {
    "dayOfWeek": 6,
    "readingSeconds": 3600,
    "eventsCount": 9,
    "byFormat": { "epub": 3600 },
    "bySource": { "bookorbit": 1800, "koreader": 1800, "kobo": 0 }
  }
]
```

---

### `GET /api/v1/user-statistics/session-timeline`

**Purpose:** Every individual reading session for one ISO week, as a timeline (start/end/duration
per session) — the data behind a week-view calendar of reading sessions. Does **not** use `days`.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, plus:

| Param  | Type                   | Description                                                                                   |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------- |
| `year` | integer, `1970`–`2100` | ISO week-year. Default: the current ISO week-year.                                            |
| `week` | integer, `1`–`53`      | ISO week number. Default: the current ISO week; clamped to the number of ISO weeks in `year`. |

**Returns:** `application/json` — a single `UserReadingSessionTimeline` object wrapping the week's
sessions (capped at 3000).

| Field                     | Type           | Description                                       |
| ------------------------- | -------------- | ------------------------------------------------- |
| `year`                    | number         | Resolved ISO week-year                            |
| `week`                    | number         | Resolved ISO week number                          |
| `weekStart`               | string         | Monday of the week, `YYYY-MM-DD` (UTC)            |
| `weekEnd`                 | string         | Sunday of the week, `YYYY-MM-DD` (UTC)            |
| `items`                   | array          | Sessions in the week (see below)                  |
| `items[].sessionId`       | number         | Reading-session id                                |
| `items[].bookId`          | number         | Book id                                           |
| `items[].bookTitle`       | string \| null | Book title                                        |
| `items[].bookFormat`      | string \| null | File format, e.g. `"epub"`                        |
| `items[].bookSource`      | string         | Source bucket: `bookorbit`, `koreader`, or `kobo` |
| `items[].startedAt`       | string         | Session start, ISO 8601                           |
| `items[].endedAt`         | string         | Session end, ISO 8601                             |
| `items[].durationSeconds` | number         | Session length in seconds                         |

**Example:**

```json
{
  "year": 2024,
  "week": 1,
  "weekStart": "2024-01-01",
  "weekEnd": "2024-01-07",
  "items": [
    {
      "sessionId": 456,
      "bookId": 123,
      "bookTitle": "Book Title",
      "bookFormat": "epub",
      "bookSource": "bookorbit",
      "startedAt": "2024-01-01T21:00:00Z",
      "endedAt": "2024-01-01T21:45:00Z",
      "durationSeconds": 2700
    }
  ]
}
```

> The controller also exposes `PATCH /api/v1/user-statistics/session-timeline/:sessionId` to
> drag a session to a new time. It is a write operation and therefore out of scope for this
> read-only reference.

---

### `GET /api/v1/user-statistics/session-archetypes`

**Purpose:** One point per reading session positioned by hour of day, day of week, and length —
for clustering sessions into "archetypes" (e.g. long weekend-morning reads vs. short weeknight
sessions).
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`).
**Returns:** `application/json` — an array of `UserSessionArchetypePoint` (one per session).

| Field             | Type   | Description                                |
| ----------------- | ------ | ------------------------------------------ |
| `hour`            | number | Hour of day the session occurred, `0`–`23` |
| `durationMinutes` | number | Session length in minutes                  |
| `dayOfWeek`       | number | Day-of-week index, `0`–`6`                 |

**Example:**

```json
[
  { "hour": 8, "durationMinutes": 45, "dayOfWeek": 6 },
  { "hour": 22, "durationMinutes": 15, "dayOfWeek": 2 }
]
```

---

### `GET /api/v1/user-statistics/completion-timeline`

**Purpose:** Books completed per calendar month over the window — a dense monthly series (every
month zero-filled) for a "books finished over time" chart.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `1825`).
**Returns:** `application/json` — an array of `UserCompletionTimelinePoint`, one per month, oldest
first.

| Field   | Type   | Description                              |
| ------- | ------ | ---------------------------------------- |
| `year`  | number | Calendar year (UTC)                      |
| `month` | number | Month, `1`–`12`                          |
| `count` | number | Books completed that month (`0` if none) |

**Example:**

```json
[
  { "year": 2023, "month": 12, "count": 2 },
  { "year": 2024, "month": 1, "count": 0 },
  { "year": 2024, "month": 2, "count": 3 }
]
```

---

### `GET /api/v1/user-statistics/completion-latency`

**Purpose:** Distribution of how long books take to finish (days from first session to
completion), bucketed, plus median/75th/90th percentiles.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `1825`).
**Returns:** `application/json` — a single `UserCompletionLatencyDistribution` object.

| Field               | Type           | Description                                                 |
| ------------------- | -------------- | ----------------------------------------------------------- |
| `totalCompletions`  | number         | Number of completed books in the window                     |
| `medianDays`        | number \| null | Median days-to-complete (`null` if no completions)          |
| `percentile75Days`  | number \| null | 75th-percentile days-to-complete                            |
| `percentile90Days`  | number \| null | 90th-percentile days-to-complete                            |
| `buckets`           | array          | Fixed histogram buckets (see below), always present         |
| `buckets[].label`   | string         | Bucket label, e.g. `"0-7d"`, `"731d+"`                      |
| `buckets[].minDays` | number         | Inclusive lower bound (days)                                |
| `buckets[].maxDays` | number \| null | Inclusive upper bound; `null` for the open-ended top bucket |
| `buckets[].count`   | number         | Completions falling in the bucket                           |

The bucket edges are fixed: `0-7d`, `8-30d`, `31-90d`, `91-180d`, `181-365d`, `366-730d`,
`731d+`.

**Example:**

```json
{
  "totalCompletions": 40,
  "medianDays": 21.5,
  "percentile75Days": 60.0,
  "percentile90Days": 120.0,
  "buckets": [
    { "label": "0-7d", "minDays": 0, "maxDays": 7, "count": 8 },
    { "label": "8-30d", "minDays": 8, "maxDays": 30, "count": 15 },
    { "label": "31-90d", "minDays": 31, "maxDays": 90, "count": 10 },
    { "label": "91-180d", "minDays": 91, "maxDays": 180, "count": 4 },
    { "label": "181-365d", "minDays": 181, "maxDays": 365, "count": 2 },
    { "label": "366-730d", "minDays": 366, "maxDays": 730, "count": 1 },
    { "label": "731d+", "minDays": 731, "maxDays": null, "count": 0 }
  ]
}
```

---

### `GET /api/v1/user-statistics/completion-race`

**Purpose:** Progress-over-time curves for books that had **at least two** reading sessions —
each book's points are `(days since its first session, progress %)`, for a "race to the finish"
chart. Long titles are truncated to ~40 characters.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `1825`).
**Returns:** `application/json` — an array of `UserCompletionRaceBook`.

| Field                     | Type   | Description                                      |
| ------------------------- | ------ | ------------------------------------------------ |
| `bookId`                  | number | Book id                                          |
| `title`                   | string | Book title (truncated with `...` past ~40 chars) |
| `points`                  | array  | Progress samples for the book, in session order  |
| `points[].daysSinceStart` | number | Days since the book's first session (2 decimals) |
| `points[].progress`       | number | Progress at that point, `0`–`100`, 1 decimal     |

**Example:**

```json
[
  {
    "bookId": 123,
    "title": "Book Title",
    "points": [
      { "daysSinceStart": 0, "progress": 5.0 },
      { "daysSinceStart": 2.5, "progress": 22.5 },
      { "daysSinceStart": 9.0, "progress": 100.0 }
    ]
  }
]
```

---

### `GET /api/v1/user-statistics/progress-funnel`

**Purpose:** A funnel of how far books get: how many were started, reached 25/50/75%, and
completed within the window — optionally with the previous equal-length window for comparison.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`), plus:

| Param             | Type    | Description                                                                                                                      |
| ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `comparePrevious` | boolean | If truthy (`1`/`true`/`yes`), also compute the immediately preceding window of the same length into `previous`. Default `false`. |

**Returns:** `application/json` — a single `UserProgressFunnelComparison` object.

| Field               | Type           | Description                                                              |
| ------------------- | -------------- | ------------------------------------------------------------------------ |
| `days`              | number         | The window length used                                                   |
| `current`           | object         | Funnel for the current window (see below)                                |
| `previous`          | object \| null | Funnel for the preceding window, or `null` when `comparePrevious` is off |
| `current.started`   | number         | Books started in the window                                              |
| `current.reached25` | number         | Books that reached ≥25%                                                  |
| `current.reached50` | number         | Books that reached ≥50%                                                  |
| `current.reached75` | number         | Books that reached ≥75%                                                  |
| `current.completed` | number         | Books completed                                                          |

`previous` (when present) has the same five fields.

**Example:**

```json
{
  "days": 365,
  "current": {
    "started": 50,
    "reached25": 40,
    "reached50": 30,
    "reached75": 22,
    "completed": 18
  },
  "previous": {
    "started": 45,
    "reached25": 35,
    "reached50": 25,
    "reached75": 18,
    "completed": 14
  }
}
```

---

### `GET /api/v1/user-statistics/reading-survival`

**Purpose:** A survival curve: of all books started in the window, what fraction reached at least
each progress threshold (`0`, `5`, …, `100`%). Shows where the user tends to abandon books.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `1825`).
**Returns:** `application/json` — a 21-element array of `UserReadingSurvivalPoint`, thresholds
`0`→`100` in steps of 5.

| Field           | Type   | Description                                                                |
| --------------- | ------ | -------------------------------------------------------------------------- |
| `threshold`     | number | Progress threshold, `0`–`100` in steps of 5                                |
| `survivedCount` | number | Books whose max progress reached ≥ `threshold`                             |
| `survivedPct`   | number | That count as a percentage of all started books, 1 decimal (`0` when none) |

**Example:**

```json
[
  { "threshold": 0, "survivedCount": 60, "survivedPct": 100.0 },
  { "threshold": 50, "survivedCount": 42, "survivedPct": 70.0 },
  { "threshold": 100, "survivedCount": 18, "survivedPct": 30.0 }
]
```

---

### `GET /api/v1/user-statistics/goal-trajectory`

**Purpose:** Cumulative books-completed vs. a linear reading-goal pace, month by month — the data
behind an "am I on track for my yearly goal?" chart.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`), plus:

| Param       | Type               | Description                                                                                  |
| ----------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `goalBooks` | integer, `1`–`240` | The annual goal (books/year). Default `12`. The target line uses `goalBooks / 12` per month. |

**Returns:** `application/json` — a single `UserGoalTrajectory` object.

| Field                       | Type   | Description                                                                 |
| --------------------------- | ------ | --------------------------------------------------------------------------- |
| `goalBooks`                 | number | The annual goal used                                                        |
| `points`                    | array  | One point per month in the window, oldest first                             |
| `points[].year`             | number | Calendar year (UTC)                                                         |
| `points[].month`            | number | Month, `1`–`12`                                                             |
| `points[].actualCumulative` | number | Running total of books actually completed through this month                |
| `points[].targetCumulative` | number | Running target through this month (`goalBooks/12 × monthIndex`), 2 decimals |

**Example:**

```json
{
  "goalBooks": 12,
  "points": [
    { "year": 2024, "month": 1, "actualCumulative": 2, "targetCumulative": 1.0 },
    { "year": 2024, "month": 2, "actualCumulative": 3, "targetCumulative": 2.0 },
    { "year": 2024, "month": 3, "actualCumulative": 3, "targetCumulative": 3.0 }
  ]
}
```

---

### `GET /api/v1/user-statistics/genre-reading-time`

**Purpose:** Total reading time per genre (top 30 by time), each split by source bucket — for a
"what genres do I spend time on" chart.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`).
**Returns:** `application/json` — an array of `UserGenreReadingTimeItem`, sorted by
`readingSeconds` descending, capped at 30.

| Field            | Type   | Description                                                            |
| ---------------- | ------ | ---------------------------------------------------------------------- |
| `genre`          | string | Genre name                                                             |
| `readingSeconds` | number | Total seconds read in the genre                                        |
| `bySource`       | object | Reading seconds by source bucket; keys `bookorbit`, `koreader`, `kobo` |

**Example:**

```json
[
  {
    "genre": "Genre",
    "readingSeconds": 36000,
    "bySource": { "bookorbit": 30000, "koreader": 6000, "kobo": 0 }
  },
  {
    "genre": "Genre",
    "readingSeconds": 18000,
    "bySource": { "bookorbit": 18000, "koreader": 0, "kobo": 0 }
  }
]
```

---

### `GET /api/v1/user-statistics/author-genre-chord`

**Purpose:** A chord-diagram dataset linking authors to genres by the user's reading activity —
`nodes` are authors and genres, `links` connect them weighted by reading.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `1825`).
**Returns:** `application/json` — a single `ChordDiagramData` object (shared with the library
statistics chord charts).

| Field            | Type   | Description                                    |
| ---------------- | ------ | ---------------------------------------------- |
| `nodes`          | array  | The chord nodes (authors and genres)           |
| `nodes[].name`   | string | Node label (an author name or a genre name)    |
| `links`          | array  | Weighted connections between nodes             |
| `links[].source` | string | Source node `name`                             |
| `links[].target` | string | Target node `name`                             |
| `links[].value`  | number | Link weight (reading activity linking the two) |

**Example:**

```json
{
  "nodes": [{ "name": "Author Name" }, { "name": "Genre" }],
  "links": [{ "source": "Author Name", "target": "Genre", "value": 5 }]
}
```

---

### `GET /api/v1/user-statistics/reading-source-distribution`

**Purpose:** Total reading time split across the three source buckets — for a "where do I read?"
donut (BookOrbit web vs. KOReader vs. Kobo). Buckets with zero time are omitted from `slices`.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`, `days` (default `365`).
**Returns:** `application/json` — a single `UserReadingSourceDistribution` object.

| Field                     | Type   | Description                                       |
| ------------------------- | ------ | ------------------------------------------------- |
| `totalSeconds`            | number | Total reading seconds across all buckets          |
| `slices`                  | array  | One entry per non-empty source bucket             |
| `slices[].bucket`         | string | Source bucket: `bookorbit`, `koreader`, or `kobo` |
| `slices[].readingSeconds` | number | Reading seconds for that bucket                   |

**Example:**

```json
{
  "totalSeconds": 54000,
  "slices": [
    { "bucket": "bookorbit", "readingSeconds": 36000 },
    { "bucket": "koreader", "readingSeconds": 18000 }
  ]
}
```
