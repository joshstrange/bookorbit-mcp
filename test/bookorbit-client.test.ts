import { test } from "node:test";
import assert from "node:assert/strict";
import { BookOrbitClient, BookOrbitError } from "../src/bookorbit-client.js";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function mockFetch(handler: Handler): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(`${init.method ?? "GET"} ${url}`);
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

test("normalizes trailing slash in base URL", async () => {
  const { fetch, calls } = mockFetch(() => json([]));
  const client = new BookOrbitClient({
    baseUrl: "https://ex.com/",
    token: "t",
    fetchImpl: fetch,
  });
  await client.searchBooks("hi");
  assert.equal(calls[0], "GET https://ex.com/api/v1/books/search?q=hi");
});

test("sends Bearer token and uses q param", async () => {
  let authHeader: string | null = null;
  const { fetch } = mockFetch((_url, init) => {
    authHeader = new Headers(init.headers).get("authorization");
    return json([{ id: 1, title: "Book" }]);
  });
  const client = new BookOrbitClient({
    baseUrl: "https://ex.com",
    token: "abc",
    fetchImpl: fetch,
  });
  const res = await client.searchBooks("dune", 5);
  assert.equal(authHeader, "Bearer abc");
  assert.equal(res[0].title, "Book");
});

test("logs in with credentials, captures refresh cookie, retries on 401", async () => {
  let loggedIn = false;
  let refreshed = false;
  const { fetch, calls } = mockFetch((url) => {
    if (url.endsWith("/auth/login")) {
      loggedIn = true;
      return json(
        { accessToken: "access-1" },
        {
          headers: {
            "content-type": "application/json",
            "set-cookie": "refresh_token=REFRESH; Path=/api/v1/auth; HttpOnly",
          },
        },
      );
    }
    if (url.endsWith("/auth/refresh")) {
      refreshed = true;
      return json({ accessToken: "access-2" });
    }
    if (url.includes("/books/search")) {
      // First data call (with access-1) fails; second (access-2) succeeds.
      return refreshed ? json([{ id: 9 }]) : new Response("nope", { status: 401 });
    }
    return new Response("not found", { status: 404 });
  });

  const client = new BookOrbitClient({
    baseUrl: "https://ex.com",
    username: "u",
    password: "p",
    fetchImpl: fetch,
  });
  const res = await client.searchBooks("x");
  assert.ok(loggedIn, "should have logged in");
  assert.ok(refreshed, "should have refreshed on 401");
  assert.equal(res[0].id, 9);
  // login, first search (401), refresh, retried search
  assert.deepEqual(
    calls
      .filter((c) => c.includes("/auth/"))
      .map((c) => c.split(" ")[1].split("/api/v1")[1]),
    ["/auth/login", "/auth/refresh"],
  );
});

test("throws BookOrbitError with server message on non-2xx", async () => {
  const { fetch } = mockFetch(() =>
    json({ message: ["q must be a string"] }, { status: 400 }),
  );
  const client = new BookOrbitClient({
    baseUrl: "https://ex.com",
    token: "t",
    fetchImpl: fetch,
  });
  await assert.rejects(
    () => client.searchBooks("x"),
    (err: unknown) =>
      err instanceof BookOrbitError &&
      err.status === 400 &&
      /q must be a string/.test(err.message),
  );
});

test("encodes internal epub file paths but keeps slashes", async () => {
  const { fetch, calls } = mockFetch(
    () => new Response("<html>ok</html>", { status: 200 }),
  );
  const client = new BookOrbitClient({
    baseUrl: "https://ex.com",
    token: "t",
    fetchImpl: fetch,
  });
  const text = await client.getEpubFile(327, "OPS/xhtml/008 chapter001.xhtml");
  assert.match(text, /ok/);
  assert.equal(
    calls[0],
    "GET https://ex.com/api/v1/epub/327/file/OPS/xhtml/008%20chapter001.xhtml",
  );
});
