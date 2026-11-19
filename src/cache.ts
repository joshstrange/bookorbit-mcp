import type { ParsedBook } from "./types.js";

/** Process-local only. No extracted content is ever read from or written to disk. */
export class BookCache {
  private entries = new Map<
    string,
    { parsed: ParsedBook; texts: string[]; bytes: number }
  >();
  constructor(private readonly maxBytes = 32 * 1024 * 1024) {}

  private key(bookId: number, namespace: string): string {
    return `${namespace}:${bookId}`;
  }

  async readParsed(bookId: number, namespace = ""): Promise<ParsedBook | null> {
    return this.entries.get(this.key(bookId, namespace))?.parsed ?? null;
  }

  async readSectionText(
    bookId: number,
    index: number,
    namespace = "",
    expected?: ParsedBook,
  ): Promise<string | null> {
    const entry = this.entries.get(this.key(bookId, namespace));
    if (expected && entry?.parsed !== expected)
      throw new Error("Book cache changed during read; retry the operation.");
    return entry?.texts[index] ?? null;
  }

  async delete(bookId: number, namespace = ""): Promise<void> {
    this.entries.delete(this.key(bookId, namespace));
  }

  async writeParsed(parsed: ParsedBook, texts: string[], namespace = ""): Promise<void> {
    const bytes =
      Buffer.byteLength(JSON.stringify(parsed)) +
      texts.reduce((n, t) => n + Buffer.byteLength(t), 0);
    if (bytes > this.maxBytes) throw new Error("Parsed book exceeds memory cache limit.");
    const key = this.key(parsed.bookId, namespace);
    this.entries.delete(key);
    while (
      this.entries.size >= 4 ||
      [...this.entries.values()].reduce((n, e) => n + e.bytes, bytes) > this.maxBytes
    ) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { parsed, texts: [...texts], bytes });
  }
}
