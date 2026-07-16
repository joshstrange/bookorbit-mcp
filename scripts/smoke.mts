/**
 * Live end-to-end smoke test against the real BookOrbit server.
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

console.log("\n6) discovery & browse");
const series = await client.listSeries({ size: 3 });
console.log(`   series: ${series.total} total; first: ${series.items[0]?.name}`);
if (series.items[0]) {
  const seriesBooks = await client.getSeriesBooks(series.items[0].id, { size: 3 });
  console.log(
    `   series-books[${series.items[0].id}]: ${seriesBooks.items
      .map((b) => `${b.title}#${b.seriesIndex}`)
      .join(", ")}`,
  );
}
const authors = await client.listAuthors({ size: 3 });
console.log(`   authors: ${authors.total} total; first: ${authors.items[0]?.name}`);
if (authors.items[0]) {
  const author = await client.getAuthor(authors.items[0].id);
  console.log(`   author bio: ${(author.description ?? "(none)").slice(0, 80)}...`);
}
const collections = await client.listCollections();
const scopes = await client.listSmartScopes();
console.log(`   collections: ${collections.length}; smart scopes: ${scopes.length}`);

console.log(`\n7) related books for bookId=${book.id}`);
for (const kind of ["similar", "same_series", "same_author"] as const) {
  const related = await client.getRelatedBooks(book.id, kind);
  console.log(`   ${kind}: ${related.length} (e.g. ${related[0]?.title ?? "-"})`);
}

console.log(`\n8) reading state for bookId=${book.id}`);
const progress = await client.getReadingProgress(book.id);
console.log(
  `   progress: ${progress.map((p) => `${Math.round((p.percentage ?? 0) * 100)}%`).join(", ") || "(none)"}`,
);
const reading = await client.listCurrentlyReading();
console.log(`   currently reading: ${reading.books?.length ?? 0} book(s)`);
const sessions = await client.getReadingSessions(book.id, { pageSize: 3 });
console.log(
  `   sessions: ${sessions.stats.totalSessions} total, ${sessions.stats.totalSeconds}s read`,
);

console.log("\n9) statistics & libraries");
const stats = await client.getStatisticsSummary();
console.log(
  `   library: ${stats.totalBooks} books, ${stats.totalAuthors} authors, ${stats.totalSeries} series`,
);
const userStats = await client.getUserStatisticsSummary();
console.log(
  `   reading: ${userStats.completedBooks}/${userStats.trackedBooks} completed, mean ${userStats.meanProgressPercent}%`,
);
const libraries = await client.listLibraries();
for (const lib of libraries) {
  const ls = await client.getLibraryStats(lib.id);
  console.log(`   library "${lib.name}": ${ls.totalBooks} books`);
}

console.log("\n10) metadata typeahead (suggest_metadata)");
for (const kind of ["authors", "genres"] as const) {
  const matches = (await client.suggestMetadata(kind, "a")) as Array<{ name: string }>;
  console.log(
    `   ${kind}?q=a → ${matches.length} match(es)` +
      (matches[0] ? `, e.g. "${matches[0].name}"` : ""),
  );
}

console.log("\n11) library statistic (get_library_statistic)");
const topAuthors = (await client.getLibraryStatistic("top-authors")) as {
  items: Array<{ name: string; count: number }>;
};
console.log(
  `   top-authors → ${topAuthors.items.length} rows` +
    (topAuthors.items[0]
      ? `, top: "${topAuthors.items[0].name}" (${topAuthors.items[0].count})`
      : ""),
);
const formats = (await client.getLibraryStatistic("format-distribution")) as {
  items: Array<{ format: string; count: number }>;
};
console.log(
  `   format-distribution → ${formats.items.map((i) => `${i.format}:${i.count}`).join(", ")}`,
);

console.log("\n12) reading statistic (get_reading_statistic)");
const peak = (await client.getUserStatistic("peak-hours", { days: 365 })) as Array<{
  hour: number;
  readingSeconds: number;
}>;
const busiest = peak.reduce(
  (a, b) => (b.readingSeconds > a.readingSeconds ? b : a),
  peak[0],
);
console.log(
  `   peak-hours → ${peak.length} hours` +
    (busiest ? `, busiest hour ${busiest.hour} (${busiest.readingSeconds}s)` : ""),
);
const goal = (await client.getUserStatistic("goal-trajectory", { goalBooks: 24 })) as {
  goalBooks: number;
  points: unknown[];
};
console.log(`   goal-trajectory (24/yr) → ${goal.points.length} monthly points`);

console.log("\nSMOKE OK");
