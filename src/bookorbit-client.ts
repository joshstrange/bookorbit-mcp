import type {
  Annotation,
  AnnotatedBookSummary,
  AnnotationHubPage,
  AuthorSummary,
  BookDetail,
  BookListItem,
  BookSearchResult,
  BookShelfType,
  CurrentlyReading,
  DashboardWidgetKind,
  EpubInfo,
  Library,
  LibraryStats,
  LibraryStatKind,
  MetadataFacetKind,
  NamedShelf,
  Paged,
  ReadingProgress,
  ReadingSessionsPage,
  RelatedBook,
  SeriesSummary,
  StatisticsSummary,
  UserStatisticsSummary,
  UserStatKind,
} from "./types.js";

/** How similar/related books are looked up (GET /books/{id}/...). */
export type RelatedKind = "similar" | "same_series" | "same_author";

/** Common page/size pagination options for the browse endpoints. */
export interface PageOpts {
  page?: number;
  size?: number;
}

export interface ClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  username?: string;
  password?: string;
  /** Static Bearer token (dev only; not auto-refreshed). */
  token?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class BookOrbitError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "BookOrbitError";
  }
}

/** Encode an internal EPUB path, preserving "/" separators. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class BookOrbitClient {
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private accessToken: string | null;
  private refreshCookie: string | null = null;

  constructor(private readonly config: ClientConfig) {
    if (config.apiKey !== undefined && !config.apiKey.trim())
      throw new Error("API key is empty.");
    if (config.token !== undefined && !config.token.trim())
      throw new Error("Static token is empty.");
    for (const limit of [config.timeoutMs, config.maxResponseBytes]) {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
        throw new Error("Request limits must be positive integers.");
    }
    this.apiBase = `${config.baseUrl.replace(/\/+$/, "")}/api/v1`;
    this.fetchImpl = config.fetchImpl ?? fetch;
    const url = new URL(config.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "BOOKORBIT_URL must be an HTTP(S) URL without credentials, query or fragment.",
      );
    }
    this.accessToken = config.apiKey ?? config.token ?? null;
  }

  private get canReauthenticate(): boolean {
    return Boolean(
      !this.config.apiKey &&
      !this.config.token &&
      this.config.username &&
      this.config.password,
    );
  }

  async searchBooks(query: string, limit?: number): Promise<BookSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (limit != null) params.set("limit", String(limit));
    return this.getJson<BookSearchResult[]>(`/books/search?${params}`);
  }

  async getBook(id: number): Promise<BookDetail> {
    const book = await this.getJson<BookDetail>(`/books/${id}`);
    return {
      ...book,
      authors: book.authors.map((a) =>
        typeof a === "string" ? a : (a as { name: string }).name,
      ),
    };
  }

  /** Browse with the released API's explicitly read-safe catalog query POST. */
  async queryBooks(
    opts: { q?: string; page?: number; size?: number } = {},
  ): Promise<Paged<BookListItem>> {
    if (
      !Number.isInteger(opts.page ?? 0) ||
      (opts.page ?? 0) < 0 ||
      !Number.isInteger(opts.size ?? 20) ||
      (opts.size ?? 20) < 1 ||
      (opts.size ?? 20) > 100
    )
      throw new Error("Invalid catalog pagination.");
    const res = await this.authFetch("/books/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: opts.q,
        pagination: { page: opts.page ?? 0, size: opts.size ?? 20 },
      }),
    });
    return this.parseJson<Paged<BookListItem>>(res, "/books/query");
  }

  async getAppInfo(): Promise<unknown> {
    return this.getJson("/app-info");
  }

  async getEpubInfo(bookId: number, fileId?: number): Promise<EpubInfo> {
    return this.getJson<EpubInfo>(
      `/epub/${bookId}/info${fileId == null ? "" : `?fileId=${fileId}`}`,
    );
  }

  /** Fetch one internal EPUB file (e.g. a chapter's XHTML) as text. */
  async getEpubFile(
    bookId: number,
    internalPath: string,
    fileId?: number,
  ): Promise<string> {
    if (
      internalPath.split("/").some((p) => p === ".." || p === ".") ||
      internalPath.includes("\\") ||
      internalPath.startsWith("/")
    )
      throw new Error("Invalid internal EPUB path.");
    const res = await this.authFetch(
      `/epub/${bookId}/file/${encodePath(internalPath)}${fileId == null ? "" : `?fileId=${fileId}`}`,
    );
    return res.text();
  }

  /** The books that have annotations (highlights/notes), with counts. */
  async listAnnotatedBooks(): Promise<AnnotatedBookSummary[]> {
    return this.getJson<AnnotatedBookSummary[]>(`/annotations/books`);
  }

  /** All of one book's annotations (highlights/notes). */
  async getAnnotations(bookId: number): Promise<Annotation[]> {
    return this.getJson<Annotation[]>(`/books/${bookId}/annotations`);
  }

  /** A page of the cross-library annotation hub. */
  async listAnnotations(opts?: {
    page?: number;
    pageSize?: number;
    bookId?: number;
  }): Promise<AnnotationHubPage> {
    if (opts?.page != null && (!Number.isInteger(opts.page) || opts.page < 1))
      throw new Error("Annotations use one-based pages.");
    const params = new URLSearchParams();
    if (opts?.page != null) params.set("page", String(opts.page));
    if (opts?.pageSize != null) params.set("pageSize", String(opts.pageSize));
    if (opts?.bookId != null) params.set("bookId", String(opts.bookId));
    const qs = params.toString();
    return this.getJson<AnnotationHubPage>(`/annotations${qs ? `?${qs}` : ""}`);
  }

  // --- discovery / browse (live, uncached) ---------------------------------

  /** Related books for one book: similar, same-series, or same-author. */
  async getRelatedBooks(bookId: number, kind: RelatedKind): Promise<RelatedBook[]> {
    const suffix =
      kind === "same_series"
        ? "series-books"
        : kind === "same_author"
          ? "author-books"
          : "recommendations";
    return this.getJson<RelatedBook[]>(`/books/${bookId}/${suffix}`);
  }

  /** A page of the library's series. */
  async listSeries(opts?: PageOpts): Promise<Paged<SeriesSummary>> {
    return this.getJson<Paged<SeriesSummary>>(`/series${pageQuery(opts)}`);
  }

  /** A page of the books in one series. */
  async getSeriesBooks(seriesId: number, opts?: PageOpts): Promise<Paged<BookListItem>> {
    return this.getJson<Paged<BookListItem>>(
      `/series/${seriesId}/books${pageQuery(opts)}`,
    );
  }

  /** A page of the library's authors (each with a bio). */
  async listAuthors(opts?: PageOpts): Promise<Paged<AuthorSummary>> {
    return this.getJson<Paged<AuthorSummary>>(`/authors${pageQuery(opts)}`);
  }

  /** One author, including their bio. */
  async getAuthor(authorId: number): Promise<AuthorSummary> {
    return this.getJson<AuthorSummary>(`/authors/${authorId}`);
  }

  /** A page of the books by one author. */
  async getAuthorBooks(authorId: number, opts?: PageOpts): Promise<Paged<BookListItem>> {
    return this.getJson<Paged<BookListItem>>(
      `/authors/${authorId}/books${pageQuery(opts)}`,
    );
  }

  /** The user's collections (curated shelves). */
  async listCollections(): Promise<NamedShelf[]> {
    return this.getJson<NamedShelf[]>(`/collections?bookIds=`);
  }

  /** A page of the books in one collection. */
  async getCollectionBooks(
    collectionId: number,
    opts?: PageOpts & { q?: string; collapseSeries?: boolean },
  ): Promise<Paged<BookListItem>> {
    const params = pageParams(opts);
    if (opts?.q != null) params.set("q", opts.q);
    if (opts?.collapseSeries != null)
      params.set("collapseSeries", String(opts.collapseSeries));
    return this.getJson<Paged<BookListItem>>(
      `/collections/${collectionId}/books?${params}`,
    );
  }

  /** The user's smart scopes (saved dynamic filters). */
  async listSmartScopes(): Promise<NamedShelf[]> {
    return this.getJson<NamedShelf[]>(`/smart-scopes`);
  }

  /** A page of the books matched by one smart scope. */
  async getSmartScopeBooks(
    scopeId: number,
    opts?: PageOpts & { q?: string },
  ): Promise<Paged<BookListItem>> {
    // The GET requires App Attest in v3.8.0; this explicitly read-safe POST
    // invokes the same service query without changing the key's permissions.
    const res = await this.authFetch(`/smart-scopes/${scopeId}/books/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: opts?.q,
        sort: [],
        pagination: { page: opts?.page ?? 0, size: opts?.size ?? 20 },
      }),
    });
    return this.parseJson<Paged<BookListItem>>(
      res,
      `/smart-scopes/${scopeId}/books/query`,
    );
  }

  // --- reading state (live, uncached) --------------------------------------

  /** Per-file reading progress for one book. */
  async getReadingProgress(bookId: number): Promise<ReadingProgress[]> {
    return this.getJson<ReadingProgress[]>(`/books/${bookId}/progress`);
  }

  /** Audiobook progress for one book (null when the book has no audio). */
  async getAudioProgress(bookId: number): Promise<unknown> {
    return this.getJson<unknown>(`/books/${bookId}/audio-progress`);
  }

  /** The books the user is currently reading, with progress. */
  async listCurrentlyReading(): Promise<CurrentlyReading> {
    return this.getJson<CurrentlyReading>(`/dashboard/widgets/currently-reading`);
  }

  /** A page of reading sessions for one book, plus aggregate stats. */
  async getReadingSessions(
    bookId: number,
    opts?: { page?: number; pageSize?: number },
  ): Promise<ReadingSessionsPage> {
    const params = new URLSearchParams();
    if (opts?.page != null) params.set("page", String(opts.page));
    if (opts?.pageSize != null) params.set("pageSize", String(opts.pageSize));
    const qs = params.toString();
    return this.getJson<ReadingSessionsPage>(
      `/books/${bookId}/sessions${qs ? `?${qs}` : ""}`,
    );
  }

  // --- statistics & libraries (live, uncached) -----------------------------

  /** Library-wide totals. */
  async getStatisticsSummary(): Promise<StatisticsSummary> {
    return this.getJson<StatisticsSummary>(`/statistics/summary`);
  }

  /** The user's personal reading totals. */
  async getUserStatisticsSummary(): Promise<UserStatisticsSummary> {
    return this.getJson<UserStatisticsSummary>(`/user-statistics/summary`);
  }

  /**
   * A metadata typeahead facet (authors/series/genres/…). `q` is a case- and
   * accent-insensitive "contains" match; an empty/whitespace `q` returns `[]`.
   * Body is passed through as-is (a bare `{ name }[]` or `{ id, name }[]` array).
   */
  async suggestMetadata(kind: MetadataFacetKind, q: string): Promise<unknown> {
    const params = new URLSearchParams({ q });
    return this.getJson<unknown>(`/metadata/${kind}?${params}`);
  }

  /**
   * One library-wide statistics chart (distributions, timelines, top-N, gauges).
   * Optionally scoped to `libraryIds`. Only `books-added-over-time` honors
   * `granularity`/`range`. Pre-aggregated body is passed through as-is.
   */
  async getLibraryStatistic(
    kind: LibraryStatKind,
    opts?: {
      libraryIds?: number[];
      granularity?: "monthly" | "yearly";
      range?: "last-year" | "last-5-years" | "all-time";
    },
  ): Promise<unknown> {
    const params = statsParams(opts?.libraryIds);
    if (opts?.granularity != null) params.set("granularity", opts.granularity);
    if (opts?.range != null) params.set("range", opts.range);
    const qs = params.toString();
    return this.getJson<unknown>(`/statistics/${kind}${qs ? `?${qs}` : ""}`);
  }

  /**
   * One personal reading-statistics chart, optionally scoped to `libraryIds` and a
   * trailing `days` window. Per-kind extras (`year`/`week`, `comparePrevious`,
   * `goalBooks`) are forwarded when provided; the server ignores irrelevant ones.
   * Pre-aggregated body is passed through as-is.
   */
  async getUserStatistic(
    kind: UserStatKind,
    opts?: {
      libraryIds?: number[];
      days?: number;
      year?: number;
      week?: number;
      comparePrevious?: boolean;
      goalBooks?: number;
    },
  ): Promise<unknown> {
    const params = statsParams(opts?.libraryIds);
    if (opts?.days != null) params.set("days", String(opts.days));
    if (opts?.year != null) params.set("year", String(opts.year));
    if (opts?.week != null) params.set("week", String(opts.week));
    if (opts?.comparePrevious != null)
      params.set("comparePrevious", String(opts.comparePrevious));
    if (opts?.goalBooks != null) params.set("goalBooks", String(opts.goalBooks));
    const qs = params.toString();
    return this.getJson<unknown>(`/user-statistics/${kind}${qs ? `?${qs}` : ""}`);
  }

  /** One dashboard "headline card" widget (streak, goal, projection, …). */
  async getDashboardWidget(kind: DashboardWidgetKind): Promise<unknown> {
    return this.getJson<unknown>(`/dashboard/widgets/${kind}`);
  }

  /**
   * One curated dashboard book shelf (recently-added, want-to-read, up-next-in-
   * series, …). `smart-scope` requires `smartScopeId`. Returns a bare book-card array.
   */
  async getBookShelf(
    type: BookShelfType,
    opts?: { limit?: number; smartScopeId?: number },
  ): Promise<BookListItem[]> {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.smartScopeId != null) params.set("smartScopeId", String(opts.smartScopeId));
    const qs = params.toString();
    const result = await this.getJson<
      BookListItem[] | { books: BookListItem[]; total: number | null }
    >(`/dashboard/scrollers/${type}${qs ? `?${qs}` : ""}`);
    // Current releases return { books, total }; retain older bare-array compatibility.
    const books = Array.isArray(result) ? result : result.books;
    if (!Array.isArray(books))
      throw new BookOrbitError(
        "Invalid shelf response.",
        200,
        `/dashboard/scrollers/${type}`,
      );
    return books;
  }

  /** One collection's detail (companion to getCollectionBooks). */
  async getCollection(id: number): Promise<unknown> {
    return this.getJson<unknown>(`/collections/${id}`);
  }

  /** Search external providers for author-metadata candidates (bio enrichment). */
  async searchAuthorMetadata(
    q: string,
    opts?: { region?: string; limit?: number; providers?: string },
  ): Promise<unknown> {
    const params = new URLSearchParams({ q });
    if (opts?.region != null) params.set("region", opts.region);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.providers != null) params.set("providers", opts.providers);
    return this.getJson<unknown>(`/authors/metadata/search?${params}`);
  }

  /** Fetch a raw image (cover/thumbnail) as bytes plus its content type. */
  async getImage(path: string): Promise<{ data: Buffer; contentType: string }> {
    const res = await this.authFetch(path);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  /** A book's cover image (full-size or thumbnail). */
  async getBookCover(
    bookId: number,
    size: "full" | "thumbnail",
  ): Promise<{ data: Buffer; contentType: string }> {
    return this.getImage(
      `/books/${bookId}/${size === "thumbnail" ? "thumbnail" : "cover"}`,
    );
  }

  /** An author's image (full-size or thumbnail). */
  async getAuthorImage(
    authorId: number,
    size: "full" | "thumbnail",
  ): Promise<{ data: Buffer; contentType: string }> {
    return this.getImage(
      `/authors/${authorId}/${size === "thumbnail" ? "thumbnail" : "image"}`,
    );
  }

  /** All libraries (the raw per-library config blob). */
  async listLibraries(): Promise<Library[]> {
    return this.getJson<Library[]>(`/libraries`);
  }

  /** Book/size/format stats for one library. */
  async getLibraryStats(libraryId: number): Promise<LibraryStats> {
    return this.getJson<LibraryStats>(`/libraries/${libraryId}/stats`);
  }

  // --- internals -----------------------------------------------------------

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.authFetch(path);
    return this.parseJson<T>(res, path);
  }

  private async parseJson<T>(res: Response, path: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new BookOrbitError("Invalid JSON response.", res.status, path.split("?")[0]);
    }
  }

  /** Fetch with Bearer auth, refreshing / re-logging in once on a 401. */
  private async authFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.accessToken && this.canReauthenticate) await this.login();

    let res = await this.rawFetch(path, init);
    if (res.status === 401 && (this.canReauthenticate || this.refreshCookie)) {
      const recovered = await this.reauthenticate();
      if (recovered) res = await this.rawFetch(path, init);
    }

    if (!res.ok) {
      const message = await this.extractError(res);
      throw new BookOrbitError(message, res.status, path.split("?")[0]);
    }
    return res;
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    try {
      if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    } catch {
      throw new BookOrbitError("Invalid credential header.", 0, path.split("?")[0]);
    }
    return this.boundedFetch(path, { ...init, headers });
  }

  /** Deadline includes streamed body consumption; never follow credential-bearing redirects. */
  private async boundedFetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const signal = init.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000);
    const cap = this.config.maxResponseBytes ?? 8 * 1024 * 1024;
    try {
      const res = await this.fetchImpl(`${this.apiBase}${path}`, {
        ...init,
        redirect: "error",
        signal,
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400)
        throw new BookOrbitError("Redirect refused.", res.status, path.split("?")[0]);
      if (Number(res.headers.get("content-length")) > cap) {
        await res.body?.cancel();
        throw new BookOrbitError(
          "Response exceeds byte limit.",
          res.status,
          path.split("?")[0],
        );
      }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > cap) {
              await reader.cancel();
              throw new BookOrbitError(
                "Response exceeds byte limit.",
                res.status,
                path.split("?")[0],
              );
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      return new Response(
        res.status === 204 || res.status === 205 || res.status === 304
          ? null
          : Buffer.concat(chunks),
        { status: res.status, statusText: res.statusText, headers: res.headers },
      );
    } catch (err) {
      if (err instanceof BookOrbitError) throw err;
      const code = (err as { cause?: { code?: string } })?.cause?.code;
      const safeCode =
        code &&
        [
          "ECONNREFUSED",
          "ECONNRESET",
          "ETIMEDOUT",
          "ENOTFOUND",
          "EHOSTUNREACH",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          "SELF_SIGNED_CERT_IN_CHAIN",
          "UND_ERR_CONNECT_TIMEOUT",
        ].includes(code)
          ? ` (${code})`
          : "";
      throw new BookOrbitError(
        signal.aborted
          ? "Request timed out or cancelled."
          : `Request failed (network, TLS, or redirect)${safeCode}.`,
        0,
        path.split("?")[0],
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Try a token refresh, falling back to a full re-login. Returns success. */
  private async reauthenticate(): Promise<boolean> {
    if (this.refreshCookie) {
      try {
        await this.refresh();
        return true;
      } catch {
        // fall through to full login
      }
    }
    if (this.canReauthenticate) {
      await this.login();
      return true;
    }
    return false;
  }

  private async login(): Promise<void> {
    const res = await this.boundedFetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
      }),
    });
    if (!res.ok) {
      throw new BookOrbitError(
        `Login failed: ${await this.extractError(res)}`,
        res.status,
        "/auth/login",
      );
    }
    const body = await this.parseJson<{ accessToken: string }>(res, "/auth");
    this.accessToken = body.accessToken;
    this.captureRefreshCookie(res);
  }

  private async refresh(): Promise<void> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (this.refreshCookie) headers.set("Cookie", `refresh_token=${this.refreshCookie}`);
    const res = await this.boundedFetch("/auth/refresh", {
      method: "POST",
      headers,
    });
    if (!res.ok) {
      throw new BookOrbitError("Token refresh failed", res.status, "/auth/refresh");
    }
    const body = await this.parseJson<{ accessToken: string }>(res, "/auth");
    this.accessToken = body.accessToken;
    this.captureRefreshCookie(res);
  }

  private captureRefreshCookie(res: Response): void {
    const cookies = getSetCookies(res);
    for (const cookie of cookies) {
      const match = /^refresh_token=([^;]+)/.exec(cookie);
      if (match) this.refreshCookie = match[1];
    }
  }

  private async extractError(res: Response): Promise<string> {
    // Do not echo upstream bodies: they can contain credentials, private data or HTML.
    if (res.status === 401)
      return "Authentication rejected; check credential expiry or revocation.";
    if (res.status === 403)
      return "Access denied by server scope, permission or App Attest policy; no credential fallback.";
    return `Upstream HTTP ${res.status}.`;
  }
}

/** Build page/size query params (both optional). */
function pageParams(opts?: PageOpts): URLSearchParams {
  const params = new URLSearchParams();
  if (opts?.page != null) params.set("page", String(opts.page));
  if (opts?.size != null) params.set("size", String(opts.size));
  return params;
}

/** page/size as a leading-"?" query string, or "" when empty. */
function pageQuery(opts?: PageOpts): string {
  const qs = pageParams(opts).toString();
  return qs ? `?${qs}` : "";
}

/** Build a statistics query with a repeatable `libraryIds` key (?libraryIds=1&libraryIds=2). */
function statsParams(libraryIds?: number[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const id of libraryIds ?? []) params.append("libraryIds", String(id));
  return params;
}

/** Read Set-Cookie headers across runtimes (undici exposes getSetCookie). */
function getSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}
