import type {
  Annotation,
  AnnotatedBookSummary,
  AnnotationHubPage,
  AuthorSummary,
  BookDetail,
  BookListItem,
  BookSearchResult,
  CurrentlyReading,
  EpubInfo,
  Library,
  LibraryStats,
  NamedShelf,
  Paged,
  ReadingProgress,
  ReadingSessionsPage,
  RelatedBook,
  SeriesSummary,
  StatisticsSummary,
  UserStatisticsSummary,
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
    this.apiBase = `${config.baseUrl.replace(/\/+$/, "")}/api/v1`;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.accessToken = config.token ?? null;
  }

  private get canReauthenticate(): boolean {
    return Boolean(this.config.username && this.config.password);
  }

  async searchBooks(query: string, limit?: number): Promise<BookSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    if (limit != null) params.set("limit", String(limit));
    return this.getJson<BookSearchResult[]>(`/books/search?${params}`);
  }

  async getBook(id: number): Promise<BookDetail> {
    return this.getJson<BookDetail>(`/books/${id}`);
  }

  async getEpubInfo(bookId: number): Promise<EpubInfo> {
    return this.getJson<EpubInfo>(`/epub/${bookId}/info`);
  }

  /** Fetch one internal EPUB file (e.g. a chapter's XHTML) as text. */
  async getEpubFile(bookId: number, internalPath: string): Promise<string> {
    const res = await this.authFetch(`/epub/${bookId}/file/${encodePath(internalPath)}`);
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
    const params = pageParams(opts);
    if (opts?.q != null) params.set("q", opts.q);
    return this.getJson<Paged<BookListItem>>(`/smart-scopes/${scopeId}/books?${params}`);
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
    return (await res.json()) as T;
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
      throw new BookOrbitError(message, res.status, path);
    }
    return res;
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    return this.fetchImpl(`${this.apiBase}${path}`, { ...init, headers });
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
    const res = await this.fetchImpl(`${this.apiBase}/auth/login`, {
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
    const body = (await res.json()) as { accessToken: string };
    this.accessToken = body.accessToken;
    this.captureRefreshCookie(res);
  }

  private async refresh(): Promise<void> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (this.refreshCookie) headers.set("Cookie", `refresh_token=${this.refreshCookie}`);
    const res = await this.fetchImpl(`${this.apiBase}/auth/refresh`, {
      method: "POST",
      headers,
    });
    if (!res.ok) {
      throw new BookOrbitError("Token refresh failed", res.status, "/auth/refresh");
    }
    const body = (await res.json()) as { accessToken: string };
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
    try {
      const body = (await res.json()) as { message?: string | string[] };
      const msg = body.message;
      if (Array.isArray(msg)) return msg.join("; ");
      if (msg) return msg;
    } catch {
      // non-JSON body
    }
    return `${res.status} ${res.statusText}`;
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

/** Read Set-Cookie headers across runtimes (undici exposes getSetCookie). */
function getSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}
