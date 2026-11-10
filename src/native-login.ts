import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { credentialsSchema, SessionStore } from "./session.js";

const providerSchema = z.object({
  slug: z.string(),
  clientId: z.string(),
  scopes: z.string(),
});

/** Reuse BookOrbit's allowed web callback without taking over its normal reader callback. */
export function validateRedirect(baseUrl: string, raw: string): URL {
  const redirect = new URL(raw);
  const base = new URL(baseUrl);
  if (
    redirect.protocol !== "https:" ||
    redirect.origin !== base.origin ||
    redirect.pathname !== "/oauth2-callback" ||
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    redirect.search !== "?bookorbit_mcp=1"
  ) {
    throw new Error(
      "SSO_REDIRECT_URI must be BOOKORBIT_URL's HTTPS origin + /oauth2-callback?bookorbit_mcp=1. Route only this query variant to the enrollment listener and allow it in your existing IdP client.",
    );
  }
  return redirect;
}

/** State is checked before BookOrbit receives the code; the PKCE verifier stays in this process. */
export function callbackCode(url: URL, state: string): string {
  if (
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== state ||
    url.searchParams.getAll("code").length !== 1 ||
    url.searchParams.has("error")
  )
    throw new Error("Invalid SSO callback.");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048) throw new Error("Invalid SSO callback.");
  return code;
}

/** Bounded enrollment command, never exposed by the normal MCP serving process. */
export async function nativeLogin(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!config.sessionFile) throw new Error("Set BOOKORBIT_SESSION_FILE for native SSO.");
  // Deliberately do not replace an active identity as a side effect of login.
  let exists = false;
  try {
    await access(config.sessionFile);
    exists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (exists)
    throw new Error(
      "Session file already exists. Stop the connector and revoke/remove the old native session before enrolling again.",
    );
  const redirect = validateRedirect(config.client.baseUrl, env.SSO_REDIRECT_URI ?? "");
  const api = `${config.client.baseUrl}/api/v1`;
  async function json(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${api}${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`BookOrbit SSO request failed (${response.status}).`);
    return response.json();
  }
  const providers = z
    .array(providerSchema)
    .parse(await json("/app-settings/oidc/providers/public"));
  const provider = env.SSO_PROVIDER
    ? providers.find((p) => p.slug === env.SSO_PROVIDER)
    : providers.length === 1
      ? providers[0]
      : undefined;
  if (!provider)
    throw new Error("Set SSO_PROVIDER to an enabled BookOrbit provider slug.");
  const { state, authorizationEndpoint } = z
    .object({ state: z.string().min(1), authorizationEndpoint: z.string().url() })
    .parse(await json(`/auth/oidc/${encodeURIComponent(provider.slug)}/state`, {}));
  const verifier = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const authorization = new URL(authorizationEndpoint);
  if (
    authorization.protocol !== "https:" ||
    authorization.username ||
    authorization.password
  )
    throw new Error("SSO requires an HTTPS authorization endpoint.");
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: provider.clientId,
    redirect_uri: redirect.href,
    scope: provider.scopes,
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }))
    authorization.searchParams.set(key, value);

  await new Promise<void>((resolve, reject) => {
    let consumed = false;
    const server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      const url = new URL(req.url ?? "/", redirect.origin);
      if (
        req.method !== "GET" ||
        url.pathname !== redirect.pathname ||
        url.searchParams.getAll("bookorbit_mcp").length !== 1 ||
        url.searchParams.get("bookorbit_mcp") !== "1" ||
        consumed
      ) {
        res.writeHead(404).end();
        return;
      }
      let code: string;
      try {
        code = callbackCode(url, state);
      } catch {
        res.writeHead(400).end("Invalid or expired sign-in callback.");
        return;
      }
      consumed = true;
      try {
        const body = await json("/auth/oidc/callback", {
          code,
          codeVerifier: verifier,
          redirectUri: redirect.href,
          nonce,
          state,
          clientKind: "native",
          deviceLabel: "bookorbit-mcp",
        });
        const credentials = credentialsSchema.parse(body);
        const userId = z
          .object({ user: z.object({ id: z.number().int().positive() }) })
          .parse(body).user.id;
        await new SessionStore(config.sessionFile!, config.client.baseUrl).save({
          ...credentials,
          baseUrl: config.client.baseUrl,
          userId,
        });
        res.end("BookOrbit MCP enrolled. You can close this window.");
        finish();
      } catch {
        res
          .writeHead(502)
          .end(
            "Enrollment failed. Return to the terminal; no credentials are displayed here.",
          );
        finish(new Error("Native SSO enrollment failed."));
      }
    });
    const timer = setTimeout(
      () => finish(new Error("SSO enrollment expired after five minutes.")),
      300_000,
    );
    function finish(error?: Error) {
      clearTimeout(timer);
      server.close();
      server.closeIdleConnections();
      if (error) reject(error);
      else resolve();
    }
    server.requestTimeout = 30_000;
    server.on("error", (error) => finish(error));
    server.listen(config.port, config.host, () =>
      console.error(
        `Complete native BookOrbit sign-in:\n${authorization.href}\nWaiting up to five minutes. The normal MCP service must be stopped during enrollment.`,
      ),
    );
  });
}
