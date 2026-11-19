import type { ClientConfig } from "./bookorbit-client.js";

export interface AppConfig {
  client: ClientConfig;
}

/** API keys and static Bearers always win; password login is explicit legacy opt-in. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrl = env.BOOKORBIT_URL?.trim();
  if (!baseUrl) throw new Error("BOOKORBIT_URL is required.");
  // Fail closed even when a selected key is accidentally empty.
  if (env.BOOKORBIT_API_KEY !== undefined) {
    const apiKey = env.BOOKORBIT_API_KEY.trim();
    if (!apiKey) throw new Error("BOOKORBIT_API_KEY is empty.");
    return { client: { baseUrl, apiKey } };
  }
  if (env.BOOKORBIT_TOKEN !== undefined) {
    const token = env.BOOKORBIT_TOKEN.trim();
    if (!token) throw new Error("BOOKORBIT_TOKEN is empty.");
    return { client: { baseUrl, token } };
  }
  if (
    env.BOOKORBIT_AUTH_MODE === "password" &&
    env.BOOKORBIT_USERNAME?.trim() &&
    env.BOOKORBIT_PASSWORD
  ) {
    return {
      client: {
        baseUrl,
        username: env.BOOKORBIT_USERNAME.trim(),
        password: env.BOOKORBIT_PASSWORD,
      },
    };
  }
  throw new Error(
    "Provide BOOKORBIT_API_KEY (recommended), BOOKORBIT_TOKEN, or explicit legacy BOOKORBIT_AUTH_MODE=password with username/password.",
  );
}
