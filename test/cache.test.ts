import { test } from "node:test";
import assert from "node:assert/strict";
import { BookCache } from "../src/cache.js";
import type { ParsedBook } from "../src/types.js";

function parsed(bookId: number): ParsedBook {
  return { bookId, title: "Synthetic", author: "Fixture", sections: [], totalChars: 1 };
}

test("memory cache evicts beyond four books and isolates namespaces", async () => {
  const cache = new BookCache();
  const first = parsed(1);
  await cache.writeParsed(first, ["one"], "a");
  assert.equal(await cache.readParsed(1, "b"), null);
  assert.equal(await cache.readSectionText(1, 0, "b"), null);
  for (let id = 2; id <= 5; id++) await cache.writeParsed(parsed(id), ["x"], "a");
  assert.equal(await cache.readParsed(1, "a"), null);
  assert.ok(await cache.readParsed(5, "a"));
  await assert.rejects(cache.readSectionText(1, 0, "a", first), /cache changed/);
});

test("memory cache counts metadata and UTF-8 text bytes and rejects oversize entries", async () => {
  const book = parsed(1);
  const bytes = Buffer.byteLength(JSON.stringify(book)) + Buffer.byteLength("é");
  const exact = new BookCache(bytes);
  await exact.writeParsed(book, ["é"]);
  assert.equal(await exact.readSectionText(1, 0), "é");
  await exact.writeParsed(parsed(2), ["é"]);
  assert.equal(
    await exact.readParsed(1),
    null,
    "byte budget evicts before book-count cap",
  );
  const small = new BookCache(bytes - 1);
  await assert.rejects(small.writeParsed(book, ["é"]), /memory cache limit/);
  assert.equal(await small.readParsed(1), null);
});

test("section reads reject replacement parses instead of mixing editions", async () => {
  const cache = new BookCache();
  const old = parsed(1);
  await cache.writeParsed(old, ["old"]);
  await cache.writeParsed(parsed(1), ["new"]);
  await assert.rejects(cache.readSectionText(1, 0, "", old), /cache changed/);
  await cache.delete(1);
  assert.equal(await cache.readParsed(1), null);
});
