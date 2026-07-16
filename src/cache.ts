import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedBook } from "./types.js";

/**
 * Disk cache for parsed books, keyed by bookId. Layout:
 *   <baseDir>/<bookId>/book.json          -> ParsedBook metadata (sections + sizes)
 *   <baseDir>/<bookId>/text/section-NNN.txt -> extracted plain text per section
 */
export class BookCache {
  constructor(private readonly baseDir: string) {}

  private bookDir(bookId: number): string {
    return join(this.baseDir, String(bookId));
  }

  private metaPath(bookId: number): string {
    return join(this.bookDir(bookId), "book.json");
  }

  private sectionPath(bookId: number, index: number): string {
    const name = `section-${String(index).padStart(3, "0")}.txt`;
    return join(this.bookDir(bookId), "text", name);
  }

  async readParsed(bookId: number): Promise<ParsedBook | null> {
    try {
      const raw = await readFile(this.metaPath(bookId), "utf8");
      return JSON.parse(raw) as ParsedBook;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readSectionText(bookId: number, index: number): Promise<string | null> {
    try {
      return await readFile(this.sectionPath(bookId, index), "utf8");
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Persist a fully parsed book: its metadata and every section's text. */
  async writeParsed(parsed: ParsedBook, sectionTexts: string[]): Promise<void> {
    await mkdir(join(this.bookDir(parsed.bookId), "text"), { recursive: true });
    await Promise.all(
      sectionTexts.map((text, i) =>
        writeFile(this.sectionPath(parsed.bookId, i), text, "utf8"),
      ),
    );
    await writeFile(
      this.metaPath(parsed.bookId),
      JSON.stringify(parsed, null, 2),
      "utf8",
    );
  }
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}
