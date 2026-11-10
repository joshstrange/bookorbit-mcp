import { createHash } from "node:crypto";
import { parsePdf } from "./pdf-text.js";
import type { BookFile } from "./types.js";
import type { BookOrbitClient } from "./bookorbit-client.js";
import type { BookCache } from "./cache.js";
import { resolveSections } from "./epub-structure.js";
import { htmlToText } from "./html-to-text.js";
import type { ParsedBook, SectionWithSize } from "./types.js";

export interface SearchHit {
  sectionIndex: number;
  label: string;
  snippet: string;
  charOffset: number;
  approxBookPercent: number;
}

const SNIPPET_CONTEXT = 140;
const MAX_HITS_PER_SECTION = 5;

/** Orchestrates the client, EPUB structure resolution, extraction, and cache. */
export class BookService {
  private inflight = new Map<string, Promise<ParsedBook>>();
  private buildQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: BookOrbitClient,
    private readonly cache: BookCache,
  ) {}

  /** Get a parsed+measured book, building and caching it on first access. */
  async getParsedBook(bookId: number, fileId?: number): Promise<ParsedBook> {
    // Always re-check BookOrbit access, including cache hits and revoked sessions.
    const detail = await this.client.getBook(bookId);
    const file = selectBookFile(detail.files, fileId);
    const key = createHash("sha256")
      .update(JSON.stringify({ version: 2, bookId, updatedAt: detail.updatedAt, file }))
      .digest("hex");
    const cached = await this.cache.readParsed(bookId, key);
    if (cached) return cached;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const build = this.buildQueue
      .then(async () => {
        if (file.format.toLowerCase() === "pdf") {
          const data = await this.client.getBookFile(bookId, file.id, {
            purpose: "read",
          });
          const { parsed, texts } = await parsePdf(
            data,
            bookId,
            detail.title,
            detail.authors.map((author) => author.name).join(", "),
          );
          Object.assign(parsed, { fileId: file.id, cacheKey: key });
          await this.cache.writeParsed(parsed, texts);
          return parsed;
        }
        return this.buildParsedBook(bookId, key, file.id);
      })
      .finally(() => this.inflight.delete(key));
    this.buildQueue = build.catch(() => undefined);
    this.inflight.set(key, build);
    return build;
  }

  /** Read text after checking current access and source revision. */
  async getSectionText(bookId: number, index: number, fileId?: number): Promise<string> {
    const parsed = await this.getParsedBook(bookId, fileId);
    if (!parsed.sections[index]) throw new Error("Section does not exist.");
    const text = await this.cache.readSectionText(bookId, index, parsed.cacheKey);
    if (text == null)
      throw new Error("Incomplete book cache; remove this book's cache and retry.");
    return text;
  }

  /** Contiguous whole-book text, with explicit continuation instead of silent truncation. */
  async getBookText(bookId: number, offset = 0, maxChars = 24000, fileId?: number) {
    const parsed = await this.getParsedBook(bookId, fileId);
    const chunks: string[] = [];
    const totalChars = parsed.totalChars + Math.max(0, parsed.sections.length - 1) * 2;
    const start = Math.min(offset, totalChars);
    let position = 0;
    let returned = 0;
    for (const section of parsed.sections) {
      if (returned >= maxChars) break;
      const sectionLength = section.charCount + (section.index ? 2 : 0);
      if (position + sectionLength <= start) {
        position += sectionLength;
        continue;
      }
      const raw = await this.cache.readSectionText(
        bookId,
        section.index,
        parsed.cacheKey,
      );
      if (raw == null) throw new Error("Incomplete book cache.");
      const text = (section.index ? "\n\n" : "") + raw;
      if (position + text.length > offset && returned < maxChars) {
        const part = text.slice(
          Math.max(0, offset - position),
          Math.max(0, offset - position) + maxChars - returned,
        );
        chunks.push(part);
        returned += part.length;
      }
      position += text.length;
    }
    const hasMore = start + returned < totalChars;
    return {
      bookId,
      fileId: parsed.fileId,
      format: parsed.format,
      title: parsed.title,
      text: chunks.join(""),
      offset: start,
      totalChars,
      returnedChars: returned,
      hasMore,
      nextOffset: hasMore ? start + returned : null,
      requiresOcrPages: parsed.requiresOcrPages ?? [],
    };
  }

  /** Case-insensitive keyword search across one book's cached section text. */
  async searchInBook(
    bookId: number,
    query: string,
    maxResults = 20,
    caseSensitive = false,
    fileId?: number,
  ): Promise<SearchHit[]> {
    const parsed = await this.getParsedBook(bookId, fileId);
    const needle = caseSensitive ? query : query.toLowerCase();
    const hits: SearchHit[] = [];
    let charsBefore = 0;

    for (const section of parsed.sections) {
      if (hits.length >= maxResults) break;
      const text = await this.cache.readSectionText(
        bookId,
        section.index,
        parsed.cacheKey,
      );
      if (text == null) throw new Error("Incomplete book cache.");
      const haystack = caseSensitive ? text : text.toLowerCase();

      let from = 0;
      let inSection = 0;
      while (inSection < MAX_HITS_PER_SECTION && hits.length < maxResults) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) break;
        hits.push({
          sectionIndex: section.index,
          label: section.label,
          snippet: makeSnippet(text, at, query.length),
          charOffset: at,
          approxBookPercent: percent(charsBefore + at, parsed.totalChars),
        });
        from = at + Math.max(needle.length, 1);
        inSection++;
      }
      charsBefore += section.charCount;
    }
    return hits;
  }

  // --- build ---------------------------------------------------------------

  private async buildParsedBook(
    bookId: number,
    cacheKey: string,
    fileId: number,
  ): Promise<ParsedBook> {
    const info = await this.client.getEpubInfo(bookId);
    const sections = resolveSections(info);

    // Fetch each referenced spine file exactly once.
    const uniqueHrefs = [...new Set(sections.map((s) => s.spineHref))];
    const files = new Map<string, string>();
    for (const href of uniqueHrefs) {
      files.set(href, await this.client.getEpubFile(bookId, href));
    }

    const sectionTexts: string[] = [];
    const measured: SectionWithSize[] = [];
    let totalChars = 0;
    for (const section of sections) {
      const html = files.get(section.spineHref) ?? "";
      const text = htmlToText(html, section.startAnchor, section.endAnchor);
      sectionTexts.push(text);
      const charCount = text.length;
      totalChars += charCount;
      measured.push({
        ...section,
        charCount,
        wordCount: countWords(text),
      });
    }

    const parsed: ParsedBook = {
      bookId,
      cacheKey,
      fileId,
      format: "epub",
      title: info.metadata.title ?? "Unknown title",
      author: info.metadata.creator ?? "Unknown author",
      sections: measured,
      totalChars,
    };
    await this.cache.writeParsed(parsed, sectionTexts);
    return parsed;
  }
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function percent(pos: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((pos / total) * 1000) / 10;
}

function makeSnippet(text: string, at: number, matchLen: number): string {
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(text.length, at + matchLen + SNIPPET_CONTEXT);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

/** Explicit file selection never silently changes the edition requested by the caller. */
export function selectBookFile(files: BookFile[], fileId?: number): BookFile {
  const readable = files.filter((f) => ["epub", "pdf"].includes(f.format.toLowerCase()));
  const file =
    fileId == null
      ? (readable.find((f) => f.format.toLowerCase() === "epub") ?? readable[0])
      : readable.find((f) => f.id === fileId);
  if (!file) throw new Error("Choose an attached EPUB or PDF file from get_book.");
  // BookOrbit's EPUB reader API addresses the book, not an individual EPUB file.
  if (
    file.format.toLowerCase() === "epub" &&
    readable.filter((f) => f.format.toLowerCase() === "epub").length > 1
  )
    throw new Error(
      "Multiple EPUB editions: chapter extraction cannot select an EPUB file with BookOrbit's current API. Use get_book_file for the exact edition.",
    );
  return file;
}
