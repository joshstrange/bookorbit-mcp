#!/usr/bin/env node
import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { httpHandler } from "./http.js";
import { nativeLogin } from "./native-login.js";
import { SessionStore } from "./session.js";
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

  const command = process.argv[2];
  if (command === "login") {
    await nativeLogin(config);
    return;
  }
  if (command) throw new Error("Usage: bookorbit-mcp [login]");
  const sessionStore = config.sessionFile
    ? new SessionStore(config.sessionFile, config.client.baseUrl)
    : undefined;
  const session = await sessionStore?.load();
  const client = new BookOrbitClient({ ...config.client, session, sessionStore });
  // Account + origin isolation; old book-id-only caches are deliberately not reused.
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        config.client.baseUrl,
        session?.userId ?? config.client.username ?? config.client.token,
      ]),
    )
    .digest("hex");
  const cache = new BookCache(join(config.cacheDir, "v2", scope));
  const service = new BookService(client, cache);

  const createServer = () => {
    const server = new McpServer({
      name: "bookorbit-mcp",
      version: "0.1.0",
    });
    registerTools(server, client, service);
    return server;
  };
  if (config.transport === "http") {
    const allowedHosts = config.allowedHosts ?? [
      `127.0.0.1:${config.port}`,
      `localhost:${config.port}`,
      `[::1]:${config.port}`,
    ];
    const listener = serve({
      fetch: httpHandler(createServer, allowedHosts),
      hostname: config.host,
      port: config.port,
    });
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.once(signal, () => listener.close());
    console.error(
      `bookorbit-mcp ready (private HTTP, port ${config.port}). Client authentication belongs to the gateway.`,
    );
    return;
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is reserved for the MCP protocol.
  console.error("bookorbit-mcp server ready (stdio).");
}

main().catch((err) => {
  console.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
