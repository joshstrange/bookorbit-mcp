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
  content: Array<{ type: string; text: string }>;
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
    return { res, data: res.isError ? null : JSON.parse(res.content[0].text) };
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
  } as unknown as BookOrbitClient;
  return client;
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
