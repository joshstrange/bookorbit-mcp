/** Shared types for the BookOrbit MCP server. */

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
 * One of the user's annotations (a highlight and/or note) on a book, from
 * GET /books/{bookId}/annotations. Only the fields we surface are documented;
 * `note` is null for a plain highlight.
 */
export interface Annotation {
  id: number;
  bookId: number;
  cfi: string | null;
  jumpFileId: number | null;
  pageno: number | null;
  /** The highlighted passage. */
  text: string;
  color: string | null;
  /** e.g. "highlight". */
  style: string | null;
  /** The user's own comment; null for a plain highlight. */
  note: string | null;
  /** BookOrbit's own chapter name — NOT a list_chapters label. */
  chapterTitle: string | null;
  /** BookOrbit's own chapter index — NOT a get_chapter index. */
  chapterIndex: number | null;
  /** Where the annotation came from, e.g. "koreader". */
  origin: string | null;
  positionStatus: string | null;
  createdAt: string;
}

/** An annotation as returned by the cross-library hub (GET /annotations). */
export interface HubAnnotation extends Annotation {
  bookTitle: string;
  author: string;
  deletedAt: string | null;
}

/** One row of GET /annotations/books — a book with annotations, and its count. */
export interface AnnotatedBookSummary {
  bookId: number;
  bookTitle: string;
  author: string;
  count: number;
}

/** A page of the cross-library annotation hub (GET /annotations). */
export interface AnnotationHubPage {
  items: HubAnnotation[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    books: number;
    withNotes: number;
    originBreakdown: Array<{ origin: string; count: number }>;
  };
}

// --- Discovery, browse, and reading state (live passthroughs, not cached) -----

/**
 * A generic paginated page as returned by the browse endpoints that use
 * page/size query params (GET /series, /authors, /{...}/books).
 */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

/**
 * A lighter related-book item from GET /books/{id}/recommendations,
 * /books/{id}/series-books, and /books/{id}/author-books.
 */
export interface RelatedBook {
  id: number;
  title: string;
  authors: string[];
  seriesIndex?: number | null;
  hasCover?: boolean;
  isAudiobook?: boolean;
  isComic?: boolean;
  updatedAt?: string;
}

/**
 * A rich book item shared by the browse-by-{series,author,collection,scope}
 * "/books" endpoints. Only the fields we surface are typed.
 */
export interface BookListItem {
  id: number;
  status?: string | null;
  title: string;
  seriesId?: number | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
  authors: string[];
  files?: Array<{
    id: number;
    format: string;
    role: string | null;
    sizeBytes: number | null;
  }>;
  publishedYear?: number | null;
  language?: string | null;
  genres?: string[];
}

/** One series from GET /series. */
export interface SeriesSummary {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
}

/** One author from GET /authors and GET /authors/{id} (description is a bio). */
export interface AuthorSummary {
  id: number;
  name: string;
  sortName: string | null;
  description: string | null;
  bookCount: number;
  lastAddedAt: string | null;
}

/**
 * A user collection (GET /collections) or smart scope (GET /smart-scopes).
 * Shape is loosely typed — the endpoints are live but empty on the dev instance.
 */
export interface NamedShelf {
  id: number;
  name: string;
  [k: string]: unknown;
}

/** One row of GET /books/{id}/progress (kobo-specific fields dropped). */
export interface ReadingProgress {
  fileId: number;
  cfi: string | null;
  pageNumber: number | null;
  percentage: number | null;
  koreaderProgress: string | null;
  updatedAt: string | null;
}

/** GET /dashboard/widgets/currently-reading. */
export interface CurrentlyReading {
  books: Array<{
    bookId: number;
    title: string;
    authors: string[];
    progress: number | null;
    fileFormat: string | null;
    hasCover: boolean;
    fileId: number | null;
  }>;
}

/** GET /books/{bookId}/sessions — reading-session history plus aggregate stats. */
export interface ReadingSessionsPage {
  items: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  stats: {
    totalSessions: number;
    totalSeconds: number;
    avgDurationSeconds: number;
    firstSessionAt: string | null;
    lastSessionAt: string | null;
    paceProgressDelta: number;
    paceDurationSeconds: number;
    [k: string]: unknown;
  };
}

/** GET /statistics/summary — library-wide totals. */
export interface StatisticsSummary {
  totalBooks: number;
  totalAuthors: number;
  totalSeries: number;
  totalPublishers: number;
  totalStorageBytes: number;
  totalGenres: number;
  totalLanguages: number;
  publicationYearMin: number | null;
  publicationYearMax: number | null;
  booksAddedThisYear: number;
}

/** GET /user-statistics/summary — the user's personal reading totals. */
export interface UserStatisticsSummary {
  trackedBooks: number;
  startedBooks: number;
  inProgressBooks: number;
  completedBooks: number;
  meanProgressPercent: number;
}

/** GET /libraries — the per-library config blob (only a few fields are surfaced). */
export interface Library {
  id: number;
  name: string;
  displayOrder: number;
  [k: string]: unknown;
}

/** GET /libraries/{id}/stats. */
export interface LibraryStats {
  totalBooks: number;
  totalSizeBytes: number;
  formatCounts: Record<string, number>;
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
