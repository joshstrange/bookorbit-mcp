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
