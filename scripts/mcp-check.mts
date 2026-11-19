/** Built-server read-only stdio qualification. Logs structural evidence, never book text/titles. */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BookOrbitClient } from "../src/bookorbit-client.js";
import { loadConfig } from "../src/config.js";

const upstream = new BookOrbitClient(loadConfig().client);
const info = (await upstream.getAppInfo()) as { version: string };
console.log(JSON.stringify({ check: "app-info", version: info.version }));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k, v]) => !k.startsWith("OP_") && v !== undefined),
) as Record<string, string>;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/server.js"],
  env,
  stderr: "pipe",
});
// Never relay arbitrary server stderr from a credential-bearing process.
transport.stderr?.resume();
const client = new Client({ name: "bookorbit-qualification", version: "0.1.0" });
const deadline = setTimeout(() => {
  console.error("MCP check exceeded 180s deadline.");
  void transport.close().finally(() => process.exit(1));
}, 180_000);
let failures = 0;
let passed = 0;
let denied = 0;
const call = async (
  name: string,
  args: Record<string, unknown> = {},
  expectedDenied = false,
) => {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 90_000,
  });
  const blocks = result.content as Array<{ type: string; text?: string; data?: string }>;
  if (result.isError) {
    // Only classify safe HTTP status, do not retain returned messages/data.
    const status =
      /BookOrbit error \((\d+)\)/.exec(blocks[0]?.text ?? "")?.[1] ?? "unknown";
    const reason =
      /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UND_ERR_CONNECT_TIMEOUT|timed out/.exec(
        blocks[0]?.text ?? "",
      )?.[0] ?? null;
    console.log(
      JSON.stringify({ tool: name, outcome: "error", status, reason, expectedDenied }),
    );
    if (expectedDenied && status === "403") denied++;
    else failures++;
    return null;
  }
  assert.ok(!expectedDenied, "Expected a denied App Attest route.");
  passed++;
  if (blocks[0]?.type === "image") {
    assert.ok(blocks[0].data!.length > 0);
    console.log(
      JSON.stringify({
        tool: name,
        outcome: "image",
        base64Chars: blocks[0].data!.length,
      }),
    );
    return null;
  }
  const data = JSON.parse(blocks[0].text!);
  console.log(
    JSON.stringify({
      tool: name,
      outcome: "ok",
      count: Array.isArray(data)
        ? data.length
        : (data.count ?? data.total ?? data.chapterCount ?? data.hitCount ?? null),
    }),
  );
  return data;
};
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "browse_books"));
  console.log(JSON.stringify({ check: "listTools", count: tools.length }));
  const catalog = await call("browse_books", { page: 0, size: 10 });
  assert.ok(catalog && catalog.page === 0 && catalog.items.length <= 10);
  const bookId =
    Number(process.env.BOOKORBIT_CHECK_BOOK_ID) ||
    catalog.items.find((b: { hasEpub: boolean }) => b.hasEpub)?.bookId;
  assert.ok(bookId, "Select an EPUB with BOOKORBIT_CHECK_BOOK_ID.");
  console.log(JSON.stringify({ check: "selected", bookId }));
  await call("search_books", { query: "a", limit: 2 });
  await call("get_book", { bookId });
  const toc = await call("list_chapters", { bookId });
  if (toc) {
    assert.ok(
      toc.chapters.length === toc.chapterCount &&
        toc.chapters.every((c: object) => !("text" in c)),
    );
    const chapter = toc.chapters.find(
      (c: { charCount: number }) => c.charCount > 0,
    ).chapter;
    const text = await call("get_chapter", { bookId, chapter, maxChars: 120 });
    assert.ok(
      text &&
        text.text.length > 0 &&
        text.text.length <= 120 &&
        text.fileId &&
        text.spineHref,
    );
    const hits = await call("search_in_book", {
      bookId,
      query: text.text.slice(0, 12),
      maxResults: 2,
    });
    assert.ok(hits && hits.hitCount > 0 && hits.hitCount <= 2);
    await call("list_chapters", { bookId });
  }
  for (const name of [
    "list_libraries",
    "list_collections",
    "list_smart_scopes",
    "list_annotated_books",
    "get_library_stats",
    "get_reading_stats",
  ])
    await call(name);
  await call("list_annotations", { page: 1, pageSize: 2 });
  await call("get_annotations", { bookId });
  await call("get_reading_progress", { bookId });
  await call("get_reading_sessions", { bookId, page: 1, pageSize: 2 });
  const series = await call("list_series", { page: 0, size: 2 });
  if (series?.series[0])
    await call("get_series_books", {
      seriesId: series.series[0].seriesId,
      page: 0,
      size: 2,
    });
  const authors = await call("list_authors", { page: 0, size: 2 });
  if (authors?.authors[0]) {
    await call("get_author", { authorId: authors.authors[0].authorId });
    await call("get_author_books", {
      authorId: authors.authors[0].authorId,
      page: 0,
      size: 2,
    });
  }
  for (const kind of ["similar", "same_series", "same_author"])
    await call("get_related_books", { bookId, kind });
  await call("suggest_metadata", { kind: "authors", q: "a" });
  await call("get_library_statistic", { kind: "top-authors" });
  await call("get_reading_statistic", { kind: "peak-hours", days: 30 });
  await call("get_dashboard_widget", { kind: "library-overview" });
  await call("get_book_shelf", { type: "recently-added", limit: 2 });
  await call("get_book_cover", { bookId, size: "thumbnail" });
  await call("list_currently_reading", {}, true);
  await call("get_dashboard_widget", { kind: "reading-streak" }, true);
  console.log(JSON.stringify({ check: "summary", passed, denied, failures }));
  if (failures) process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await client.close();
  await transport.close();
}
