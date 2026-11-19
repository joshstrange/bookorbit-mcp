import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP stdio validates pagination and bounded reader output, then denies cached text after revocation", async (t) => {
  const info = JSON.parse(
    readFileSync(new URL("./fixtures/epub-info.json", import.meta.url), "utf8"),
  );
  const html = readFileSync(
    new URL("./fixtures/chapter-bundle.xhtml", import.meta.url),
    "utf8",
  );
  let revoked = false;
  const server = createServer((req, res) => {
    if (revoked) {
      res.writeHead(401);
      res.end("do not echo this");
      return;
    }
    assert.equal(req.headers.authorization, "Bearer synthetic-protocol-key");
    if (req.url!.startsWith("/api/v1/books/query")) {
      res.writeHead(201);
      res.end(
        JSON.stringify({
          items: [
            {
              id: 1,
              title: "Synthetic",
              authors: [],
              files: [{ id: 7, format: "epub" }],
            },
          ],
          total: 1,
          page: 0,
          size: 2,
        }),
      );
    } else if (req.url!.startsWith("/api/v1/books/")) {
      res.end(
        JSON.stringify({
          id: 1,
          authors: [],
          files: [{ id: 7, format: "epub", contentVersion: "v1" }],
        }),
      );
    } else if (req.url!.includes("/info")) res.end(JSON.stringify(info));
    else res.end(html);
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
      BOOKORBIT_API_KEY: "synthetic-protocol-key",
    },
    stderr: "pipe",
  });
  transport.stderr?.resume();
  const client = new Client({ name: "offline-protocol-test", version: "1" });
  t.after(async () => {
    await client.close();
    await transport.close();
  });
  await client.connect(transport);
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const parse = (res: Awaited<ReturnType<typeof call>>) =>
    JSON.parse((res.content as Array<{ text: string }>)[0].text);
  const catalog = await call("browse_books", { page: 0, size: 2 });
  assert.equal(catalog.isError, undefined);
  assert.equal(parse(catalog).page, 0);
  const badPage = await call("list_annotations", { page: 0 });
  assert.equal(badPage.isError, true);
  const toc = await call("list_chapters", { bookId: 1 });
  assert.ok(!toc.isError && parse(toc).chapterCount > 0);
  assert.ok(parse(toc).chapters.every((c: object) => !("text" in c)));
  const chapter = parse(toc).chapters.find(
    (c: { charCount: number }) => c.charCount > 0,
  ).chapter;
  const text = await call("get_chapter", { bookId: 1, chapter, maxChars: 10 });
  assert.ok(!text.isError);
  assert.equal(parse(text).returnedChars, 10);
  assert.equal(parse(text).fileId, 7);
  assert.ok(parse(text).spineHref);
  const search = await call("search_in_book", {
    bookId: 1,
    query: parse(text).text,
    maxResults: 2,
  });
  assert.ok(!search.isError && parse(search).hits.length <= 2);
  revoked = true;
  for (const name of ["get_chapter", "list_chapters", "search_in_book"]) {
    const denied = await call(name, { bookId: 1, chapter, query: "the" });
    assert.equal(denied.isError, true);
    assert.match((denied.content as Array<{ text: string }>)[0].text, /401/);
    assert.ok(!JSON.stringify(denied).includes("do not echo this"));
  }
});
