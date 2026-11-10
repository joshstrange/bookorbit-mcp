import { homedir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "./bookorbit-client.js";

export interface AppConfig {
  client: ClientConfig;
  cacheDir: string;
  sessionFile?: string;
  transport: "stdio" | "http";
  host: string;
  port: number;
  allowedHosts?: string[];
}

/** Build config from environment variables, validating required fields. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrl = env.BOOKORBIT_URL?.trim();
  if (!baseUrl) {
    throw new Error("BOOKORBIT_URL is required (e.g. https://bookorbit.example.com).");
  }

  const username = env.BOOKORBIT_USERNAME?.trim() || undefined;
  const password = env.BOOKORBIT_PASSWORD || undefined;
  const token = env.BOOKORBIT_TOKEN?.trim() || undefined;

  const sessionFile = env.BOOKORBIT_SESSION_FILE?.trim() || undefined;
  if (
    [Boolean(token), Boolean(username || password), Boolean(sessionFile)].filter(Boolean)
      .length > 1
  )
    throw new Error("Choose one authentication mode: session, password, or token.");
  if (!sessionFile && !token && !(username && password)) {
    throw new Error(
      "Provide BOOKORBIT_USERNAME and BOOKORBIT_PASSWORD (recommended), " +
        "BOOKORBIT_SESSION_FILE after native SSO enrollment, or a static BOOKORBIT_TOKEN.",
    );
  }

  const cacheDir = env.CACHE_DIR?.trim() || join(homedir(), ".cache", "bookorbit-mcp");

  const url = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "BOOKORBIT_URL must be an HTTP(S) URL without credentials, query or fragment.",
    );
  const transport = env.MCP_TRANSPORT ?? "stdio";
  if (transport !== "stdio" && transport !== "http")
    throw new Error("MCP_TRANSPORT must be stdio or http.");
  const host = env.MCP_HOST ?? "127.0.0.1";
  const port = Number(env.MCP_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid MCP_PORT.");
  const allowedHosts = env.MCP_ALLOWED_HOSTS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    transport === "http" &&
    !["127.0.0.1", "localhost", "::1"].includes(host) &&
    !allowedHosts?.length
  )
    throw new Error(
      "A non-loopback listener requires MCP_ALLOWED_HOSTS and a private gateway-only network boundary.",
    );
  return {
    sessionFile,
    transport,
    host,
    port,
    allowedHosts,
    client: { baseUrl: baseUrl.replace(/\/+$/, ""), username, password, token },
    cacheDir,
  };
}
