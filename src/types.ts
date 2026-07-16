/** Shared types for the Book Orbit MCP server. */

/** A book as returned by GET /books/search. */
export interface BookSearchResult {
  id: number;
  title: string;
  seriesName: string | null;
  authors: string[];
  libraryId: number;
  libraryName: string;
  updatedAt: string;
  formats: string[];
}

/** One file attached to a book (from GET /books/{id}). */
export interface BookFile {
  id: number;
  format: string;
  role: string | null;
  sizeBytes: number | null;
  filename: string | null;
  absolutePath: string | null;
  durationSeconds: number | null;
}

/** Full book detail (GET /books/{id}) — only the fields we use are typed. */
export interface BookDetail {
  id: number;
  title: string;
  subtitle: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  language: string | null;
  publisher: string | null;
  publishedYear: number | null;
  description: string | null;
  genres: string[];
  tags: string[];
  files: BookFile[];
}

/** A spine item from GET /epub/{bookId}/info. */
export interface SpineItem {
  idref: string;
  href: string;
  mediaType: string;
  linear: boolean;
}

/** A nested TOC node from GET /epub/{bookId}/info. */
export interface TocNode {
  label: string;
  href?: string;
  children?: TocNode[];
}

/** The EPUB structure returned by GET /epub/{bookId}/info. */
export interface EpubInfo {
  containerPath: string;
  rootPath: string;
  spine: SpineItem[];
  manifest: Array<{ id: string; href: string; mediaType: string; size?: number }>;
  optionalFiles?: unknown;
  toc: TocNode;
  metadata: {
    title?: string;
    creator?: string;
    language?: string;
    publisher?: string;
    description?: string;
    [k: string]: unknown;
  };
  coverPath?: string;
}

/**
 * A resolved reading section — the human-meaningful unit the tools expose as a
 * "chapter". Text lives in `spineHref`, optionally sliced to the anchor range
 * [startAnchor, endAnchor).
 */
export interface Section {
  index: number;
  label: string;
  spineHref: string;
  /** Element id where this section starts; null = start of the spine file. */
  startAnchor: string | null;
  /** Element id where this section ends (exclusive); null = end of the file. */
  endAnchor: string | null;
}

/** A section enriched with extracted-text size metadata (cached). */
export interface SectionWithSize extends Section {
  charCount: number;
  wordCount: number;
}

/** Parsed + measured book, as persisted in the cache. */
export interface ParsedBook {
  bookId: number;
  title: string;
  author: string;
  sections: SectionWithSize[];
  totalChars: number;
}
