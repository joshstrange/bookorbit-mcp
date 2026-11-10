import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BookOrbitClient } from "../src/bookorbit-client.js";
import { BookCache } from "../src/cache.js";
import { BookService } from "../src/book-service.js";
import { registerTools } from "../src/tools.js";
import { httpHandler } from "../src/http.js";
import { parsePdf } from "../src/pdf-text.js";
import { callbackCode, validateRedirect } from "../src/native-login.js";
import { SessionStore } from "../src/session.js";

const pdf = await readFile(new URL("./fixtures/outline.pdf", import.meta.url));

test("real PDF extraction preserves outline ranges, complete text and blank-page OCR signals", async () => {
  const { parsed, texts } = await parsePdf(pdf, 7, "Sample", "Writer");
  assert.deepEqual(
    parsed.sections.map((s) => [s.label, s.pageStart, s.pageEnd]),
    [
      ["One", 1, 1],
      ["Two", 2, 3],
    ],
  );
  assert.deepEqual(parsed.requiresOcrPages, [3]);
  assert.match(texts[0], /Chapter One: A book without inference\./);
  assert.match(texts[1], /Chapter Two: Notes remain in the reader\./);
  assert.match(texts[1], /\[Page 3\]/);
  assert.equal(
    parsed.totalChars,
    texts.reduce((n, t) => n + t.length, 0),
  );
});

test("native SSO callback accepts only the existing marked HTTPS callback and exact state", () => {
  assert.equal(
    validateRedirect(
      "https://books.example",
      "https://books.example/oauth2-callback?bookorbit_mcp=1",
    ).hostname,
    "books.example",
  );
  for (const raw of [
    "https://evil.example/oauth2-callback?bookorbit_mcp=1",
    "http://books.example/oauth2-callback?bookorbit_mcp=1",
    "https://books.example/oauth2-callback",
    "https://books.example/mcp?bookorbit_mcp=1",
  ])
    assert.throws(() => validateRedirect("https://books.example", raw));
  assert.equal(
    callbackCode(
      new URL("https://books.example/oauth2-callback?state=expected&code=one"),
      "expected",
    ),
    "one",
  );
  for (const query of [
    "state=wrong&code=x",
    "state=expected&state=wrong&code=x",
    "state=expected&code=x&code=y",
    "state=expected&error=denied",
  ])
    assert.throws(() =>
      callbackCode(new URL(`https://books.example/?${query}`), "expected"),
    );
});

test("rotated native sessions survive restart privately, and concurrent 401s refresh once", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bookorbit-session-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new SessionStore(join(dir, "session.json"), "https://books.example");
  const initial = {
    baseUrl: "https://books.example",
    userId: 1,
    accessToken: "expired",
    refreshToken: "a".repeat(64),
  };
  await store.save(initial);
  let refreshes = 0;
  const client = new BookOrbitClient({
    baseUrl: initial.baseUrl,
    session: await store.load(),
    sessionStore: store,
    fetchImpl: async (input, init) => {
      if (String(input).endsWith("/auth/refresh")) {
        refreshes++;
        await new Promise((resolve) => setImmediate(resolve));
        return Response.json({ accessToken: "renewed", refreshToken: "b".repeat(64) });
      }
      if (new Headers(init?.headers).get("Authorization") !== "Bearer renewed")
        return new Response(null, { status: 401 });
      assert.equal(
        (await store.load()).accessToken,
        "renewed",
        "rotation is durable before retry",
      );
      return Response.json({ id: 7 });
    },
  });
  const books = await Promise.all([
    client.getBook(7),
    client.getBook(7),
    client.getBook(7),
  ]);
  assert.ok(books.every((book) => book.id === 7));
  assert.equal(refreshes, 1);
  assert.equal(
    (await new SessionStore(store.path, initial.baseUrl).load()).refreshToken,
    "b".repeat(64),
  );
  assert.equal((await stat(store.path)).mode & 0o077, 0);
  await assert.rejects(
    new SessionStore(store.path, "https://other.example").load(),
    /another BookOrbit/,
  );
  await chmod(store.path, 0o644);
  await assert.rejects(store.load(), /private/);
});

test("SDK HTTP contract reads a PDF through pagination, downloads exact bytes, and denies revoked cached access", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bookorbit-http-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let authorized = true;
  let canDownload = false;
  const client = new BookOrbitClient({
    baseUrl: "https://books.example",
    token: "fixture",
    fetchImpl: async (input) => {
      if (!authorized) return new Response(null, { status: 403 });
      if (String(input).endsWith("/books/7"))
        return Response.json({
          id: 7,
          title: "Sample",
          authors: [{ id: 1, name: "Writer" }],
          files: [{ id: 12, format: "pdf", sizeBytes: pdf.length }],
        });
      if (String(input).endsWith("/books/files/12/serve")) return new Response(pdf);
      if (String(input).endsWith("/books/files/12/download"))
        return canDownload ? new Response(pdf) : new Response(null, { status: 403 });
      throw new Error("Unexpected fixture endpoint");
    },
  });
  const service = new BookService(client, new BookCache(dir));
  const handler = httpHandler(() => {
    const server = new McpServer({ name: "fixture", version: "1" });
    registerTools(server, client, service);
    return server;
  }, ["connector.internal:3000"]);
  async function rpc(method: string, params?: unknown) {
    const response = await handler(
      new Request("http://connector.internal:3000/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    assert.equal(response.status, 200);
    return (await response.json()).result;
  }
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "offline", version: "1" },
  });
  assert.equal(init.serverInfo.name, "fixture");
  const list = await rpc("tools/list");
  assert.ok(list.tools.some((tool: { name: string }) => tool.name === "get_book_file"));
  const chapters = await rpc("tools/call", {
    name: "list_chapters",
    arguments: { bookId: 7 },
  });
  assert.equal(JSON.parse(chapters.content[0].text).author, "Writer");
  let offset: number | null = 0;
  let full = "";
  while (offset !== null) {
    const result = await rpc("tools/call", {
      name: "get_book_text",
      arguments: { bookId: 7, fileId: 12, offset, maxChars: 23 },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    const page = JSON.parse(result.content[0].text);
    full += page.text;
    assert.ok(page.nextOffset === null || page.nextOffset > offset);
    offset = page.nextOffset;
  }
  const expected = (await parsePdf(pdf, 7, "Sample", "Writer")).texts.join("\n\n");
  assert.equal(full, expected, "continuation loses and duplicates no characters");
  const noDownload = await rpc("tools/call", {
    name: "get_book_file",
    arguments: { bookId: 7, fileId: 12 },
  });
  assert.equal(
    noDownload.isError,
    true,
    "PDF text access does not grant original-file download",
  );
  canDownload = true;
  const file = await rpc("tools/call", {
    name: "get_book_file",
    arguments: { bookId: 7, fileId: 12 },
  });
  assert.equal(file.content[0].resource.mimeType, "application/pdf");
  assert.deepEqual(Buffer.from(file.content[0].resource.blob, "base64"), pdf);
  authorized = false;
  const denied = await rpc("tools/call", {
    name: "get_book_text",
    arguments: { bookId: 7 },
  });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /403/);
  for (const headers of [
    { Host: "attacker.example" },
    { Origin: "https://attacker.example" },
  ])
    assert.equal(
      (
        await handler(
          new Request("http://connector.internal:3000/mcp", { method: "POST", headers }),
        )
      ).status,
      403,
    );
  assert.equal(
    (await handler(new Request("http://connector.internal:3000/mcp"))).status,
    405,
  );
});
