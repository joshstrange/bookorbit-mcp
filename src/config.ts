import { homedir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "./bookorbit-client.js";

export interface AppConfig {
  client: ClientConfig;
  cacheDir: string;
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

  if (!token && !(username && password)) {
    throw new Error(
      "Provide BOOKORBIT_USERNAME and BOOKORBIT_PASSWORD (recommended), " +
        "or a static BOOKORBIT_TOKEN.",
    );
  }

  const cacheDir = env.CACHE_DIR?.trim() || join(homedir(), ".cache", "bookorbit-mcp");

  return {
    client: { baseUrl, username, password, token },
    cacheDir,
  };
}
