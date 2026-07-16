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

test("annotation endpoints hit the right paths with Bearer auth", async () => {
  let authHeader: string | null = null;
  const { fetch, calls } = mockFetch((url, init) => {
    authHeader = new Headers(init.headers).get("authorization");
    if (url.includes("/annotations/books")) return json([{ bookId: 116, count: 15 }]);
    if (url.includes("/books/116/annotations")) return json([{ id: 1, bookId: 116 }]);
    return json({ items: [], total: 0, page: 1, pageSize: 25, stats: {} });
  });
  const client = new BookOrbitClient({
    baseUrl: "https://ex.com",
    token: "abc",
    fetchImpl: fetch,
  });

  const books = await client.listAnnotatedBooks();
  assert.equal(books[0].bookId, 116);
  assert.equal(authHeader, "Bearer abc");
  assert.equal(calls.at(-1), "GET https://ex.com/api/v1/annotations/books");

  await client.getAnnotations(116);
  assert.equal(calls.at(-1), "GET https://ex.com/api/v1/books/116/annotations");

  await client.listAnnotations({ page: 2, pageSize: 5, bookId: 116 });
  assert.equal(
    calls.at(-1),
    "GET https://ex.com/api/v1/annotations?page=2&pageSize=5&bookId=116",
  );

  await client.listAnnotations();
  assert.equal(calls.at(-1), "GET https://ex.com/api/v1/annotations");
});

test("suggestMetadata maps kind to path and sends q", async () => {
  const { fetch, calls } = mockFetch(() => json([{ name: "Author Name" }]));
  const client = new BookOrbitClient({
    baseUrl: "https://ex.com",
    token: "t",
    fetchImpl: fetch,
  });

  await client.suggestMetadata("authors", "sand");
  assert.equal(calls.at(-1), "GET https://ex.com/api/v1/metadata/authors?q=sand");

  await client.suggestMetadata("genres", "sci fi");
  // The space is URL-encoded as "+".
  assert.equal(calls.at(-1), "GET https://ex.com/api/v1/metadata/genres?q=sci+fi");
});

test("getLibraryStatistic builds path, repeats libraryIds, and scopes extra params", async () => {
  const { fetch, calls } = mockFetch(() => json({ items: [], unknownCount: 0 }));
  const client = new BookOrbitClient({
    baseUrl: "https://ex.com",
    token: "t",
    fetchImpl: fetch,
  });

  // No opts → bare path.
  await client.getLibraryStatistic("top-authors");
  assert.equal(calls.at(-1), "GET https://ex.com/api/v1/statistics/top-authors");

  // libraryIds is repeated (?libraryIds=1&libraryIds=2).
  await client.getLibraryStatistic("format-distribution", { libraryIds: [1, 2] });
  assert.equal(
    calls.at(-1),
    "GET https://ex.com/api/v1/statistics/format-distribution?libraryIds=1&libraryIds=2",
  );

  // granularity/range are forwarded (only meaningful for books-added-over-time).
  await client.getLibraryStatistic("books-added-over-time", {
    libraryIds: [3],
    granularity: "yearly",
    range: "all-time",
  });
  assert.equal(
    calls.at(-1),
    "GET https://ex.com/api/v1/statistics/books-added-over-time?libraryIds=3&granularity=yearly&range=all-time",
  );
});

test("getUserStatistic forwards days and per-kind extras", async () => {
  const { fetch, calls } = mockFetch(() => json([]));
  const client = new BookOrbitClient({
    baseUrl: "https://ex.com",
    token: "t",
    fetchImpl: fetch,
  });

  await client.getUserStatistic("peak-hours", { days: 30 });
  assert.equal(
    calls.at(-1),
    "GET https://ex.com/api/v1/user-statistics/peak-hours?days=30",
  );

  await client.getUserStatistic("session-timeline", { year: 2024, week: 1 });
  assert.equal(
    calls.at(-1),
    "GET https://ex.com/api/v1/user-statistics/session-timeline?year=2024&week=1",
  );

  await client.getUserStatistic("progress-funnel", { days: 90, comparePrevious: true });
  assert.equal(
    calls.at(-1),
    "GET https://ex.com/api/v1/user-statistics/progress-funnel?days=90&comparePrevious=true",
  );

  await client.getUserStatistic("goal-trajectory", { libraryIds: [1], goalBooks: 24 });
  assert.equal(
    calls.at(-1),
    "GET https://ex.com/api/v1/user-statistics/goal-trajectory?libraryIds=1&goalBooks=24",
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
