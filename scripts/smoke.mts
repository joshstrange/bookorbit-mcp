/** Read-only live check. Emits counts/status only, never titles, excerpts or credentials. */
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { BookOrbitClient } from "../src/bookorbit-client.js";
import { BookService } from "../src/book-service.js";
import { BookCache } from "../src/cache.js";

const client = new BookOrbitClient(loadConfig().client);
const info = (await client.getAppInfo()) as { version: string };
assert.equal(typeof info.version, "string");
console.log(JSON.stringify({ check: "app-info", version: info.version }));
const page = await client.queryBooks({ page: 0, size: 10 });
assert.equal(page.page, 0);
assert.ok(page.items.length <= 10 && page.total >= page.items.length);
console.log(
  JSON.stringify({
    check: "catalog",
    count: page.items.length,
    total: page.total,
    page: page.page,
  }),
);
const bookId =
  Number(process.env.BOOKORBIT_CHECK_BOOK_ID) ||
  page.items.find((b) => b.files?.some((f) => f.format?.toLowerCase() === "epub"))?.id;
assert.ok(bookId, "Choose an EPUB book with BOOKORBIT_CHECK_BOOK_ID.");
const service = new BookService(client, new BookCache());
const parsed = await service.getParsedBook(bookId);
assert.ok(parsed.sections.length > 0 && parsed.totalChars > 0);
const text = await service.getSectionText(
  bookId,
  parsed.sections.find((s) => s.charCount > 0)!.index,
);
assert.ok(text.length > 0);
const hits = await service.searchInBook(bookId, text.slice(0, 12), 2);
assert.ok(hits.length > 0 && hits.length <= 2);
await service.getParsedBook(bookId);
console.log(
  JSON.stringify({
    check: "reader-and-revalidated-cache",
    bookId,
    fileId: parsed.fileId,
    chapters: parsed.sections.length,
    totalChars: parsed.totalChars,
    hits: hits.length,
  }),
);
console.log("SMOKE OK");
