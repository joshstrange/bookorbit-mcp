# Comic (CBZ) reader

These endpoints serve comic archives page-by-page, so a reader can page through a comic without
downloading the whole archive. Despite the `cbz` path prefix, the backend handles the common comic
container formats — **CBZ** (zip), **CBR** (rar), and **CB7** (7z) — transparently; the actual
format is detected from the file's magic bytes. Pages are indexed `0`-based in natural-sorted order
(hidden and non-image entries are skipped).

Both routes require a Bearer JWT and verify the caller can access the file. They are read-only.
The `{fileId}` is a book **file** id (not a book id) whose format is a comic archive.

---

### `GET /api/v1/cbz/files/{fileId}/pages`

**Purpose:** the number of image pages in a comic archive, so a client can build its page control
before fetching any page image.
**Auth:** Bearer JWT required.
**Path params:** `fileId` (integer) — the comic file id.
**Query params:** none.
**Returns:** `application/json` — `{ pageCount }`.

| Field       | Type   | Description                          |
| ----------- | ------ | ------------------------------------ |
| `pageCount` | number | Number of image pages in the archive |

**Example:**

```json
{ "pageCount": 24 }
```

---

### `GET /api/v1/cbz/files/{fileId}/pages/{pageIndex}`

**Purpose:** the raw image bytes for one page, streamed straight from the archive.
**Auth:** Bearer JWT required.
**Path params:** `fileId` (integer) — the comic file id; `pageIndex` (integer) — `0`-based page
index, must be `0 ≤ pageIndex < pageCount` (out-of-range returns `404`).
**Query params:** none.
**Returns:** a **binary image**. The `Content-Type` reflects the page's own image format —
typically `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/bmp`, or `image/avif`.
Responses are sent with a long-lived immutable `Cache-Control` header (pages never change). No
JSON body — this is a raw image stream.
