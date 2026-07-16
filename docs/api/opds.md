# OPDS

[OPDS](https://opds.io/) (Open Publication Distribution System) is a standard, Atom-based
catalog format that lets ebook readers browse and download from a library over HTTP. BookOrbit
exposes its catalog as a set of OPDS feeds under `/api/v1/opds`, so any OPDS-aware reader
(Thorium, KOReader, Foliate, Panels, …) can point at the instance and browse.

> **These endpoints do not return JSON.** Every feed endpoint returns
> `application/atom+xml` (an Atom `<feed>` document); `search.opds` returns an OpenSearch
> description; and the cover/thumbnail/download endpoints return binary. The snippets below are
> **trimmed and sanitized** — real feeds carry many more entries and namespaces.

## Authentication (OPDS is different)

OPDS does **not** use the app's JWT bearer flow. The routes are marked `@Public()` but are
guarded by:

- **`OpdsEnabledGuard`** — the OPDS feature must be enabled server-side, else `403`.
- **`OpdsAuthGuard`** — expects **HTTP Basic auth** using dedicated _OPDS user_ credentials
  (not your normal login), and replies `401` with `WWW-Authenticate: Basic realm="bookorbit OPDS"`
  when they're missing. Cover/thumbnail image links instead carry a short signed **cover token**
  as a `?t=<token>` query param (minted per user), so a reader can fetch images without
  re-sending Basic credentials on every image request.

Content is scoped to what that OPDS user may see (library access + content filters).

## Feed types & content types

| Kind                   | `Content-Type`                                               |
| ---------------------- | ------------------------------------------------------------ |
| Navigation feed        | `application/atom+xml;profile=opds-catalog;kind=navigation`  |
| Acquisition feed       | `application/atom+xml;profile=opds-catalog;kind=acquisition` |
| OpenSearch description | `application/opensearchdescription+xml`                      |
| Cover / thumbnail      | `image/*` (binary)                                           |
| Download               | the book file's MIME (binary)                                |

Navigation feeds list _sub-feeds_ (each `<entry>` links with `rel="subsection"`). Acquisition
feeds list _books_ (each `<entry>` carries `rel="http://opds-spec.org/acquisition"` download
links and cover/thumbnail image links).

---

## Navigation feeds

### `GET /api/v1/opds`

**Purpose:** Root navigation feed — the catalog entry point. Links to All Books, Recent, Random,
Libraries, Collections, SmartScopes, Authors, and Series, plus a `search` link.
**Auth:** OPDS Basic auth.
**Returns:** `application/atom+xml` (navigation).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <title>bookorbit OPDS Catalog</title>
  <id>urn:bookorbit:root</id>
  <updated>2024-01-01T00:00:00Z</updated>
  <link rel="self" href="/api/v1/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="start" href="/api/v1/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="search" href="/api/v1/opds/search.opds" type="application/opensearchdescription+xml"/>
  <entry>
    <title>All Books</title>
    <id>urn:bookorbit:all</id>
    <updated>2024-01-01T00:00:00Z</updated>
    <content type="text">Browse the full catalog</content>
    <link rel="subsection" href="/api/v1/opds/catalog" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  </entry>
  <!-- …Recent, Random, Libraries, Collections, SmartScopes, Authors, Series… -->
</feed>
```

### `GET /api/v1/opds/libraries`

**Purpose:** Navigation feed of libraries the OPDS user can access; each entry links to
`/api/v1/opds/catalog?libraryId=<id>` and shows a `<content>` book count.
**Auth:** OPDS Basic auth. **Returns:** navigation feed.

```xml
<entry>
  <title>Library Name</title>
  <id>urn:bookorbit:library:123</id>
  <updated>2024-01-01T00:00:00Z</updated>
  <content type="text">42 books</content>
  <link rel="subsection" href="/api/v1/opds/catalog?libraryId=123" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
</entry>
```

### `GET /api/v1/opds/collections`

**Purpose:** Navigation feed of the user's collections; entries link to
`/api/v1/opds/catalog?collectionId=<id>`.
**Auth:** OPDS Basic auth. **Returns:** navigation feed (same entry shape as `libraries`, with
`urn:bookorbit:collection:<id>` ids).

### `GET /api/v1/opds/smart-scopes`

**Purpose:** Navigation feed of the user's SmartScopes (saved dynamic filters); entries link to
`/api/v1/opds/catalog?smartScopeId=<id>` with `urn:bookorbit:smartScope:<id>` ids.
**Auth:** OPDS Basic auth. **Returns:** navigation feed.

### `GET /api/v1/opds/authors`

**Purpose:** Navigation feed of distinct authors; each entry links to
`/api/v1/opds/catalog?author=<name>` (name URL-encoded) with a book count.
**Auth:** OPDS Basic auth. **Returns:** navigation feed.

```xml
<entry>
  <title>Author Name</title>
  <id>urn:bookorbit:author:Author%20Name</id>
  <updated>2024-01-01T00:00:00Z</updated>
  <content type="text">7 books</content>
  <link rel="subsection" href="/api/v1/opds/catalog?author=Author%20Name" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
</entry>
```

### `GET /api/v1/opds/series`

**Purpose:** Navigation feed of distinct series (unnamed series are dropped). Entries link to
`/api/v1/opds/catalog?seriesId=<id>` when a series id exists, otherwise
`/api/v1/opds/catalog?series=<name>`.
**Auth:** OPDS Basic auth. **Returns:** navigation feed.

---

## Acquisition feeds

Acquisition feeds paginate. Where noted, they accept `page` (default `1`) and `size` (default
`50`, clamped to `1..100`), and emit `first`/`previous`/`next`/`last` links plus an
`<opensearch:totalResults>` count. A pagination window that is too deep
(`(page - 1) * size` beyond the server's max offset) returns `400`.

### `GET /api/v1/opds/catalog`

**Purpose:** The main book (acquisition) feed. Also the target of every navigation entry above
and of search — filters are applied via query params.
**Auth:** OPDS Basic auth.
**Query params:** `page` (int, default `1`), `size` (int, default `50`, max `100`),
`libraryId`, `collectionId`, `smartScopeId`, `seriesId` (positive ints), `author` (string),
`series` (string), `q` (string — search term; when present the feed title becomes `Search: <q>`).
**Returns:** `application/atom+xml` (acquisition).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <title>Catalog</title>
  <id>urn:bookorbit:catalog</id>
  <updated>2024-01-01T00:00:00Z</updated>
  <opensearch:totalResults>1</opensearch:totalResults>
  <link rel="self" href="/api/v1/opds/catalog?page=1&amp;size=50" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="start" href="/api/v1/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="search" href="/api/v1/opds/search.opds" type="application/opensearchdescription+xml"/>
  <entry>
    <title>Book Title</title>
    <id>urn:bookorbit:book:123</id>
    <updated>2024-01-01T00:00:00Z</updated>
    <author><name>Author Name</name></author>
    <content type="text">Book description.</content>
    <link rel="http://opds-spec.org/sort/series" href="/api/v1/opds/catalog?seriesId=456" title="Series Name #1"/>
    <dc:language>en</dc:language>
    <dc:publisher>Publisher Name</dc:publisher>
    <dc:identifier>urn:isbn:0000000000000</dc:identifier>
    <link rel="http://opds-spec.org/image" href="/api/v1/opds/123/cover?t=COVER_TOKEN" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="/api/v1/opds/123/thumbnail?t=COVER_TOKEN" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition" href="/api/v1/opds/123/download?fileId=789" type="application/epub+zip" title="EPUB"/>
  </entry>
</feed>
```

### `GET /api/v1/opds/recent`

**Purpose:** Acquisition feed of recently-added books.
**Auth:** OPDS Basic auth. **Query params:** `page` (default `1`), `size` (default `50`, max `100`).
**Returns:** acquisition feed (`urn:bookorbit:recent`, title `Recent Books`), same entry shape as
`catalog`.

### `GET /api/v1/opds/surprise`

**Purpose:** Acquisition feed of up to 25 random books ("Random Books").
**Auth:** OPDS Basic auth. **Query params:** none (fixed at 25, single page).
**Returns:** acquisition feed (`urn:bookorbit:surprise`), same entry shape as `catalog`.

---

## Search description

### `GET /api/v1/opds/search.opds`

**Purpose:** OpenSearch description document that tells a reader how to build catalog search
URLs. The template points back at `/api/v1/opds/catalog?q={searchTerms}`.
**Auth:** OPDS Basic auth.
**Returns:** `application/opensearchdescription+xml`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>bookorbit OPDS</ShortName>
  <Description>Search the bookorbit book catalog</Description>
  <Url type="application/atom+xml;profile=opds-catalog;kind=acquisition" template="/api/v1/opds/catalog?q={searchTerms}"/>
  <InputEncoding>UTF-8</InputEncoding>
  <OutputEncoding>UTF-8</OutputEncoding>
</OpenSearchDescription>
```

---

## Binary endpoints

These return bytes, not XML. Each validates that the OPDS user may access the book first
(`404` otherwise). Covers and thumbnails support `ETag`/`If-None-Match` (`304` on match) and are
sent with `Cache-Control: no-cache` and `Cross-Origin-Resource-Policy: cross-origin`.

### `GET /api/v1/opds/{bookId}/cover`

**Purpose:** Full-size cover image for a book.
**Auth:** OPDS Basic auth, **or** a valid signed cover token as `?t=<token>` (how feed image
links authenticate). **Path params:** `bookId` (integer).
**Returns:** an image (`image/jpeg`, `image/png`, … inferred from the stored file). `404` if the
book has no cover.

### `GET /api/v1/opds/{bookId}/thumbnail`

**Purpose:** Small thumbnail image for a book.
**Auth:** OPDS Basic auth, or `?t=<token>`. **Path params:** `bookId` (integer).
**Returns:** `image/jpeg` (binary). `404` if no thumbnail.

### `GET /api/v1/opds/{bookId}/download`

**Purpose:** Download a book's actual file (the OPDS acquisition target).
**Auth:** OPDS Basic auth. **Path params:** `bookId` (integer).
**Query params:** `fileId` (integer, default `0` → the book's primary file; otherwise a specific
file of the book).
**Returns:** the file's bytes, with `Content-Type` set from the format (e.g.
`application/epub+zip`, `application/pdf`, `application/vnd.comicbook+zip`, …),
`Content-Length`, and a `Content-Disposition: attachment; filename="…"` header. `404` if the
file isn't found.
</content>
</invoke>
