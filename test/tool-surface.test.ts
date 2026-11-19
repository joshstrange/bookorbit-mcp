import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Synthetic endpoint fixtures only. Unknown routes fail rather than silently returning {}.
const book = {
  id: 1,
  title: "Synthetic book",
  authors: [{ id: 2, name: "Synthetic author" }],
  files: [{ id: 7, format: "epub", contentVersion: "v1" }],
};
const page = { items: [], total: 0, page: 0, size: 20 };
const calls: Record<string, Record<string, unknown>> = {
  search_books: { query: "synthetic", limit: 2 },
  browse_books: {},
  get_book: { bookId: 1 },
  list_chapters: { bookId: 1 },
  get_chapter: { bookId: 1, chapter: 0, maxChars: 10 },
  search_in_book: { bookId: 1, query: "synthetic", maxResults: 2 },
  list_annotations: {},
  list_annotated_books: {},
  get_annotations: { bookId: 1 },
  get_related_books: { bookId: 1, kind: "similar" },
  list_series: {},
  get_series_books: { seriesId: 3 },
  list_authors: {},
  get_author: { authorId: 2 },
  get_author_books: { authorId: 2 },
  list_collections: {},
  get_collection: { collectionId: 4 },
  get_collection_books: { collectionId: 4 },
  list_smart_scopes: {},
  get_smart_scope_books: { scopeId: 5 },
  list_libraries: {},
  get_reading_progress: { bookId: 1 },
  list_currently_reading: {},
  get_reading_sessions: { bookId: 1 },
  get_library_stats: {},
  get_reading_stats: {},
  get_library_statistic: { kind: "top-authors" },
  get_reading_statistic: { kind: "peak-hours", days: 30 },
  suggest_metadata: { kind: "authors", q: "synthetic" },
  get_dashboard_widget: { kind: "library-overview" },
  get_book_shelf: { type: "recently-added", limit: 2 },
  search_author_metadata: { q: "synthetic" },
  get_book_cover: { bookId: 1, size: "thumbnail" },
  get_author_image: { authorId: 2, size: "thumbnail" },
};

test("stdio discovers and calls exactly the 34 read tools with current default pagination", async (t) => {
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-surface-key");
    const url = new URL(req.url!, "http://localhost");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    requests.push(`${req.method} ${path}`);
    const send = (value: unknown) => res.end(JSON.stringify(value));
    if (req.method === "POST") {
      assert.ok(["/books/query", "/smart-scopes/5/books/query"].includes(path));
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.equal(JSON.parse(body).pagination.page, 0);
      res.writeHead(201);
      send(page);
    } else if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
    } else if (path === "/books/1") send(book);
    else if (path === "/epub/1/info") {
      assert.equal(url.searchParams.get("fileId"), "7");
      send({
        metadata: { title: "Synthetic book", creator: "Synthetic author" },
        toc: { label: "root", children: [] },
        spine: [{ idref: "one", href: "one.xhtml" }],
      });
    } else if (path === "/epub/1/file/one.xhtml") {
      assert.equal(url.searchParams.get("fileId"), "7");
      res.end("<html><body><p>Synthetic chapter text.</p></body></html>");
    } else if (["/books/1/thumbnail", "/authors/2/thumbnail"].includes(path)) {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=",
          "base64",
        ),
      );
    } else if (path === "/annotations")
      send({ items: [], total: 0, page: 1, pageSize: 50 });
    else if (path === "/books/1/sessions")
      send({ items: [], total: 0, page: 1, pageSize: 20 });
    else if (
      [
        "/series",
        "/authors",
        "/series/3/books",
        "/authors/2/books",
        "/collections/4/books",
      ].includes(path)
    ) {
      if (path === "/collections/4/books")
        assert.equal(url.searchParams.get("page"), "0");
      send(page);
    } else if (path === "/authors/2") send({ id: 2, name: "Synthetic author" });
    else if (path === "/collections/4") send({ id: 4, name: "Synthetic collection" });
    else if (path === "/dashboard/scrollers/recently-added")
      send({ books: [], total: 0 });
    else if (path === "/dashboard/widgets/currently-reading") {
      res.writeHead(403);
      send({ message: "Synthetic App Attest denial" });
    } else if (
      [
        "/statistics/summary",
        "/user-statistics/summary",
        "/statistics/top-authors",
        "/user-statistics/peak-hours",
        "/dashboard/widgets/library-overview",
      ].includes(path)
    )
      send({});
    else if (
      [
        "/books/search",
        "/annotations/books",
        "/books/1/annotations",
        "/books/1/recommendations",
        "/collections",
        "/smart-scopes",
        "/libraries",
        "/books/1/progress",
        "/books/1/audio-progress",
        "/metadata/authors",
        "/authors/metadata/search",
      ].includes(path)
    )
      send([]);
    else {
      res.writeHead(404);
      send({ message: "Unknown synthetic route" });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args:
      process.env.BOOKORBIT_TEST_BUILT === "1"
        ? ["dist/server.js"]
        : ["--import", "tsx", "src/server.ts"],
    env: {
      PATH: process.env.PATH!,
      BOOKORBIT_URL: `http://127.0.0.1:${address.port}`,
      BOOKORBIT_API_KEY: "synthetic-surface-key",
    },
    stderr: "pipe",
  });
  transport.stderr?.resume();
  const client = new Client({ name: "offline-tool-surface", version: "1" });
  t.after(async () => {
    await client.close();
    await transport.close();
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 34);
  assert.deepEqual(tools.map((tool) => tool.name).sort(), Object.keys(calls).sort());
  for (const [name, args] of Object.entries(calls)) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(Boolean(result.isError), name === "list_currently_reading", name);
    const blocks = result.content as Array<{
      type: string;
      text?: string;
      data?: string;
    }>;
    if (["get_book_cover", "get_author_image"].includes(name)) {
      assert.equal(blocks[0].type, "image");
      assert.ok(blocks[0].data);
    } else if (name !== "list_currently_reading") {
      assert.equal(blocks[0].type, "text");
      const data = JSON.parse(blocks[0].text!);
      if (name === "get_chapter") assert.equal(data.returnedChars, 10);
      if (name === "list_chapters")
        assert.ok(data.chapters.every((c: object) => !("text" in c)));
    } else assert.match(blocks[0].text!, /403/);
  }
  assert.ok(
    requests.every(
      (r) =>
        r.startsWith("GET ") ||
        r === "POST /books/query" ||
        r === "POST /smart-scopes/5/books/query",
    ),
  );
});
