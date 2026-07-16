/**
 * Live end-to-end smoke test against the real Book Orbit server.
 * Uses credentials from .env. Run: node --import tsx scripts/smoke.mts
 * Not part of the unit suite (hits the network).
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { BookOrbitClient } from "../src/bookorbit-client.js";
import { BookCache } from "../src/cache.js";
import { BookService } from "../src/book-service.js";

const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) (process as any).loadEnvFile?.(envPath);

const config = loadConfig();
const client = new BookOrbitClient(config.client);
const cacheDir = await mkdtemp(join(tmpdir(), "bookorbit-smoke-"));
const service = new BookService(client, new BookCache(cacheDir));

console.log("1) search_books('Absolution')");
const results = await client.searchBooks("Absolution", 3);
console.log(results.map((b) => ({ id: b.id, title: b.title, formats: b.formats })));
const book = results.find((b) => b.formats?.includes("epub")) ?? results[0];
if (!book) throw new Error("no book found");

console.log(`\n2) list_chapters (build+cache) for bookId=${book.id}`);
const t0 = Date.now();
const parsed = await service.getParsedBook(book.id);
console.log(`   title=${parsed.title} author=${parsed.author}`);
console.log(
  `   chapters=${parsed.sections.length} totalChars=${parsed.totalChars} in ${Date.now() - t0}ms`,
);
console.log("   first 8 chapters:");
for (const s of parsed.sections.slice(0, 8)) {
  console.log(
    `     [${s.index}] ${s.label}  (${s.charCount} chars, ${s.wordCount} words)`,
  );
}

const biggest = parsed.sections.reduce((a, b) => (b.charCount > a.charCount ? b : a));
console.log(
  `\n3) get_chapter chapter=${biggest.index} ('${biggest.label}') first 300 chars:`,
);
const text = await service.getSectionText(book.id, biggest.index);
console.log("   " + JSON.stringify(text.slice(0, 300)));

const term = "Area X";
console.log(`\n4) search_in_book('${term}')`);
const hits = await service.searchInBook(book.id, term, 5);
console.log(`   ${hits.length} hits`);
for (const h of hits) {
  console.log(
    `     ch${h.sectionIndex} @${h.charOffset} (${h.approxBookPercent}%): ${h.snippet.slice(0, 120)}`,
  );
}

console.log("\n5) cache hit (no rebuild):");
const t1 = Date.now();
await service.getParsedBook(book.id);
console.log(`   re-read in ${Date.now() - t1}ms`);

console.log("\nSMOKE OK");
