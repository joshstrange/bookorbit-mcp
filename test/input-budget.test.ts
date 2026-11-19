import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio bounds tool collections before schema validation and recovers without invalid upstream calls", async (t) => {
  const requests: URL[] = [];
  const server = createServer((req, res) => {
    requests.push(new URL(req.url!, "http://localhost"));
    res.end("{}");
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
      BOOKORBIT_API_KEY: "synthetic-budget-key",
    },
    stderr: "pipe",
  });
  transport.stderr?.resume();
  const client = new Client({ name: "offline-input-budget", version: "1" });
  t.after(async () => {
    await client.close();
    await transport.close();
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  for (const [name, kind] of [
    ["get_library_statistic", "top-authors"],
    ["get_reading_statistic", "peak-hours"],
  ]) {
    const schema = tools.find((tool) => tool.name === name)!.inputSchema;
    assert.equal((schema.properties!.libraryIds as { maxItems: number }).maxItems, 100);
    for (const length of [0, 1, 100]) {
      const libraryIds = Array.from({ length }, (_, i) => i + 1);
      const before = requests.length;
      const result = await client.callTool({ name, arguments: { kind, libraryIds } });
      assert.ok(!result.isError);
      assert.equal(requests.length, before + 1);
      assert.deepEqual(
        requests.at(-1)!.searchParams.getAll("libraryIds"),
        libraryIds.map(String),
      );
    }
    // Includes boundary, schema-only rejection and pre-schema budget rejection.
    for (const length of [1, 100, 101, 129, 10000]) {
      for (const value of [null, 1]) {
        if (value === 1 && length <= 100) continue;
        const before = requests.length;
        const result = await client.callTool({
          name,
          arguments: { kind, libraryIds: Array(length).fill(value) },
        });
        assert.equal(result.isError, true);
        const error = JSON.stringify(result);
        assert.ok(Buffer.byteLength(error) < 32768, `bounded error for ${length} items`);
        if (length >= 129) {
          assert.match(error, /maximum of 128 elements/);
          assert.ok(Buffer.byteLength(error) < 1024);
          assert.ok(!error.includes('"issues"'));
        }
        assert.equal(requests.length, before, "invalid input never reaches BookOrbit");
        const recovered = await client.callTool({
          name,
          arguments: { kind, libraryIds: [1] },
        });
        assert.ok(!recovered.isError);
        assert.equal(requests.length, before + 1);
      }
    }
    // Two argument members + 126 elements exactly exhaust the global budget.
    // Unknown properties count even though Zod would otherwise strip them.
    const before = requests.length;
    const atBudget = await client.callTool({
      name,
      arguments: { kind, extra: Array(126).fill(null) },
    });
    assert.ok(!atBudget.isError);
    assert.equal(requests.length, before + 1);
    for (const length of [127, 10000]) {
      const result = await client.callTool({
        name,
        arguments: { kind, extra: Array(length).fill(null) },
      });
      assert.equal(result.isError, true);
      assert.ok(JSON.stringify(result).length < 1024);
      assert.equal(requests.length, before + 1);
    }
  }
  assert.equal((await client.listTools()).tools.length, 34);
});
