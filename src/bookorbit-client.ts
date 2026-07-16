import type { BookDetail, BookSearchResult, EpubInfo } from "./types.js";

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

/** Read Set-Cookie headers across runtimes (undici exposes getSetCookie). */
function getSetCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}
