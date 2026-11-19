import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { BookOrbitClient } from "../src/bookorbit-client.js";
import { BookService } from "../src/book-service.js";
import { BookCache } from "../src/cache.js";

for (const change of [
  "version",
  "file",
  "metadata",
  "structure",
  "book-denial",
  "epub-denial",
] as const) {
  test(`build completion refuses ${change} changes before publishing content`, async (t) => {
    const info = {
      metadata: { title: "Synthetic", creator: "Fixture" },
      toc: { label: "root", children: [] },
      spine: [
        { idref: "one", href: "one.xhtml" },
        { idref: "two", href: "two.xhtml" },
      ],
    };
    let changed = false;
    let injectChange = true;
    let fileFetches = 0;
    let bookReads = 0;
    let infoReads = 0;
    const server = createServer((req, res) => {
      if (req.url!.startsWith("/api/v1/books/")) {
        bookReads++;
        if (changed && change === "book-denial") {
          res.writeHead(403);
          res.end();
          return;
        }
        res.end(
          JSON.stringify({
            id: 1,
            authors: [],
            updatedAt: changed && change === "metadata" ? "new" : "old",
            files: [
              {
                id: changed && change === "file" ? 8 : 7,
                format: "epub",
                contentVersion: changed && change === "version" ? "v2" : "v1",
              },
            ],
          }),
        );
      } else if (req.url!.includes("/info")) {
        infoReads++;
        if (changed && change === "epub-denial") {
          res.writeHead(403);
          res.end();
          return;
        }
        res.end(
          JSON.stringify(
            changed && change === "structure"
              ? { ...info, spine: info.spine.slice(0, 1) }
              : info,
          ),
        );
      } else {
        fileFetches++;
        res.end(`<html><body><p>SYNTHETIC-${changed ? "new" : "old"}</p></body></html>`);
        // The two concurrent spine responses can straddle a server-side replacement.
        if (injectChange) changed = true;
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
    const service = new BookService(
      new BookOrbitClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "synthetic",
      }),
      new BookCache(),
    );
    await assert.rejects(
      service.getSection(1, 1),
      /changed during extraction|Access denied/,
    );
    assert.equal(bookReads, 2, "book/file metadata must be reread at completion");
    assert.equal(infoReads, change === "book-denial" ? 1 : 2);
    assert.equal(fileFetches, 2, "mismatch fails without unbounded retries");

    // A failed build must leave neither an inflight promise nor reusable mixed text.
    injectChange = false;
    changed = false;
    const rebuilt = await service.getSection(1, 1);
    assert.equal(rebuilt.text, "SYNTHETIC-old");
    assert.equal(fileFetches, 4, "recovery requires a fresh build");
    assert.equal((await service.getSection(1, 0)).text, "SYNTHETIC-old");
    assert.equal(fileFetches, 4, "stable builds still produce cache hits");
  });
}
