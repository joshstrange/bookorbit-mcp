# EPUB reader

These two endpoints are BookOrbit's **server-side EPUB reader backend** — and they are exactly
how _this MCP server_ reads books. Rather than shipping whole EPUB zips to clients, BookOrbit
opens the archive server-side and exposes its structure (`/info`) plus individual internal files
(`/file/{path}`). The MCP's `src/epub-structure.ts` consumes `/info` to flatten the spine + TOC
into navigable sections, and `html-to-text.ts` pulls one internal XHTML file at a time via
`/file/{path}`. See also the [project overview](../../CLAUDE.md).

> **How the server does it:** on first access it opens the EPUB zip, parses
> `META-INF/container.xml` → the OPF package (manifest/spine/metadata) and the nav document
> (EPUB 3 `nav`, falling back to NCX) into a nested TOC, and caches the parsed structure keyed by
> file mtime. `/file/{path}` streams a single entry straight out of the zip. Clients never
> download or unzip the EPUB themselves.

Both endpoints require a **Bearer JWT** and enforce library access on the book. Both accept an
optional `fileId` query param to target a **specific** EPUB file of the book (e.g. a book with
multiple EPUB files); omit it to use the book's **primary** EPUB file. A non-EPUB or missing
file yields `404`.

---

### `GET /api/v1/epub/{bookId}/info`

**Purpose:** Return the EPUB's structure and metadata — the spine (reading order), a nested table
of contents, the manifest (every internal file), and Dublin Core metadata. This is the map a
reader (or the MCP) uses to know what chapters exist and which internal files hold them.
**Auth:** Bearer JWT; caller must have access to the book's library.
**Path params:** `bookId` (integer) — the book id (not a file id).
**Query params:** `fileId` (integer, optional) — a specific EPUB file of the book; defaults to
the primary EPUB file.
**Returns:** `application/json` — matches [`EpubInfo`](../../src/types.ts).

| Field           | Type           | Description                                                                                               |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `containerPath` | string         | Path to the OPF package file inside the zip (from `container.xml`)                                        |
| `rootPath`      | string         | Directory prefix that internal hrefs resolve against (may be `""`)                                        |
| `spine`         | array          | Reading order: `{ idref, href, mediaType, linear }` per document                                          |
| `manifest`      | array          | Every internal file: `{ id, href, mediaType, size }`                                                      |
| `optionalFiles` | array?         | Present optional META-INF files (encryption, display-options, calibre bookmarks)                          |
| `toc`           | object         | Nested table of contents (see below); may be `null` if none was parseable                                 |
| `metadata`      | object         | Dublin Core: `title`, `creator`, `language`, `publisher`, `description`, `identifier` (only present keys) |
| `coverPath`     | string \| null | Internal path of the cover image, if identified                                                           |

`toc` nodes are `{ label, href?, children? }` and nest arbitrarily. `href` values are resolved
against `rootPath` and may carry a `#fragment` — that's how one spine document can hold many TOC
entries (the MCP treats each flattened TOC entry as a "chapter" and slices the XHTML by anchor
range).

**Example:**

```json
{
  "containerPath": "OEBPS/content.opf",
  "rootPath": "OEBPS/",
  "spine": [
    {
      "idref": "chapter1",
      "href": "OEBPS/chapter1.xhtml",
      "mediaType": "application/xhtml+xml",
      "linear": true
    }
  ],
  "manifest": [
    {
      "id": "chapter1",
      "href": "OEBPS/chapter1.xhtml",
      "mediaType": "application/xhtml+xml",
      "size": 12345
    },
    { "id": "css", "href": "OEBPS/style.css", "mediaType": "text/css", "size": 678 },
    {
      "id": "cover-image",
      "href": "OEBPS/cover.jpg",
      "mediaType": "image/jpeg",
      "size": 45678
    }
  ],
  "optionalFiles": [],
  "toc": {
    "label": "Table of Contents",
    "children": [
      { "label": "Chapter One", "href": "OEBPS/chapter1.xhtml#ch001" },
      { "label": "Chapter Two", "href": "OEBPS/chapter1.xhtml#ch002" }
    ]
  },
  "metadata": {
    "title": "Book Title",
    "creator": "Author Name",
    "language": "en",
    "publisher": "Publisher Name",
    "identifier": "urn:isbn:0000000000000"
  },
  "coverPath": "OEBPS/cover.jpg"
}
```

### `GET /api/v1/epub/{bookId}/file/{path}`

**Purpose:** Fetch one raw internal file out of the EPUB — an XHTML content document, a
stylesheet, an image, a font, etc. This is how a reader loads chapter markup and assets, and how
the MCP pulls the XHTML for a section before extracting its text.
**Auth:** Bearer JWT; caller must have access to the book's library.
**Path params:**

- `bookId` (integer) — the book id.
- `path` (string) — the file's **internal EPUB path**, and it may contain `/` (it's a wildcard
route segment, e.g. `OEBPS/chapter1.xhtml`). Each segment is URL-decoded server-side; the path
is normalized and validated against the manifest, so `..` traversal and entries not in the
archive are rejected (`403`/`404`).
**Query params:** `fileId` (integer, optional) — target a specific EPUB file of the book;
defaults to the primary EPUB file.
**Returns:** the file's **raw bytes**. `Content-Type` **varies by file** — it comes from the
manifest's declared media type (falling back to an extension guess), e.g.
`application/xhtml+xml` for content, `text/css`, `image/jpeg`/`image/png`/`image/svg+xml`,
`font/woff2`, etc. `Content-Length` is set when known, and responses carry
`Cache-Control: public, max-age=3600`. This is a binary/passthrough endpoint — there is no JSON
body.
</content>
