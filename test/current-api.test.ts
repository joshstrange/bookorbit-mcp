import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { BookOrbitClient } from "../src/bookorbit-client.js";
import { BookService } from "../src/book-service.js";
import { BookCache } from "../src/cache.js";
import { loadConfig } from "../src/config.js";

const info = JSON.parse(
  readFileSync(new URL("./fixtures/epub-info.json", import.meta.url), "utf8"),
);
const html = readFileSync(
  new URL("./fixtures/chapter-bundle.xhtml", import.meta.url),
  "utf8",
);
async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  handler: RequestListener,
) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("API key has priority; revocation never triggers login, refresh or static token fallback", async (t) => {
  const calls: string[] = [];
  const baseUrl = await fixture(t, (req, res) => {
    calls.push(req.url!);
    assert.equal(req.headers.authorization, "Bearer scoped-key");
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "scoped-key password private-title" }));
  });
  const client = new BookOrbitClient({
    baseUrl,
    apiKey: "scoped-key",
    token: "old",
    username: "admin",
    password: "password",
  });
  await assert.rejects(
    client.searchBooks("private-query"),
    (err: Error) =>
      !/scoped-key|password|private-title|private-query/.test(err.message) &&
      /revocation/.test(err.message),
  );
  assert.deepEqual(calls, ["/api/v1/books/search?q=private-query"]);
  const config = loadConfig({
    BOOKORBIT_URL: baseUrl,
    BOOKORBIT_API_KEY: "scoped-key",
    BOOKORBIT_USERNAME: "admin",
    BOOKORBIT_PASSWORD: "password",
  });
  assert.equal(config.client.username, undefined);
  assert.throws(
    () =>
      loadConfig({
        BOOKORBIT_URL: baseUrl,
        BOOKORBIT_API_KEY: "",
        BOOKORBIT_AUTH_MODE: "password",
        BOOKORBIT_USERNAME: "u",
        BOOKORBIT_PASSWORD: "p",
      }),
    /empty/,
  );
  assert.throws(
    () =>
      loadConfig({
        BOOKORBIT_URL: baseUrl,
        BOOKORBIT_USERNAME: "u",
        BOOKORBIT_PASSWORD: "p",
      }),
    /explicit legacy/,
  );
  assert.equal(
    loadConfig({
      BOOKORBIT_URL: baseUrl,
      BOOKORBIT_AUTH_MODE: "password",
      BOOKORBIT_USERNAME: "u",
      BOOKORBIT_PASSWORD: "p",
    }).client.username,
    "u",
  );
});

test("current catalog read-safe POST accepts 201 with nested zero-based pagination; annotations remain one-based", async (t) => {
  const calls: string[] = [];
  const baseUrl = await fixture(t, (req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.method === "POST") {
      let body = "";
      req.on("data", (b) => (body += b));
      req.on("end", () => {
        assert.deepEqual(JSON.parse(body), {
          q: "synthetic",
          pagination: { page: 0, size: 2 },
        });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            items: [{ id: 1, authors: [], files: [] }],
            total: 1,
            page: 0,
            size: 2,
          }),
        );
      });
    } else {
      res.end(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 2 }));
    }
  });
  const client = new BookOrbitClient({ baseUrl, apiKey: "key" });
  const page = await client.queryBooks({ q: "synthetic", page: 0, size: 2 });
  assert.equal(page.items[0].id, 1);
  assert.equal(page.page, 0);
  await client.listAnnotations({ page: 1, pageSize: 2 });
  await assert.rejects(client.listAnnotations({ page: 0 }), /one-based/);
  await assert.rejects(client.queryBooks({ page: -1 }), /pagination/);
  assert.deepEqual(calls, [
    "POST /api/v1/books/query",
    "GET /api/v1/annotations?page=1&pageSize=2",
  ]);
});

test("transport bounds advertised and streamed bodies, refuses redirects, and times out mid-body", async (t) => {
  let redirected = false;
  const baseUrl = await fixture(t, (req, res) => {
    if (req.url!.includes("redirect-target")) {
      redirected = true;
      res.end("[]");
    } else if (req.url!.includes("redirect")) {
      res.writeHead(302, { Location: "/redirect-target" });
      res.end();
    } else if (req.url!.includes("advertised")) {
      res.writeHead(200, { "Content-Length": "10000" });
      res.end("[]");
    } else if (req.url!.includes("streamed")) {
      res.writeHead(200);
      res.write("x".repeat(200));
      res.end();
    } else {
      res.writeHead(200);
      res.write("[");
    }
  });
  const client = new BookOrbitClient({
    baseUrl,
    apiKey: "key",
    maxResponseBytes: 100,
    timeoutMs: 100,
  });
  await assert.rejects(client.searchBooks("advertised"), /byte limit/);
  await assert.rejects(client.searchBooks("streamed"), /byte limit/);
  await assert.rejects(client.searchBooks("redirect"), /redirect/i);
  assert.equal(redirected, false);
  await assert.rejects(client.searchBooks("stall"), /timed out/);
});

test("real service revalidates cache authorization/version, pins fileId, bounds concurrency and isolates clients", async (t) => {
  let status = 200;
  let version = "v1";
  let active = 0;
  let maxActive = 0;
  let fileFetches = 0;
  let metadataReads = 0;
  const baseUrl = await fixture(t, (req, res) => {
    if (status !== 200) {
      res.writeHead(status);
      res.end("denied");
      return;
    }
    if (req.url!.startsWith("/api/v1/books/")) {
      metadataReads++;
      res.end(
        JSON.stringify({
          id: 1,
          authors: [{ id: 2, name: "Synthetic Author" }],
          files: [{ id: 7, format: "epub", contentVersion: version }],
        }),
      );
    } else if (req.url!.includes("/info")) {
      assert.ok(req.url!.endsWith("?fileId=7"));
      res.end(JSON.stringify(info));
    } else {
      assert.ok(req.url!.endsWith("?fileId=7"));
      fileFetches++;
      active++;
      maxActive = Math.max(active, maxActive);
      setTimeout(() => {
        active--;
        res.end(html);
      }, 10);
    }
  });
  const client = new BookOrbitClient({ baseUrl, apiKey: "key" });
  assert.deepEqual((await client.getBook(1)).authors, ["Synthetic Author"]);
  const cache = new BookCache();
  const service = new BookService(client, cache);
  const parsed = await service.getParsedBook(1);
  assert.equal(parsed.fileId, 7);
  const initial = fileFetches;
  assert.ok(initial > 0 && maxActive <= 3);
  const reads = metadataReads;
  assert.ok((await service.getSectionText(1, 0)).length > 0);
  assert.equal(fileFetches, initial);
  assert.ok(metadataReads > reads);
  version = "v2";
  await service.getParsedBook(1);
  assert.equal(fileFetches, initial * 2);
  for (const denial of [401, 403, 404, 500]) {
    status = denial;
    await assert.rejects(service.getSectionText(1, 0));
    await assert.rejects(service.searchInBook(1, "the"));
  }
  status = 200;
  await service.getParsedBook(1);
  assert.equal(fileFetches, initial * 3, "denials purge old cached content");
  const other = new BookService(new BookOrbitClient({ baseUrl, apiKey: "other" }), cache);
  await other.getParsedBook(1);
  assert.equal(
    fileFetches,
    initial * 4,
    "same bookId never shares content across client instances",
  );
  const hits = await service.searchInBook(1, "the", 2);
  assert.ok(hits.every((h) => h.fileId === 7 && h.spineHref && h.snippet.length < 400));
});

test("invalid credential header diagnostics never echo the selected credential", async () => {
  const secret = "private-key\nnot-a-header";
  const client = new BookOrbitClient({
    baseUrl: "https://example.invalid",
    apiKey: secret,
  });
  await assert.rejects(
    client.searchBooks("x"),
    (err: Error) =>
      /Invalid credential header/.test(err.message) &&
      !err.message.includes("private-key"),
  );
});

test("permission-gated routes return explicit errors, not fabricated empty data", async (t) => {
  const baseUrl = await fixture(t, (_req, res) => {
    res.writeHead(403);
    res.end("private error");
  });
  const client = new BookOrbitClient({ baseUrl, apiKey: "key" });
  await assert.rejects(client.listCurrentlyReading(), /App Attest/);
  await assert.rejects(client.getDashboardWidget("reading-streak"), /Access denied/);
});

test("current shelf envelope and read-safe smart-scope POST use actual client paths", async (t) => {
  const calls: string[] = [];
  const baseUrl = await fixture(t, (req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        assert.deepEqual(JSON.parse(body), {
          q: "synthetic",
          sort: [],
          pagination: { page: 0, size: 2 },
        });
        res.writeHead(201);
        res.end(JSON.stringify({ items: [], total: 0, page: 0, size: 2 }));
      });
    } else
      res.end(JSON.stringify({ books: [{ id: 1, authors: [], files: [] }], total: 7 }));
  });
  const client = new BookOrbitClient({ baseUrl, apiKey: "key" });
  assert.equal((await client.getBookShelf("recently-added", { limit: 2 }))[0].id, 1);
  assert.equal(
    (await client.getSmartScopeBooks(3, { q: "synthetic", page: 0, size: 2 })).page,
    0,
  );
  assert.deepEqual(calls, [
    "GET /api/v1/dashboard/scrollers/recently-added?limit=2",
    "POST /api/v1/smart-scopes/3/books/query",
  ]);
});

test("service deduplicates concurrent same-edition builds and rebuilds unversioned content", async (t) => {
  let versioned = true;
  let files = 0;
  const baseUrl = await fixture(t, (req, res) => {
    if (req.url!.startsWith("/api/v1/books/"))
      res.end(
        JSON.stringify({
          authors: [],
          files: [
            { id: 7, format: "epub", ...(versioned ? { contentVersion: "v1" } : {}) },
          ],
        }),
      );
    else if (req.url!.includes("/info")) res.end(JSON.stringify(info));
    else {
      files++;
      setTimeout(() => res.end(html), 10);
    }
  });
  const service = new BookService(
    new BookOrbitClient({ baseUrl, apiKey: "key" }),
    new BookCache(),
  );
  const [first, second] = await Promise.all([
    service.getParsedBook(1),
    service.getParsedBook(1),
  ]);
  assert.equal(first, second);
  const afterBuild = files;
  await service.getParsedBook(1);
  assert.equal(files, afterBuild);
  versioned = false;
  await service.getParsedBook(1);
  await service.getParsedBook(1);
  assert.equal(files, afterBuild * 3);
  await assert.rejects(service.searchInBook(1, "x".repeat(501)), /query characters/);
});
