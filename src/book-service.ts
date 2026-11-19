import type { BookOrbitClient } from "./bookorbit-client.js";
import { createHash, randomUUID } from "node:crypto";
import type { BookCache } from "./cache.js";
import { resolveSections } from "./epub-structure.js";
import { htmlToText } from "./html-to-text.js";
import type { EpubInfo, ParsedBook, SectionWithSize } from "./types.js";

export interface SearchHit {
  fileId?: number;
  spineHref: string;
  startAnchor: string | null;
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
  private inflight = new Map<number, Promise<ParsedBook>>();
  private readonly namespace = randomUUID();
  private versions = new Map<number, string>();

  constructor(
    private readonly client: BookOrbitClient,
    private readonly cache: BookCache,
  ) {}

  /** Get a parsed+measured book, building and caching it on first access. */
  async getParsedBook(bookId: number): Promise<ParsedBook> {
    // Every caller independently revalidates live authorization before any cache/inflight hit.
    try {
      const book = await this.client.getBook(bookId);
      const file = book.files.find((f) => f.format?.toLowerCase() === "epub");
      if (!file) throw new Error("This book has no EPUB file.");
      const info = await this.client.getEpubInfo(bookId, file.id);
      const version = createHash("sha256")
        .update(JSON.stringify([file, book.updatedAt, info]))
        .digest("hex");
      const cached = await this.cache.readParsed(bookId, this.namespace);
      if (
        cached &&
        this.versions.get(bookId) === version &&
        (file.contentVersion || file.fileHash)
      )
        return cached;
      await this.cache.delete(bookId, this.namespace);
      // Deduplicate only builds for the exact revalidated edition/version.
      const existing = this.inflight.get(bookId);
      if (existing) {
        await existing;
        return this.getParsedBook(bookId);
      }
      const build = this.buildParsedBook(bookId, info, file.id, version)
        .then((parsed) => {
          this.versions.set(bookId, version);
          return parsed;
        })
        .finally(() => this.inflight.delete(bookId));
      this.inflight.set(bookId, build);
      return await build;
    } catch (err) {
      await this.cache.delete(bookId, this.namespace);
      this.versions.delete(bookId);
      throw err;
    }
  }

  /** Extracted text of one section (rebuilds the book if the cache is cold). */
  async getSectionText(bookId: number, index: number): Promise<string> {
    return (await this.getSection(bookId, index)).text;
  }

  async getSection(
    bookId: number,
    index: number,
  ): Promise<{ parsed: ParsedBook; text: string }> {
    const parsed = await this.getParsedBook(bookId);
    return { parsed, text: await this.readValidatedSection(parsed, index) };
  }

  /** Read from exactly the revalidated parse, refusing a concurrent edition/eviction change. */
  private async readValidatedSection(parsed: ParsedBook, index: number): Promise<string> {
    const text = await this.cache.readSectionText(
      parsed.bookId,
      index,
      this.namespace,
      parsed,
    );
    return text ?? "";
  }

  /** Case-insensitive keyword search across one book's cached section text. */
  async searchInBook(
    bookId: number,
    query: string,
    maxResults = 20,
    caseSensitive = false,
  ): Promise<SearchHit[]> {
    if (
      !query ||
      query.length > 500 ||
      !Number.isInteger(maxResults) ||
      maxResults < 1 ||
      maxResults > 50
    )
      throw new Error("Search needs 1-500 query characters and 1-50 results.");
    const parsed = await this.getParsedBook(bookId);
    const needle = caseSensitive ? query : query.toLowerCase();
    const hits: SearchHit[] = [];
    let charsBefore = 0;

    for (const section of parsed.sections) {
      if (hits.length >= maxResults) break;
      const text = await this.readValidatedSection(parsed, section.index);
      const haystack = caseSensitive ? text : text.toLowerCase();

      let from = 0;
      let inSection = 0;
      while (inSection < MAX_HITS_PER_SECTION && hits.length < maxResults) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) break;
        hits.push({
          fileId: parsed.fileId,
          spineHref: section.spineHref,
          startAnchor: section.startAnchor,
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
    info: EpubInfo,
    fileId: number,
    startingVersion: string,
  ): Promise<ParsedBook> {
    const sections = resolveSections(info);
    if (sections.length > 2000) throw new Error("EPUB exceeds section limit (2000).");

    // Fetch each referenced spine file exactly once.
    const uniqueHrefs = [...new Set(sections.map((s) => s.spineHref))];
    if (uniqueHrefs.length > 500) throw new Error("EPUB exceeds spine file limit (500).");
    const files = new Map<string, string>();
    let next = 0;
    let bytes = 0;
    let stopped = false;
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(3, uniqueHrefs.length) }, async () => {
        while (!stopped && next < uniqueHrefs.length) {
          const href = uniqueHrefs[next++];
          try {
            const text = await this.client.getEpubFile(bookId, href, fileId);
            bytes += Buffer.byteLength(text);
            if (bytes > 16 * 1024 * 1024)
              throw new Error("EPUB exceeds aggregate byte limit (16 MiB).");
            files.set(href, text);
          } catch (err) {
            stopped = true;
            throw err;
          }
        }
      }),
    );
    const failed = workers.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;

    const sectionTexts: string[] = [];
    const measured: SectionWithSize[] = [];
    let totalChars = 0;
    for (const section of sections) {
      const html = files.get(section.spineHref) ?? "";
      const text = htmlToText(html, section.startAnchor, section.endAnchor);
      sectionTexts.push(text);
      const charCount = text.length;
      totalChars += charCount;
      if (totalChars > 16 * 1024 * 1024)
        throw new Error("Extracted text exceeds character limit (16 MiB).");
      measured.push({
        ...section,
        charCount,
        wordCount: countWords(text),
      });
    }

    const parsed: ParsedBook = {
      bookId,
      fileId,
      title: info.metadata.title ?? "Unknown title",
      author: info.metadata.creator ?? "Unknown author",
      sections: measured,
      totalChars,
    };
    // Recheck both access and edition after all XHTML reads, before publishing text.
    // A replacement can keep the same fileId while changing its version or structure.
    const finalBook = await this.client.getBook(bookId);
    const finalFile = finalBook.files.find((f) => f.format?.toLowerCase() === "epub");
    const finalInfo = await this.client.getEpubInfo(bookId, fileId);
    const finalVersion = createHash("sha256")
      .update(JSON.stringify([finalFile, finalBook.updatedAt, finalInfo]))
      .digest("hex");
    if (finalVersion !== startingVersion)
      throw new Error("Book changed during extraction; retry the content request.");
    await this.cache.writeParsed(parsed, sectionTexts, this.namespace);
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
