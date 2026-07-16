#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { BookOrbitClient } from "./bookorbit-client.js";
import { BookCache } from "./cache.js";
import { BookService } from "./book-service.js";
import { registerTools } from "./tools.js";

/** Load a local .env for convenience when running directly (best-effort). */
function loadDotEnv(): void {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  try {
    (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(
      path,
    );
  } catch {
    // ignore malformed/absent .env
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();

  const client = new BookOrbitClient(config.client);
  const cache = new BookCache(config.cacheDir);
  const service = new BookService(client, cache);

  const server = new McpServer({
    name: "bookorbit-mcp",
    version: "0.1.0",
  });
  registerTools(server, client, service);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is reserved for the MCP protocol.
  console.error("bookorbit-mcp server ready (stdio).");
}

main().catch((err) => {
  console.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
