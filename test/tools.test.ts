import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BookCache } from "../src/cache.js";
import { BookService } from "../src/book-service.js";
import { registerTools } from "../src/tools.js";
import type { BookOrbitClient } from "../src/bookorbit-client.js";
import type { EpubInfo } from "../src/types.js";

const info: EpubInfo = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/epub-info.json", import.meta.url)),
    "utf8",
  ),
);
const chapterXhtml = readFileSync(
  fileURLToPath(new URL("./fixtures/chapter-bundle.xhtml", import.meta.url)),
  "utf8",
);

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}>;

/** Minimal fake McpServer capturing registered tool handlers. */
function fakeServer() {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool(name: string, _cfg: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const h = handlers.get(name);
    assert.ok(h, `tool ${name} not registered`);
    const res = await h(args);
    const first = res.content[0];
    const data =
      res.isError || first?.type !== "text" ? null : JSON.parse(first.text as string);
    return { res, data };
  };
  return { server, call };
}

function stubClient() {
  const client = {
    async searchBooks(_q: string) {
      return [
        {
          id: 327,
          title: "Sample Book",
          authors: ["Test Author"],
          seriesName: "Sample Series",
          libraryId: 1,
          libraryName: "eBooks",
          updatedAt: "2026-07-10",
          formats: ["epub"],
        },
      ];
    },
    async getEpubInfo() {
      return info;
    },
    async getEpubFile(_id: number, path: string) {
      if (path.endsWith("bundle.xhtml")) return chapterXhtml;
      return `<html><body><p>Stub ${path}</p></body></html>`;
    },
    async listAnnotatedBooks() {
      return [
        { bookId: 327, bookTitle: "Sample Book", author: "Test Author", count: 2 },
        { bookId: 400, bookTitle: "Other Book", author: "Someone Else", count: 1 },
      ];
    },
    async getAnnotations(bookId: number) {
      if (bookId === 999) return [];
      // Intentionally out of chapter order to exercise sorting.
      return [
        {
          id: 2,
          bookId,
          cfi: "epubcfi(/6/8!/4/2)",
          jumpFileId: 5,
          pageno: 42,
          text: "second chapter highlight",
          color: "#111",
          style: "highlight",
          note: "a note",
          chapterTitle: "Two",
          chapterIndex: 2,
          origin: "koreader",
          positionStatus: "exact",
          createdAt: "2026-07-02T00:00:00.000Z",
        },
        {
          id: 1,
          bookId,
          cfi: "epubcfi(/6/4!/4/2)",
          jumpFileId: 3,
          pageno: 10,
          text: "first chapter highlight",
          color: "#222",
          style: "highlight",
          note: null,
          chapterTitle: "One",
          chapterIndex: 1,
          origin: "koreader",
          positionStatus: "exact",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ];
    },
    async listAnnotations(opts?: { page?: number; pageSize?: number; bookId?: number }) {
      const all = [
        {
          id: 2,
          bookId: 327,
          cfi: null,
          jumpFileId: null,
          pageno: 42,
          text: "highlight from sample book",
          color: "#111",
          style: "highlight",
          note: "a note",
          chapterTitle: "Two",
          chapterIndex: 2,
          origin: "koreader",
          positionStatus: "exact",
          createdAt: "2026-07-02T00:00:00.000Z",
          bookTitle: "Sample Book",
          author: "Test Author",
          deletedAt: null,
        },
        {
          id: 9,
          bookId: 400,
          cfi: null,
          jumpFileId: null,
          pageno: 7,
          text: "highlight from other book",
          color: "#333",
          style: "highlight",
          note: null,
          chapterTitle: "Intro",
          chapterIndex: 1,
          origin: "koreader",
          positionStatus: "exact",
          createdAt: "2026-07-03T00:00:00.000Z",
          bookTitle: "Other Book",
          author: "Someone Else",
          deletedAt: null,
        },
      ];
      const items =
        opts?.bookId != null ? all.filter((a) => a.bookId === opts.bookId) : all;
      return {
        items,
        total: items.length,
        page: opts?.page ?? 1,
        pageSize: opts?.pageSize ?? 25,
        stats: {
          books: 2,
          withNotes: 1,
          originBreakdown: [{ origin: "koreader", count: items.length }],
        },
      };
    },
    // A rich browse-book item carrying noise fields the tools must trim.
    async getRelatedBooks(_bookId: number, kind: string) {
      return [
        {
          id: kind === "same_author" ? 500 : 116,
          title: "Related Book",
          authors: ["Test Author"],
          seriesIndex: kind === "same_series" ? 2 : undefined,
          hasCover: true,
          isAudiobook: false,
          isComic: false,
          updatedAt: "2026-06-21T03:06:03.762Z",
        },
      ];
    },
    async listSeries(opts?: { page?: number; size?: number }) {
      return {
        items: [
          {
            id: 387,
            name: "Between Earth and Sky",
            bookCount: 3,
            readCount: 0,
            authors: ["Rebecca Roanhorse"],
            coverBookIds: [245, 246, 247],
            lastAddedAt: "2026-06-21T19:46:23.164Z",
          },
        ],
        total: 34,
        page: opts?.page ?? 1,
        size: opts?.size ?? 25,
      };
    },
    async getSeriesBooks(_seriesId: number, opts?: { page?: number; size?: number }) {
      return {
        items: [sampleBookItem()],
        total: 1,
        page: opts?.page ?? 1,
        size: opts?.size ?? 25,
      };
    },
    async listAuthors(opts?: { page?: number; size?: number }) {
      return {
        items: [
          {
            id: 192,
            name: "Aldous Huxley",
            sortName: null,
            description: "A biography of the author.",
            bookCount: 1,
            lastAddedAt: "2026-06-21T18:16:44.256Z",
          },
        ],
        total: 48,
        page: opts?.page ?? 1,
        size: opts?.size ?? 25,
      };
    },
    async getAuthor(authorId: number) {
      return {
        id: authorId,
        name: "Aldous Huxley",
        sortName: null,
        description: "A biography of the author.",
        bookCount: 1,
        lastAddedAt: "2026-06-21T18:16:44.256Z",
      };
    },
    async getAuthorBooks(_authorId: number, opts?: { page?: number; size?: number }) {
      return {
        items: [sampleBookItem()],
        total: 1,
        page: opts?.page ?? 1,
        size: opts?.size ?? 25,
      };
    },
    async listCollections() {
      return [{ id: 7, name: "Favorites", bookCount: 4 }];
    },
    async getCollectionBooks(_id: number, opts?: { page?: number; size?: number }) {
      return {
        items: [sampleBookItem()],
        total: 1,
        page: opts?.page ?? 1,
        size: opts?.size ?? 25,
      };
    },
    async listSmartScopes() {
      return [{ id: 3, name: "Unread Sci-Fi" }];
    },
    async getSmartScopeBooks(_id: number, opts?: { page?: number; size?: number }) {
      return {
        items: [sampleBookItem()],
        total: 1,
        page: opts?.page ?? 1,
        size: opts?.size ?? 25,
      };
    },
    async getReadingProgress(_bookId: number) {
      return [
        {
          fileId: 69,
          cfi: null,
          pageNumber: null,
          percentage: 0.1,
          koboLocationSource: null,
          koboLocationType: null,
          koreaderProgress: "/body/DocFragment[1]/body/div",
          updatedAt: "2026-07-15T23:10:34.231Z",
        },
      ];
    },
    async getAudioProgress(_bookId: number) {
      return null;
    },
    async listCurrentlyReading() {
      return {
        books: [
          {
            bookId: 115,
            title: "Ender's Game",
            authors: ["Orson Scott Card"],
            progress: 0.1,
            fileFormat: "epub",
            hasCover: true,
            fileId: 69,
          },
        ],
      };
    },
    async getReadingSessions(
      _bookId: number,
      opts?: { page?: number; pageSize?: number },
    ) {
      return {
        items: [],
        total: 0,
        page: opts?.page ?? 1,
        pageSize: opts?.pageSize ?? 25,
        stats: {
          totalSessions: 0,
          totalSeconds: 0,
          avgDurationSeconds: 0,
          firstSessionAt: null,
          lastSessionAt: null,
          paceProgressDelta: 0,
          paceDurationSeconds: 0,
        },
      };
    },
    async getStatisticsSummary() {
      return {
        totalBooks: 170,
        totalAuthors: 48,
        totalSeries: 34,
        totalPublishers: 12,
        totalStorageBytes: 297535871,
        totalGenres: 20,
        totalLanguages: 3,
        publicationYearMin: 1855,
        publicationYearMax: 2024,
        booksAddedThisYear: 170,
      };
    },
    async getUserStatisticsSummary() {
      return {
        trackedBooks: 5,
        startedBooks: 3,
        inProgressBooks: 2,
        completedBooks: 1,
        meanProgressPercent: 42,
      };
    },
    async listLibraries() {
      return [
        {
          id: 1,
          name: "eBooks",
          displayOrder: 0,
          watch: true,
          organizationMode: "author",
        },
      ];
    },
    async getLibraryStats(_libraryId: number) {
      return {
        totalBooks: 170,
        totalSizeBytes: 297535871,
        formatCounts: { epub: 168, pdf: 1, mobi: 1 },
      };
    },
    // The three kind-dispatch tools; stubs echo their args for forwarding assertions.
    async suggestMetadata(kind: string, q: string) {
      return { echoedKind: kind, echoedQ: q, sample: [{ name: "Author Name" }] };
    },
    async getLibraryStatistic(kind: string, opts?: unknown) {
      return { echoedKind: kind, echoedOpts: opts ?? null, items: [] };
    },
    async getUserStatistic(kind: string, opts?: unknown) {
      return { echoedKind: kind, echoedOpts: opts ?? null };
    },
    async getDashboardWidget(kind: string) {
      return { echoedKind: kind, currentStreak: 5 };
    },
    async getBookShelf(_type: string, _opts?: { limit?: number; smartScopeId?: number }) {
      return [sampleBookItem()];
    },
    async getCollection(id: number) {
      return { id, name: "Favorites", description: "d", icon: "star", bookCount: 4 };
    },
    async searchAuthorMetadata(q: string, opts?: unknown) {
      return {
        echoedQ: q,
        echoedOpts: opts ?? null,
        candidates: [{ name: "J.R.R. Tolkien" }],
      };
    },
    async getBookCover(_bookId: number, size: string) {
      return {
        data: Buffer.from(size === "thumbnail" ? [1, 2] : [1, 2, 3]),
        contentType: "image/jpeg",
      };
    },
    async getAuthorImage(_authorId: number, _size: string) {
      return { data: Buffer.from([4, 5]), contentType: "image/png" };
    },
  } as unknown as BookOrbitClient;
  return client;
}

/** A rich browse-book item (as the /{...}/books endpoints return) with noise fields. */
function sampleBookItem() {
  return {
    id: 245,
    status: "present",
    title: "Black Sun",
    seriesId: 387,
    seriesName: "Between Earth and Sky",
    seriesIndex: 1,
    seriesMemberships: [
      {
        seriesId: 387,
        seriesName: "Between Earth and Sky",
        seriesIndex: 1,
        displayOrder: 0,
      },
    ],
    authors: ["Rebecca Roanhorse"],
    files: [{ id: 135, format: "epub", role: "primary", sizeBytes: 484303 }],
    publishedDate: null,
    publishedYear: 2020,
    language: "English",
    genres: ["Fantasy", "Fiction"],
  };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "bookorbit-tools-"));
  const service = new BookService(stubClient(), new BookCache(dir));
  const { server, call } = fakeServer();
  registerTools(server as never, stubClient(), service);
  return { call };
}

test("search_books flags EPUB availability", async () => {
  const { call } = await setup();
  const { data } = await call("search_books", { query: "absolution" });
  assert.equal(data[0].bookId, 327);
  assert.equal(data[0].hasEpub, true);
});

test("list_chapters returns sizes and no text", async () => {
  const { call } = await setup();
  const { data } = await call("list_chapters", { bookId: 327 });
  assert.ok(data.chapterCount >= 10);
  assert.ok(data.chapters.every((c: Record<string, unknown>) => !("text" in c)));
  assert.ok(data.chapters.every((c: { charCount: number }) => c.charCount >= 0));
});

test("get_chapter paginates a long chapter via nextOffset", async () => {
  const { call } = await setup();
  const { data: toc } = await call("list_chapters", { bookId: 327 });
  // Pick the largest chapter so 500 chars is guaranteed to be a partial page.
  const biggest = toc.chapters.reduce(
    (a: { charCount: number }, b: { charCount: number }) =>
      b.charCount > a.charCount ? b : a,
  );
  const idx = biggest.chapter;
  assert.ok(biggest.charCount > 500, "need a chapter longer than 500 chars");

  const first = await call("get_chapter", { bookId: 327, chapter: idx, maxChars: 500 });
  assert.equal(first.data.returnedChars, 500);
  assert.equal(first.data.hasMore, true);
  assert.equal(first.data.nextOffset, 500);

  const second = await call("get_chapter", {
    bookId: 327,
    chapter: idx,
    offset: first.data.nextOffset,
    maxChars: 500,
  });
  assert.equal(second.data.offset, 500);
  assert.notEqual(first.data.text, second.data.text);
});

test("get_chapter reports an out-of-range chapter as an error", async () => {
  const { call } = await setup();
  const { res } = await call("get_chapter", { bookId: 327, chapter: 9999 });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not found/i);
});

test("search_in_book returns re-fetchable locations", async () => {
  const { call } = await setup();
  const { data } = await call("search_in_book", {
    bookId: 327,
    query: "the",
    maxResults: 3,
  });
  assert.ok(data.hitCount > 0);
  const hit = data.hits[0];
  assert.ok(Number.isInteger(hit.chapter ?? hit.sectionIndex));
  assert.ok(hit.charOffset >= 0);
  assert.match(hit.snippet, /the/i);
});

test("list_annotated_books returns books with counts", async () => {
  const { call } = await setup();
  const { data } = await call("list_annotated_books", {});
  assert.equal(data.bookCount, 2);
  assert.equal(data.books[0].bookId, 327);
  assert.equal(data.books[0].count, 2);
});

test("get_annotations orders by chapter and trims fields", async () => {
  const { call } = await setup();
  const { data } = await call("get_annotations", { bookId: 327 });
  assert.equal(data.annotationCount, 2);
  // Sorted by chapterIndex ascending despite stub order.
  assert.deepEqual(
    data.annotations.map((a: { chapterIndex: number }) => a.chapterIndex),
    [1, 2],
  );
  const first = data.annotations[0];
  assert.equal(first.text, "first chapter highlight");
  assert.equal(first.note, null);
  // Trimmed shape: no cfi / jumpFileId / bookId / positionStatus.
  assert.ok(!("cfi" in first));
  assert.ok(!("jumpFileId" in first));
  assert.ok(!("positionStatus" in first));
});

test("get_annotations returns an empty list for an un-annotated book", async () => {
  const { call } = await setup();
  const { data } = await call("get_annotations", { bookId: 999 });
  assert.equal(data.annotationCount, 0);
  assert.deepEqual(data.annotations, []);
});

test("list_annotations passes pagination through and forwards bookId", async () => {
  const { call } = await setup();
  const all = await call("list_annotations", { pageSize: 5 });
  assert.equal(all.data.total, 2);
  assert.equal(all.data.pageSize, 5);
  assert.equal(all.data.stats.books, 2);
  assert.ok("bookTitle" in all.data.annotations[0]);

  const filtered = await call("list_annotations", { bookId: 400 });
  assert.equal(filtered.data.total, 1);
  assert.equal(filtered.data.annotations[0].bookId, 400);
});

test("get_related_books trims to bookId and carries series index", async () => {
  const { call } = await setup();
  const { data } = await call("get_related_books", { bookId: 115, kind: "same_series" });
  assert.equal(data.kind, "same_series");
  assert.equal(data.count, 1);
  const b = data.books[0];
  assert.equal(b.bookId, 116);
  assert.equal(b.seriesIndex, 2);
  assert.equal(b.isAudiobook, false);
  assert.ok(!("id" in b));
  assert.ok(!("hasCover" in b));
});

test("list_series passes pagination through and trims items", async () => {
  const { call } = await setup();
  const { data } = await call("list_series", { size: 10 });
  assert.equal(data.total, 34);
  assert.equal(data.size, 10);
  const s = data.series[0];
  assert.equal(s.seriesId, 387);
  assert.equal(s.bookCount, 3);
  assert.ok(!("coverBookIds" in s));
});

test("get_series_books shapes rich items and flags EPUB", async () => {
  const { call } = await setup();
  const { data } = await call("get_series_books", { seriesId: 387 });
  const b = data.books[0];
  assert.equal(b.bookId, 245);
  assert.equal(b.seriesIndex, 1);
  assert.equal(b.hasEpub, true);
  // Noise fields dropped.
  assert.ok(!("status" in b));
  assert.ok(!("files" in b));
  assert.ok(!("seriesMemberships" in b));
  assert.ok(!("language" in b));
});

test("list_authors is lean; get_author returns the bio", async () => {
  const { call } = await setup();
  const list = await call("list_authors", {});
  const a = list.data.authors[0];
  assert.equal(a.authorId, 192);
  assert.ok(!("description" in a));

  const detail = await call("get_author", { authorId: 192 });
  assert.equal(detail.data.authorId, 192);
  assert.equal(detail.data.description, "A biography of the author.");
});

test("get_author_books / get_collection_books / get_smart_scope_books share the item shape", async () => {
  const { call } = await setup();
  for (const [name, args] of [
    ["get_author_books", { authorId: 192 }],
    ["get_collection_books", { collectionId: 7 }],
    ["get_smart_scope_books", { scopeId: 3 }],
  ] as const) {
    const { data } = await call(name, args);
    assert.equal(data.books[0].bookId, 245, name);
    assert.equal(data.books[0].hasEpub, true, name);
    assert.ok(!("files" in data.books[0]), name);
  }
});

test("list_collections and list_smart_scopes pass shelves through with a count", async () => {
  const { call } = await setup();
  const cols = await call("list_collections", {});
  assert.equal(cols.data.count, 1);
  assert.equal(cols.data.collections[0].name, "Favorites");

  const scopes = await call("list_smart_scopes", {});
  assert.equal(scopes.data.count, 1);
  assert.equal(scopes.data.smartScopes[0].id, 3);
});

test("get_reading_progress drops kobo noise and includes audioProgress", async () => {
  const { call } = await setup();
  const { data } = await call("get_reading_progress", { bookId: 115 });
  const p = data.progress[0];
  assert.equal(p.percentage, 0.1);
  assert.equal(p.fileId, 69);
  assert.ok(!("koboLocationSource" in p));
  assert.ok(!("koboLocationType" in p));
  assert.equal(data.audioProgress, null);
});

test("list_currently_reading returns trimmed books with progress", async () => {
  const { call } = await setup();
  const { data } = await call("list_currently_reading", {});
  assert.equal(data.count, 1);
  assert.equal(data.books[0].bookId, 115);
  assert.equal(data.books[0].progress, 0.1);
  assert.ok(!("hasCover" in data.books[0]));
  assert.ok(!("fileId" in data.books[0]));
});

test("get_reading_sessions surfaces stats and pagination", async () => {
  const { call } = await setup();
  const { data } = await call("get_reading_sessions", { bookId: 115, pageSize: 5 });
  assert.equal(data.pageSize, 5);
  assert.equal(data.total, 0);
  assert.equal(data.stats.totalSessions, 0);
  assert.deepEqual(data.sessions, []);
});

test("get_library_stats and get_reading_stats pass summaries through", async () => {
  const { call } = await setup();
  const lib = await call("get_library_stats", {});
  assert.equal(lib.data.totalBooks, 170);
  assert.equal(lib.data.totalAuthors, 48);

  const reading = await call("get_reading_stats", {});
  assert.equal(reading.data.completedBooks, 1);
  assert.equal(reading.data.meanProgressPercent, 42);
});

test("suggest_metadata forwards kind + q and passes matches through", async () => {
  const { call } = await setup();
  const { data } = await call("suggest_metadata", { kind: "authors", q: "sand" });
  assert.equal(data.kind, "authors");
  assert.equal(data.q, "sand");
  assert.equal(data.matches.echoedKind, "authors");
  assert.equal(data.matches.echoedQ, "sand");
  assert.equal(data.matches.sample[0].name, "Author Name");
});

test("get_library_statistic forwards kind + libraryIds and wraps the passthrough", async () => {
  const { call } = await setup();
  const { data } = await call("get_library_statistic", {
    kind: "top-authors",
    libraryIds: [1, 2],
  });
  assert.equal(data.kind, "top-authors");
  assert.equal(data.data.echoedKind, "top-authors");
  assert.deepEqual(data.data.echoedOpts.libraryIds, [1, 2]);
});

test("get_reading_statistic forwards per-kind extras", async () => {
  const { call } = await setup();
  const { data } = await call("get_reading_statistic", {
    kind: "goal-trajectory",
    days: 365,
    goalBooks: 24,
  });
  assert.equal(data.kind, "goal-trajectory");
  assert.equal(data.data.echoedOpts.days, 365);
  assert.equal(data.data.echoedOpts.goalBooks, 24);
});

test("get_dashboard_widget forwards kind and wraps the passthrough", async () => {
  const { call } = await setup();
  const { data } = await call("get_dashboard_widget", { kind: "reading-streak" });
  assert.equal(data.kind, "reading-streak");
  assert.equal(data.data.echoedKind, "reading-streak");
  assert.equal(data.data.currentStreak, 5);
});

test("get_book_shelf shapes items and guards smart-scope without an id", async () => {
  const { call } = await setup();
  const { data } = await call("get_book_shelf", { type: "recently-added" });
  assert.equal(data.type, "recently-added");
  assert.equal(data.count, 1);
  assert.equal(data.books[0].bookId, 245);
  assert.equal(data.books[0].hasEpub, true);
  assert.ok(!("files" in data.books[0]));

  const bad = await call("get_book_shelf", { type: "smart-scope" });
  assert.equal(bad.res.isError, true);
  assert.match(bad.res.content[0].text, /smartScopeId/);
});

test("get_collection passes the collection through", async () => {
  const { call } = await setup();
  const { data } = await call("get_collection", { collectionId: 7 });
  assert.equal(data.id, 7);
  assert.equal(data.name, "Favorites");
});

test("search_author_metadata forwards q and passes candidates through", async () => {
  const { call } = await setup();
  const { data } = await call("search_author_metadata", { q: "tolkien", limit: 5 });
  assert.equal(data.q, "tolkien");
  assert.equal(data.candidates.echoedQ, "tolkien");
  assert.equal(data.candidates.echoedOpts.limit, 5);
  assert.equal(data.candidates.candidates[0].name, "J.R.R. Tolkien");
});

test("get_book_cover returns an image content block", async () => {
  const { call } = await setup();
  const { res, data } = await call("get_book_cover", { bookId: 327, size: "thumbnail" });
  assert.equal(data, null); // not text
  assert.equal(res.isError, undefined);
  const block = res.content[0];
  assert.equal(block.type, "image");
  assert.equal(block.mimeType, "image/jpeg");
  // base64 of [1,2] bytes.
  assert.equal(block.data, Buffer.from([1, 2]).toString("base64"));
});

test("get_author_image returns an image content block", async () => {
  const { call } = await setup();
  const { res } = await call("get_author_image", { authorId: 192 });
  const block = res.content[0];
  assert.equal(block.type, "image");
  assert.equal(block.mimeType, "image/png");
  assert.equal(block.data, Buffer.from([4, 5]).toString("base64"));
});

test("list_libraries trims config and attaches per-library stats", async () => {
  const { call } = await setup();
  const { data } = await call("list_libraries", {});
  assert.equal(data.count, 1);
  const lib = data.libraries[0];
  assert.equal(lib.libraryId, 1);
  assert.equal(lib.name, "eBooks");
  assert.ok(!("watch" in lib));
  assert.ok(!("organizationMode" in lib));
  assert.equal(lib.stats.totalBooks, 170);
  assert.equal(lib.stats.formatCounts.epub, 168);
});
