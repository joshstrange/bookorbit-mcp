import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedBook } from "./types.js";

/**
 * Disk cache for parsed books, keyed by bookId and source revision. The caller supplies an account-isolated base directory. Layout:
 *   <baseDir>/<bookId>/<revision>/book.json          -> ParsedBook metadata (sections + sizes)
 *   <baseDir>/<bookId>/<revision>/text/section-NNN.txt -> extracted plain text per section
 */
export class BookCache {
  constructor(private readonly baseDir: string) {}

  private bookDir(bookId: number, key?: string): string {
    return join(this.baseDir, String(bookId), ...(key ? [key] : []));
  }

  private metaPath(bookId: number, key?: string): string {
    return join(this.bookDir(bookId, key), "book.json");
  }

  private sectionPath(bookId: number, index: number, key?: string): string {
    const name = `section-${String(index).padStart(3, "0")}.txt`;
    return join(this.bookDir(bookId, key), "text", name);
  }

  async readParsed(bookId: number, key?: string): Promise<ParsedBook | null> {
    try {
      const raw = await readFile(this.metaPath(bookId, key), "utf8");
      return JSON.parse(raw) as ParsedBook;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readSectionText(
    bookId: number,
    index: number,
    key?: string,
  ): Promise<string | null> {
    try {
      return await readFile(this.sectionPath(bookId, index, key), "utf8");
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Persist a fully parsed book: its metadata and every section's text. */
  async writeParsed(parsed: ParsedBook, sectionTexts: string[]): Promise<void> {
    await mkdir(join(this.bookDir(parsed.bookId, parsed.cacheKey), "text"), {
      recursive: true,
      mode: 0o700,
    });
    await Promise.all(
      sectionTexts.map((text, i) =>
        writeFile(this.sectionPath(parsed.bookId, i, parsed.cacheKey), text, "utf8"),
      ),
    );
    await writeFile(
      this.metaPath(parsed.bookId, parsed.cacheKey),
      JSON.stringify(parsed, null, 2),
      "utf8",
    );
  }
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}
