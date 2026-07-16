import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BookCache } from "../src/cache.js";
import { BookService } from "../src/book-service.js";
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

/** A stub client that serves the fixture info and returns XHTML per file. */
function stubClient(): { client: BookOrbitClient; fileFetches: string[] } {
  const fileFetches: string[] = [];
  const client = {
    async getEpubInfo() {
      return info;
    },
    async getEpubFile(_bookId: number, path: string) {
      fileFetches.push(path);
      // Serve the bundled chapter for its file; a stub for the rest.
      if (path.endsWith("bundle.xhtml")) return chapterXhtml;
      return `<html><body><p>Content of ${path}</p></body></html>`;
    },
  } as unknown as BookOrbitClient;
  return { client, fileFetches };
}

async function freshService() {
  const dir = await mkdtemp(join(tmpdir(), "bookorbit-test-"));
  const cache = new BookCache(dir);
  const { client, fileFetches } = stubClient();
  return { dir, cache, service: new BookService(client, cache), fileFetches };
}

test("parses, measures, and caches a book on first access", async () => {
  const { dir, service } = await freshService();
  const parsed = await service.getParsedBook(327);

  assert.equal(parsed.title, "Sample Book");
  assert.equal(parsed.author, "Test Author");
  assert.ok(parsed.sections.length >= 10);
  assert.ok(parsed.totalChars > 0);
  // Sizes are populated.
  assert.ok(parsed.sections.every((s) => s.charCount >= 0));
  assert.ok(parsed.sections.some((s) => /Arrival/i.test(s.label)));

  // Cache files were written.
  const meta = JSON.parse(await readFile(join(dir, "327", "book.json"), "utf8"));
  assert.equal(meta.bookId, 327);
  const section0 = await readFile(join(dir, "327", "text", "section-000.txt"), "utf8");
  assert.ok(section0.length >= 0);
});

test("second access reads from cache without refetching files", async () => {
  const { service, fileFetches } = await freshService();
  await service.getParsedBook(327);
  const countAfterBuild = fileFetches.length;
  assert.ok(countAfterBuild > 0);
  await service.getParsedBook(327);
  assert.equal(fileFetches.length, countAfterBuild, "no additional fetches on cache hit");
});

test("fetches each spine file only once even when bundled", async () => {
  const { service, fileFetches } = await freshService();
  await service.getParsedBook(327);
  const unique = new Set(fileFetches);
  assert.equal(unique.size, fileFetches.length, "no duplicate file fetches");
});

test("getSectionText returns distinct text for bundled chapters", async () => {
  const { service } = await freshService();
  const parsed = await service.getParsedBook(327);
  const bundled = parsed.sections.filter((s) => s.spineHref.endsWith("bundle.xhtml"));
  const first = await service.getSectionText(327, bundled[0].index);
  const second = await service.getSectionText(327, bundled[1].index);
  assert.ok(first.length > 100);
  assert.ok(second.length > 100);
  assert.notEqual(first.slice(0, 100), second.slice(0, 100));
});

test("searchInBook returns hits with locations and percentages", async () => {
  const { service } = await freshService();
  const hits = await service.searchInBook(327, "the", 5);
  assert.ok(hits.length > 0 && hits.length <= 5);
  for (const h of hits) {
    assert.ok(h.snippet.length > 0);
    assert.ok(h.charOffset >= 0);
    assert.ok(h.approxBookPercent >= 0 && h.approxBookPercent <= 100);
    assert.match(h.snippet, /the/i);
  }
});
