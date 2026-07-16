# Library statistics

Analytics over the **whole library** (all books the caller can see), not the signed-in user's
personal reading behavior — for that, see [user-statistics.md](user-statistics.md). These
endpoints power the charts on BookOrbit's statistics page: distributions, timelines, top-N
lists, scatter plots, and gauges. Each returns pre-aggregated points/buckets/gauges ready to
feed a chart; none returns raw book rows.

All endpoints are served by `StatisticsController` (`@Controller('statistics')`) and are
read-only `GET`s requiring a Bearer JWT. Results are visibility-scoped to the caller (superuser
sees everything; other users are limited by their content filters), and are cached server-side
for ~5 minutes.

## Shared query parameters

Every endpoint accepts the same optional filter (`StatisticsFilterQueryDto`):

| Param        | Type      | Description                                                                                                                                                        |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libraryIds` | integer[] | Optional. Restrict the aggregation to these library ids. Repeat the key (`?libraryIds=1&libraryIds=2`) or pass a single value. Omit for the whole visible library. |

`/statistics/books-added-over-time` accepts two more (`BooksOverTimeQueryDto`):

| Param         | Type | Description                                                     |
| ------------- | ---- | --------------------------------------------------------------- |
| `granularity` | enum | Optional. `monthly` (default) or `yearly`.                      |
| `range`       | enum | Optional. `last-year`, `last-5-years`, or `all-time` (default). |

## The `StatisticsResult` envelope

Most endpoints wrap their data in a generic envelope:

```json
{ "items": [/* ... */], "unknownCount": 0 }
```

- `items` — the array of chart points/buckets (shape varies per endpoint, documented below).
- `unknownCount` — how many books were dropped because the source column was `NULL` (e.g. no
  language, no publication year). It is always `0` for charts whose source column is never null
  (format, storage, added-date, author/series counts). It is **not** an error.

The endpoints that return a bespoke object instead of this envelope (summary, the two gauges,
the metadata-score distribution, and genre co-occurrence) are called out individually.

Endpoints that produce long-tail categorical data clip to a top-N and fold the remainder into a
synthetic bucket labeled `"Other"` (top-10 for format/language/storage) or `"OTHER"` (top-8 for
format-share-over-time); top-authors/genres are capped at 25 rows.

---

### `GET /api/v1/statistics/summary`

**Purpose:** Headline totals for the library — the numbers shown above the charts.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds` (see above).
**Returns:** `application/json` — a single `StatisticsSummary` object (no envelope).

| Field                | Type           | Description                                  |
| -------------------- | -------------- | -------------------------------------------- |
| `totalBooks`         | number         | Number of books.                             |
| `totalAuthors`       | number         | Distinct authors.                            |
| `totalSeries`        | number         | Distinct series.                             |
| `totalPublishers`    | number         | Distinct publishers.                         |
| `totalStorageBytes`  | number         | Sum of file sizes, in bytes.                 |
| `totalGenres`        | number         | Distinct genres.                             |
| `totalLanguages`     | number         | Distinct languages.                          |
| `publicationYearMin` | number \| null | Earliest publication year present.           |
| `publicationYearMax` | number \| null | Latest publication year present.             |
| `booksAddedThisYear` | number         | Books added since Jan 1 of the current year. |

**Example:**

```json
{
  "totalBooks": 1200,
  "totalAuthors": 450,
  "totalSeries": 90,
  "totalPublishers": 60,
  "totalStorageBytes": 32000000000,
  "totalGenres": 40,
  "totalLanguages": 5,
  "publicationYearMin": 1890,
  "publicationYearMax": 2024,
  "booksAddedThisYear": 120
}
```

---

### `GET /api/v1/statistics/books-added-over-time`

**Purpose:** How many books were added to the library over time — a line/bar timeline.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`; plus `granularity` and `range` (see above).
**Returns:** `application/json` — `StatisticsResult<BooksAddedDataPoint>`.

| Field           | Type   | Description                                           |
| --------------- | ------ | ----------------------------------------------------- |
| `items[].year`  | number | Calendar year of the bucket.                          |
| `items[].month` | number | Month `1`–`12`. For `yearly` granularity this is `1`. |
| `items[].count` | number | Books added in that bucket.                           |
| `unknownCount`  | number | Always `0` (added-date is never null).                |

**Example:**

```json
{
  "items": [
    { "year": 2023, "month": 11, "count": 20 },
    { "year": 2023, "month": 12, "count": 35 }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/format-distribution`

**Purpose:** Count of books per file format — a pie/bar chart.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<FormatDistributionItem>`. Clipped to top-10;
remainder folded into `"Other"`.

| Field            | Type   | Description                                 |
| ---------------- | ------ | ------------------------------------------- |
| `items[].format` | string | Format label (e.g. `"EPUB"`), or `"Other"`. |
| `items[].count`  | number | Books with that format.                     |
| `unknownCount`   | number | Always `0`.                                 |

**Example:**

```json
{
  "items": [
    { "format": "EPUB", "count": 900 },
    { "format": "PDF", "count": 200 },
    { "format": "Other", "count": 100 }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/format-share-over-time`

**Purpose:** Stacked-area "market share" of each format over time.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<FormatShareOverTimeItem>`. Only the top-8
formats keep their own series; the rest are folded into a format literal `"OTHER"`.

| Field            | Type   | Description                                |
| ---------------- | ------ | ------------------------------------------ |
| `items[].year`   | number | Calendar year of the bucket.               |
| `items[].month`  | number | Month `1`–`12`.                            |
| `items[].format` | string | Uppercased format label, or `"OTHER"`.     |
| `items[].count`  | number | Books of that format added in that bucket. |
| `unknownCount`   | number | Always `0`.                                |

**Example:**

```json
{
  "items": [
    { "year": 2023, "month": 11, "format": "EPUB", "count": 15 },
    { "year": 2023, "month": 11, "format": "PDF", "count": 5 }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/genre-distribution`

**Purpose:** Count of books per genre — a bar chart. Capped at the top 25 genres.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<GenreDistributionItem>`.

| Field           | Type   | Description                   |
| --------------- | ------ | ----------------------------- |
| `items[].genre` | string | Genre name.                   |
| `items[].count` | number | Books tagged with that genre. |
| `unknownCount`  | number | Books with no genre.          |

**Example:**

```json
{
  "items": [
    { "genre": "Genre", "count": 300 },
    { "genre": "Genre", "count": 250 }
  ],
  "unknownCount": 40
}
```

---

### `GET /api/v1/statistics/genre-cooccurrence`

**Purpose:** Which genres appear together on the same book — a chord/arc diagram.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — a `ChordDiagramData` object (no envelope).

| Field            | Type   | Description                           |
| ---------------- | ------ | ------------------------------------- |
| `nodes[].name`   | string | A genre participating in the diagram. |
| `links[].source` | string | Genre name at one end of the link.    |
| `links[].target` | string | Genre name at the other end.          |
| `links[].value`  | number | Number of books carrying both genres. |

**Example:**

```json
{
  "nodes": [{ "name": "Genre" }, { "name": "Genre" }],
  "links": [{ "source": "Genre", "target": "Genre", "value": 45 }]
}
```

---

### `GET /api/v1/statistics/language-distribution`

**Purpose:** Count of books per language. Clipped to top-10; remainder folded into `"Other"`.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<LanguageDistributionItem>`.

| Field              | Type   | Description                        |
| ------------------ | ------ | ---------------------------------- |
| `items[].language` | string | Language code/label, or `"Other"`. |
| `items[].count`    | number | Books in that language.            |
| `unknownCount`     | number | Books with no language set.        |

**Example:**

```json
{
  "items": [
    { "language": "en", "count": 1000 },
    { "language": "fr", "count": 120 }
  ],
  "unknownCount": 30
}
```

---

### `GET /api/v1/statistics/largest-books`

**Purpose:** The biggest books by file size — a ranked bar list.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<LargestBookItem>`.

| Field               | Type   | Description         |
| ------------------- | ------ | ------------------- |
| `items[].id`        | number | Book id.            |
| `items[].title`     | string | Book title.         |
| `items[].sizeBytes` | number | File size in bytes. |
| `items[].format`    | string | File format.        |
| `unknownCount`      | number | Always `0`.         |

**Example:**

```json
{
  "items": [
    { "id": 123, "title": "Book Title", "sizeBytes": 250000000, "format": "PDF" },
    { "id": 456, "title": "Book Title", "sizeBytes": 180000000, "format": "EPUB" }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/page-count-distribution`

**Purpose:** Box-plot summary of page counts, grouped by format.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<PageCountDistributionItem>`. One row per
format, carrying the five-number summary for a box plot.

| Field            | Type   | Description                             |
| ---------------- | ------ | --------------------------------------- |
| `items[].format` | string | Uppercased format label.                |
| `items[].count`  | number | Books of that format with a page count. |
| `items[].min`    | number | Minimum page count.                     |
| `items[].q1`     | number | First quartile.                         |
| `items[].median` | number | Median.                                 |
| `items[].q3`     | number | Third quartile.                         |
| `items[].max`    | number | Maximum page count.                     |
| `unknownCount`   | number | Books with no page count.               |

**Example:**

```json
{
  "items": [
    {
      "format": "EPUB",
      "count": 800,
      "min": 20,
      "q1": 180,
      "median": 300,
      "q3": 420,
      "max": 1200
    }
  ],
  "unknownCount": 50
}
```

---

### `GET /api/v1/statistics/publication-decade`

**Purpose:** Count of books grouped into publication decades — a histogram.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<PublicationDecadeItem>`.

| Field            | Type   | Description                      |
| ---------------- | ------ | -------------------------------- |
| `items[].decade` | number | Decade start year (e.g. `1990`). |
| `items[].count`  | number | Books published in that decade.  |
| `unknownCount`   | number | Books with no publication year.  |

**Example:**

```json
{
  "items": [
    { "decade": 1990, "count": 150 },
    { "decade": 2000, "count": 300 }
  ],
  "unknownCount": 60
}
```

---

### `GET /api/v1/statistics/publication-year-timeline`

**Purpose:** Books per individual publication year, with a few sample titles per point.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<PublicationYearPoint>`.

| Field               | Type     | Description                                       |
| ------------------- | -------- | ------------------------------------------------- |
| `items[].year`      | number   | Publication year.                                 |
| `items[].count`     | number   | Books published that year.                        |
| `items[].topTitles` | string[] | A handful of representative titles for that year. |
| `unknownCount`      | number   | Books with no publication year.                   |

**Example:**

```json
{
  "items": [{ "year": 2020, "count": 40, "topTitles": ["Book Title", "Book Title"] }],
  "unknownCount": 60
}
```

---

### `GET /api/v1/statistics/storage-by-format`

**Purpose:** Total bytes on disk per format. Clipped to top-10; remainder folded into `"Other"`.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<StorageByFormatItem>`.

| Field               | Type   | Description                  |
| ------------------- | ------ | ---------------------------- |
| `items[].format`    | string | Format label, or `"Other"`.  |
| `items[].sizeBytes` | number | Total bytes for that format. |
| `unknownCount`      | number | Always `0`.                  |

**Example:**

```json
{
  "items": [
    { "format": "PDF", "sizeBytes": 20000000000 },
    { "format": "EPUB", "sizeBytes": 8000000000 }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/top-authors`

**Purpose:** Authors with the most books — a ranked bar list (up to 25).
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<TopAuthorItem>`.

| Field           | Type   | Description           |
| --------------- | ------ | --------------------- |
| `items[].name`  | string | Author name.          |
| `items[].count` | number | Books by that author. |
| `unknownCount`  | number | Always `0`.           |

**Example:**

```json
{
  "items": [
    { "name": "Author Name", "count": 25 },
    { "name": "Author Name", "count": 18 }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/top-series`

**Purpose:** Series with the most books — a ranked bar list.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<TopSeriesItem>`.

| Field           | Type   | Description           |
| --------------- | ------ | --------------------- |
| `items[].name`  | string | Series name.          |
| `items[].count` | number | Books in that series. |
| `unknownCount`  | number | Always `0`.           |

**Example:**

```json
{
  "items": [
    { "name": "Series Name", "count": 12 },
    { "name": "Series Name", "count": 9 }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/acquisition-lag-scatter`

**Purpose:** Relationship between when a book was published and when it was added — a scatter
plot of "acquisition lag" (years between publication and being added to the library).
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<AcquisitionLagPoint>`. Points are aggregated
by (added-year, lag-years) with a `count` for bubble sizing.

| Field               | Type   | Description                                    |
| ------------------- | ------ | ---------------------------------------------- |
| `items[].addedYear` | number | Year the book was added to the library.        |
| `items[].lagYears`  | number | Years between publication and being added.     |
| `items[].count`     | number | Books sharing that (addedYear, lagYears) pair. |
| `unknownCount`      | number | Books excluded for missing publication year.   |

**Example:**

```json
{
  "items": [
    { "addedYear": 2023, "lagYears": 5, "count": 12 },
    { "addedYear": 2023, "lagYears": 0, "count": 40 }
  ],
  "unknownCount": 60
}
```

---

### `GET /api/v1/statistics/library-integrity-gauge`

**Purpose:** A single health gauge for how "complete" the library's books are on disk — files
present, a primary file assigned, and metadata attached.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — a `LibraryIntegrityGauge` object (no envelope).

| Field              | Type   | Description                                       |
| ------------------ | ------ | ------------------------------------------------- |
| `totalBooks`       | number | Books considered.                                 |
| `presentCount`     | number | Books whose file is present on disk.              |
| `primaryFileCount` | number | Books with a primary file assigned.               |
| `metadataCount`    | number | Books with metadata attached.                     |
| `integrityScore`   | number | `0`–`100`, the average of the three ratios above. |

**Example:**

```json
{
  "totalBooks": 1200,
  "presentCount": 1180,
  "primaryFileCount": 1190,
  "metadataCount": 1150,
  "integrityScore": 98
}
```

---

### `GET /api/v1/statistics/library-metadata-completeness`

**Purpose:** Per-library, per-field metadata coverage — the data behind a completeness heatmap.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<LibraryMetadataCompletenessItem>`. One row
per (library × metadata field) cell.

| Field                  | Type   | Description                                                    |
| ---------------------- | ------ | -------------------------------------------------------------- |
| `items[].libraryId`    | number | Library id.                                                    |
| `items[].libraryName`  | string | Library name.                                                  |
| `items[].field`        | string | Metadata field label (e.g. `"Cover"`, `"Author"`, `"ISBN"`).   |
| `items[].presentCount` | number | Books in that library with the field populated.                |
| `items[].totalCount`   | number | Books in that library.                                         |
| `items[].percent`      | number | `presentCount / totalCount` as an integer percent (`0`–`100`). |
| `unknownCount`         | number | Always `0`.                                                    |

**Example:**

```json
{
  "items": [
    {
      "libraryId": 1,
      "libraryName": "Library Name",
      "field": "Cover",
      "presentCount": 480,
      "totalCount": 500,
      "percent": 96
    },
    {
      "libraryId": 1,
      "libraryName": "Library Name",
      "field": "ISBN",
      "presentCount": 300,
      "totalCount": 500,
      "percent": 60
    }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/metadata-completeness`

**Purpose:** Library-wide (not per-library) coverage per metadata field — a bar chart. Only the
fields that count toward the overall score are returned, sorted by coverage.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — `StatisticsResult<MetadataCompletenessItem>`.

| Field                  | Type   | Description                                             |
| ---------------------- | ------ | ------------------------------------------------------- |
| `items[].field`        | string | Metadata field label (e.g. `"Cover"`, `"Description"`). |
| `items[].presentCount` | number | Books with the field populated.                         |
| `items[].totalCount`   | number | Books considered (same for every row).                  |
| `unknownCount`         | number | Always `0`.                                             |

**Example:**

```json
{
  "items": [
    { "field": "Cover", "presentCount": 1150, "totalCount": 1200 },
    { "field": "Description", "presentCount": 900, "totalCount": 1200 }
  ],
  "unknownCount": 0
}
```

---

### `GET /api/v1/statistics/metadata-freshness-gauge`

**Purpose:** How recently books' metadata was last fetched — a gauge plus the underlying age
buckets.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — a `MetadataFreshnessGauge` object (no envelope).

| Field                | Type   | Description                                    |
| -------------------- | ------ | ---------------------------------------------- |
| `totalBooks`         | number | Books considered.                              |
| `neverFetchedCount`  | number | Books whose metadata was never fetched.        |
| `fresh30dCount`      | number | Fetched within the last 30 days.               |
| `stale31To90dCount`  | number | Fetched 31–90 days ago.                        |
| `stale91To180dCount` | number | Fetched 91–180 days ago.                       |
| `staleOver180dCount` | number | Fetched more than 180 days ago.                |
| `freshnessScore`     | number | `0`–`100`, a recency-weighted freshness score. |

**Example:**

```json
{
  "totalBooks": 1200,
  "neverFetchedCount": 50,
  "fresh30dCount": 700,
  "stale31To90dCount": 250,
  "stale91To180dCount": 120,
  "staleOver180dCount": 80,
  "freshnessScore": 78
}
```

---

### `GET /api/v1/statistics/metadata-score-distribution`

**Purpose:** Histogram of per-book metadata-quality scores (0–100) across ten bins, plus
percentile markers.
**Auth:** Bearer JWT required.
**Query params:** `libraryIds`.
**Returns:** `application/json` — a `MetadataScoreDistribution` object (no `items` envelope). Ten
bins are always returned, covering `0–9`, `10–19`, … `90–100`.

| Field             | Type           | Description                           |
| ----------------- | -------------- | ------------------------------------- |
| `bins[].minScore` | number         | Bin lower bound (`0`, `10`, … `90`).  |
| `bins[].maxScore` | number         | Bin upper bound (`9`, `19`, … `100`). |
| `bins[].count`    | number         | Books whose score falls in the bin.   |
| `unknownCount`    | number         | Books with no computed score.         |
| `totalCount`      | number         | Books with a score.                   |
| `percentile25`    | number \| null | 25th-percentile score.                |
| `percentile50`    | number \| null | Median score.                         |
| `percentile75`    | number \| null | 75th-percentile score.                |
| `percentile90`    | number \| null | 90th-percentile score.                |

**Example:**

```json
{
  "bins": [
    { "minScore": 0, "maxScore": 9, "count": 5 },
    { "minScore": 90, "maxScore": 100, "count": 400 }
  ],
  "unknownCount": 20,
  "totalCount": 1180,
  "percentile25": 55,
  "percentile50": 72,
  "percentile75": 88,
  "percentile90": 95
}
```
