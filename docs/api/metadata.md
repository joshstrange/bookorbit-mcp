# Metadata catalog

Faceted, typeahead-style lookups over the library's metadata facets — authors, series, genres,
tags, publishers, languages, narrators, and the user's collections. These back the
autocomplete/suggestion boxes in BookOrbit's search and filter UI: the caller types a few
characters and gets back a short, alphabetically-ordered list of matching facet values.

All endpoints are served by `CatalogController` (`@Controller('metadata')`) and are read-only
`GET`s requiring a Bearer JWT. Matching is a **case- and accent-insensitive "contains" match**
(the term is matched anywhere in the value), ordered by name.

## Shared query parameter

Every endpoint takes the same query (`SearchCatalogQueryDto`):

| Param | Type   | Description                                                                                                                                    |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`   | string | The search term. Optional; trimmed; max 500 characters. **An empty or whitespace-only `q` returns `[]`** — there is no "list everything" mode. |

Results are capped: most endpoints return up to **15** matches; `/metadata/collections` returns
up to **20**. Special LIKE characters (`%`, `_`, `\`) in `q` are escaped and matched literally.

## Return shapes

There are two shapes, both **bare JSON arrays** (no envelope, no pagination):

- **Name only** — `[{ "name": "..." }]` — authors, series, publishers, languages, narrators,
  collections.
- **Id + name** — `[{ "id": 123, "name": "..." }]` — genres and tags (these are first-class
  entities with stable ids you can filter by).

All endpoints are library-wide facets except **`/metadata/collections`**, which is scoped to the
signed-in user's own collections.

---

### `GET /api/v1/metadata/authors`

**Purpose:** Suggest author names matching `q`.
**Auth:** Bearer JWT required.
**Query params:** `q` (see above).
**Returns:** `application/json` — array of `{ name }` (max 15).

**Example:**

```json
[{ "name": "Author Name" }, { "name": "Author Name" }]
```

---

### `GET /api/v1/metadata/series`

**Purpose:** Suggest series names matching `q`.
**Auth:** Bearer JWT required.
**Query params:** `q`.
**Returns:** `application/json` — array of `{ name }` (max 15).

**Example:**

```json
[{ "name": "Series Name" }, { "name": "Series Name" }]
```

---

### `GET /api/v1/metadata/genres`

**Purpose:** Suggest genres matching `q`. Returns ids because genres are filterable entities.
**Auth:** Bearer JWT required.
**Query params:** `q`.
**Returns:** `application/json` — array of `{ id, name }` (max 15).

**Example:**

```json
[
  { "id": 12, "name": "Genre" },
  { "id": 34, "name": "Genre" }
]
```

---

### `GET /api/v1/metadata/tags`

**Purpose:** Suggest tags matching `q`. Returns ids because tags are filterable entities.
**Auth:** Bearer JWT required.
**Query params:** `q`.
**Returns:** `application/json` — array of `{ id, name }` (max 15).

**Example:**

```json
[
  { "id": 56, "name": "tag" },
  { "id": 78, "name": "tag" }
]
```

---

### `GET /api/v1/metadata/publishers`

**Purpose:** Suggest publisher names matching `q`. Values are distinct publishers drawn from book
metadata.
**Auth:** Bearer JWT required.
**Query params:** `q`.
**Returns:** `application/json` — array of `{ name }` (max 15).

**Example:**

```json
[{ "name": "Publisher Name" }, { "name": "Publisher Name" }]
```

---

### `GET /api/v1/metadata/languages`

**Purpose:** Suggest languages matching `q`. Values are distinct languages drawn from book
metadata.
**Auth:** Bearer JWT required.
**Query params:** `q`.
**Returns:** `application/json` — array of `{ name }` (max 15).

**Example:**

```json
[{ "name": "en" }, { "name": "fr" }]
```

---

### `GET /api/v1/metadata/narrators`

**Purpose:** Suggest narrator names matching `q` (audiobook narrators).
**Auth:** Bearer JWT required.
**Query params:** `q`.
**Returns:** `application/json` — array of `{ name }` (max 15).

**Example:**

```json
[{ "name": "Author Name" }, { "name": "Author Name" }]
```

---

### `GET /api/v1/metadata/collections`

**Purpose:** Suggest the signed-in user's own collection names matching `q`.
**Auth:** Bearer JWT required.
**Query params:** `q`.
**Returns:** `application/json` — array of `{ name }` (max 20). Scoped to the caller's
collections only.

**Example:**

```json
[{ "name": "Collection Name" }, { "name": "Collection Name" }]
```
