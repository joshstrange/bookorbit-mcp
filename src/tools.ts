import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BookOrbitClient } from "./bookorbit-client.js";
import { BookOrbitError } from "./bookorbit-client.js";
import type { BookService } from "./book-service.js";
import type { Annotation, BookListItem, RelatedBook } from "./types.js";

/** Default cap on chapter text returned per call (~6k tokens). */
const DEFAULT_MAX_CHARS = 24_000;
const MAX_ALLOWED_CHARS = 50_000;

/** Default page size for the annotation hub (matches the server default). */
const DEFAULT_ANNOTATION_PAGE_SIZE = 25;
const MAX_ANNOTATION_PAGE_SIZE = 100;

/** Default/limit page size for the browse/list tools (series, authors, etc.). */
const DEFAULT_BROWSE_PAGE_SIZE = 25;
const MAX_BROWSE_PAGE_SIZE = 100;

/** True when any of a book's files is an EPUB. */
function hasEpubFile(files?: BookListItem["files"]): boolean {
  return (files ?? []).some((f) => f.format?.toLowerCase() === "epub");
}

/** Trim a rich browse-book item to the model-friendly fields. */
function shapeBookListItem(b: BookListItem) {
  return {
    bookId: b.id,
    title: b.title,
    authors: b.authors,
    seriesName: b.seriesName ?? null,
    seriesIndex: b.seriesIndex ?? null,
    publishedYear: b.publishedYear ?? null,
    genres: b.genres ?? [],
    hasEpub: hasEpubFile(b.files),
  };
}

/** Trim a lighter related-book item. */
function shapeRelatedBook(b: RelatedBook) {
  return {
    bookId: b.id,
    title: b.title,
    authors: b.authors,
    seriesIndex: b.seriesIndex ?? null,
    isAudiobook: b.isAudiobook ?? false,
    isComic: b.isComic ?? false,
  };
}

/** Shape one annotation into the trimmed, model-friendly object the tools return. */
function shapeAnnotation(a: Annotation) {
  return {
    id: a.id,
    text: a.text,
    note: a.note,
    chapterTitle: a.chapterTitle,
    chapterIndex: a.chapterIndex,
    color: a.color,
    style: a.style,
    origin: a.origin,
    pageno: a.pageno,
    createdAt: a.createdAt,
  };
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Run a handler, converting API/errors into readable tool errors. */
async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BookOrbitError) {
      return fail(`BookOrbit error (${err.status}) on ${err.path}: ${err.message}`);
    }
    return fail(`Error: ${(err as Error).message}`);
  }
}

export function registerTools(
  server: McpServer,
  client: BookOrbitClient,
  service: BookService,
): void {
  server.registerTool(
    "search_books",
    {
      title: "Search books",
      description:
        "Search the BookOrbit library by title, author, or series. Returns matching " +
        "books with their bookId and available formats. Use this first to find the " +
        "book (and confirm it has an EPUB) before reading its text.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(500)
          .describe("Title, author, or series text to search for."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max results (default server-side)."),
      },
    },
    async ({ query, limit }) =>
      guard(async () => {
        const books = await client.searchBooks(query, limit);
        return ok(
          books.map((b) => ({
            bookId: b.id,
            title: b.title,
            authors: b.authors,
            seriesName: b.seriesName,
            libraryName: b.libraryName,
            formats: b.formats,
            hasEpub: b.formats?.map((f) => f.toLowerCase()).includes("epub") ?? false,
          })),
        );
      }),
  );

  server.registerTool(
    "get_book",
    {
      title: "Get book details",
      description:
        "Get full metadata for one book by bookId, including its files and formats. " +
        "Use to confirm an EPUB is available and to read the description/series info.",
      inputSchema: {
        bookId: z.number().int().describe("The book's id (from search_books)."),
      },
    },
    async ({ bookId }) =>
      guard(async () => {
        const b = await client.getBook(bookId);
        return ok({
          bookId: b.id,
          title: b.title,
          subtitle: b.subtitle,
          authors: b.authors,
          seriesName: b.seriesName,
          seriesIndex: b.seriesIndex,
          language: b.language,
          publisher: b.publisher,
          publishedYear: b.publishedYear,
          description: b.description,
          genres: b.genres,
          tags: b.tags,
          files: (b.files ?? []).map((f) => ({
            format: f.format,
            role: f.role,
            sizeBytes: f.sizeBytes,
            filename: f.filename,
          })),
          hasEpub: (b.files ?? []).some((f) => f.format?.toLowerCase() === "epub"),
        });
      }),
  );

  server.registerTool(
    "list_chapters",
    {
      title: "List chapters",
      description:
        "List a book's chapters/sections with their sizes (character and word counts) " +
        "but NO text. Parses and caches the EPUB on first call. Use this to see the " +
        "book's structure and pick which chapter to read with get_chapter. EPUB only.",
      inputSchema: {
        bookId: z.number().int().describe("The book's id (from search_books)."),
      },
    },
    async ({ bookId }) =>
      guard(async () => {
        const parsed = await service.getParsedBook(bookId);
        return ok({
          bookId: parsed.bookId,
          title: parsed.title,
          author: parsed.author,
          totalChars: parsed.totalChars,
          chapterCount: parsed.sections.length,
          chapters: parsed.sections.map((s) => ({
            chapter: s.index,
            label: s.label,
            charCount: s.charCount,
            wordCount: s.wordCount,
          })),
        });
      }),
  );

  server.registerTool(
    "get_chapter",
    {
      title: "Get chapter text",
      description:
        "Return the plain text of one chapter/section by its index (from list_chapters). " +
        "Output is capped (default ~24000 chars); if the chapter is longer, use offset " +
        "with the returned nextOffset to page through it. Read only what you need.",
      inputSchema: {
        bookId: z.number().int().describe("The book's id."),
        chapter: z.number().int().min(0).describe("Chapter index from list_chapters."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Start character offset (default 0)."),
        maxChars: z
          .number()
          .int()
          .min(1)
          .max(MAX_ALLOWED_CHARS)
          .optional()
          .describe(`Max characters to return (default ${DEFAULT_MAX_CHARS}).`),
      },
    },
    async ({ bookId, chapter, offset, maxChars }) =>
      guard(async () => {
        const parsed = await service.getParsedBook(bookId);
        const section = parsed.sections[chapter];
        if (!section) {
          return fail(
            `Chapter ${chapter} not found. This book has ${parsed.sections.length} ` +
              `chapters (0..${parsed.sections.length - 1}).`,
          );
        }
        const full = await service.getSectionText(bookId, chapter);
        const start = Math.min(offset ?? 0, full.length);
        const cap = maxChars ?? DEFAULT_MAX_CHARS;
        const text = full.slice(start, start + cap);
        const end = start + text.length;
        const hasMore = end < full.length;
        return ok({
          bookId,
          chapter,
          label: section.label,
          text,
          offset: start,
          returnedChars: text.length,
          totalChars: full.length,
          hasMore,
          nextOffset: hasMore ? end : null,
        });
      }),
  );

  server.registerTool(
    "search_in_book",
    {
      title: "Search within a book",
      description:
        "Keyword search inside one book's text. Returns short snippets with the chapter " +
        "index, character offset, and approximate position (percent through the book). " +
        "Use the returned chapter + offset with get_chapter to read the surrounding text.",
      inputSchema: {
        bookId: z.number().int().describe("The book's id."),
        query: z
          .string()
          .min(1)
          .describe("Word or phrase to find (case-insensitive by default)."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max hits (default 20)."),
        caseSensitive: z
          .boolean()
          .optional()
          .describe("Match case exactly (default false)."),
      },
    },
    async ({ bookId, query, maxResults, caseSensitive }) =>
      guard(async () => {
        const hits = await service.searchInBook(
          bookId,
          query,
          maxResults ?? 20,
          caseSensitive ?? false,
        );
        return ok({ bookId, query, hitCount: hits.length, hits });
      }),
  );

  server.registerTool(
    "list_annotations",
    {
      title: "List all annotations",
      description:
        "List ALL of the user's annotations (their highlights and notes) across the whole " +
        "library, newest-page first. Each item includes the highlighted text, any note, the " +
        "book title/author, and the book's own chapter title/index. Paginated: use page with " +
        "the returned total/pageSize to browse, or pass bookId to filter to one book. " +
        "Returns a stats summary (book count, how many have notes, and where they came from).",
      inputSchema: {
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based page number (default 1)."),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(MAX_ANNOTATION_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default ${DEFAULT_ANNOTATION_PAGE_SIZE}).`),
        bookId: z
          .number()
          .int()
          .optional()
          .describe("Filter to one book's annotations (from search_books)."),
      },
    },
    async ({ page, pageSize, bookId }) =>
      guard(async () => {
        const result = await client.listAnnotations({
          page,
          pageSize: pageSize ?? DEFAULT_ANNOTATION_PAGE_SIZE,
          bookId,
        });
        return ok({
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          stats: result.stats,
          annotations: result.items.map((a) => ({
            ...shapeAnnotation(a),
            bookId: a.bookId,
            bookTitle: a.bookTitle,
            author: a.author,
          })),
        });
      }),
  );

  server.registerTool(
    "list_annotated_books",
    {
      title: "List annotated books",
      description:
        "List the books the user has annotated (highlighted / added notes to), each with an " +
        "annotation count. Use this to discover which books have annotations before pulling " +
        "them with get_annotations — like search_books precedes reading.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const books = await client.listAnnotatedBooks();
        return ok({ bookCount: books.length, books });
      }),
  );

  server.registerTool(
    "get_annotations",
    {
      title: "Get a book's annotations",
      description:
        "Return the user's own annotations (highlights and notes) for one book by bookId, " +
        "ordered by the book's chapters. Each includes the highlighted text, any note, and " +
        "the book's own chapterTitle/chapterIndex. NOTE: chapterIndex is BookOrbit's own " +
        "chapter numbering, NOT the index used by list_chapters/get_chapter — match on " +
        "chapterTitle if you want to read the surrounding text.",
      inputSchema: {
        bookId: z.number().int().describe("The book's id (from search_books)."),
      },
    },
    async ({ bookId }) =>
      guard(async () => {
        const annotations = await client.getAnnotations(bookId);
        const ordered = [...annotations].sort(
          (a, b) =>
            (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0) ||
            a.createdAt.localeCompare(b.createdAt),
        );
        return ok({
          bookId,
          annotationCount: ordered.length,
          annotations: ordered.map(shapeAnnotation),
        });
      }),
  );

  // --- Related & browse ------------------------------------------------------

  server.registerTool(
    "get_related_books",
    {
      title: "Get related books",
      description:
        "Find books related to one book by bookId: 'similar' recommendations, other books " +
        "in the 'same_series' (with series index), or other books by the 'same_author'. " +
        "Use to suggest what to read next or to explore a series/author.",
      inputSchema: {
        bookId: z.number().int().describe("The book's id (from search_books)."),
        kind: z
          .enum(["similar", "same_series", "same_author"])
          .describe("Which relation to fetch."),
      },
    },
    async ({ bookId, kind }) =>
      guard(async () => {
        const books = await client.getRelatedBooks(bookId, kind);
        return ok({
          bookId,
          kind,
          count: books.length,
          books: books.map(shapeRelatedBook),
        });
      }),
  );

  server.registerTool(
    "list_series",
    {
      title: "List series",
      description:
        "List the library's series (paginated), each with book/read counts and its authors. " +
        "Use the returned series id with get_series_books to read the books in a series.",
      inputSchema: {
        page: z.number().int().min(1).optional().describe("1-based page (default 1)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(MAX_BROWSE_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default ${DEFAULT_BROWSE_PAGE_SIZE}).`),
      },
    },
    async ({ page, size }) =>
      guard(async () => {
        const res = await client.listSeries({
          page,
          size: size ?? DEFAULT_BROWSE_PAGE_SIZE,
        });
        return ok({
          total: res.total,
          page: res.page,
          size: res.size,
          series: res.items.map((s) => ({
            seriesId: s.id,
            name: s.name,
            bookCount: s.bookCount,
            readCount: s.readCount,
            authors: s.authors,
            lastAddedAt: s.lastAddedAt,
          })),
        });
      }),
  );

  server.registerTool(
    "get_series_books",
    {
      title: "Get books in a series",
      description:
        "List the books in one series by seriesId (from list_series), in series order, " +
        "paginated. Each item includes its series index and whether it has an EPUB.",
      inputSchema: {
        seriesId: z.number().int().describe("The series id (from list_series)."),
        page: z.number().int().min(1).optional().describe("1-based page (default 1)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(MAX_BROWSE_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default ${DEFAULT_BROWSE_PAGE_SIZE}).`),
      },
    },
    async ({ seriesId, page, size }) =>
      guard(async () => {
        const res = await client.getSeriesBooks(seriesId, {
          page,
          size: size ?? DEFAULT_BROWSE_PAGE_SIZE,
        });
        return ok({
          seriesId,
          total: res.total,
          page: res.page,
          size: res.size,
          books: res.items.map(shapeBookListItem),
        });
      }),
  );

  server.registerTool(
    "list_authors",
    {
      title: "List authors",
      description:
        "List the library's authors (paginated) with their book counts. Use the returned " +
        "author id with get_author for a bio or get_author_books for their books.",
      inputSchema: {
        page: z.number().int().min(1).optional().describe("1-based page (default 1)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(MAX_BROWSE_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default ${DEFAULT_BROWSE_PAGE_SIZE}).`),
      },
    },
    async ({ page, size }) =>
      guard(async () => {
        const res = await client.listAuthors({
          page,
          size: size ?? DEFAULT_BROWSE_PAGE_SIZE,
        });
        return ok({
          total: res.total,
          page: res.page,
          size: res.size,
          authors: res.items.map((a) => ({
            authorId: a.id,
            name: a.name,
            bookCount: a.bookCount,
          })),
        });
      }),
  );

  server.registerTool(
    "get_author",
    {
      title: "Get author details",
      description:
        "Get one author by authorId (from list_authors), including their biography " +
        "(description) and book count. Use get_author_books for their books.",
      inputSchema: {
        authorId: z.number().int().describe("The author id (from list_authors)."),
      },
    },
    async ({ authorId }) =>
      guard(async () => {
        const a = await client.getAuthor(authorId);
        return ok({
          authorId: a.id,
          name: a.name,
          sortName: a.sortName,
          description: a.description,
          bookCount: a.bookCount,
          lastAddedAt: a.lastAddedAt,
        });
      }),
  );

  server.registerTool(
    "get_author_books",
    {
      title: "Get an author's books",
      description:
        "List the books by one author by authorId (from list_authors), paginated. Each " +
        "item includes series info and whether it has an EPUB.",
      inputSchema: {
        authorId: z.number().int().describe("The author id (from list_authors)."),
        page: z.number().int().min(1).optional().describe("1-based page (default 1)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(MAX_BROWSE_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default ${DEFAULT_BROWSE_PAGE_SIZE}).`),
      },
    },
    async ({ authorId, page, size }) =>
      guard(async () => {
        const res = await client.getAuthorBooks(authorId, {
          page,
          size: size ?? DEFAULT_BROWSE_PAGE_SIZE,
        });
        return ok({
          authorId,
          total: res.total,
          page: res.page,
          size: res.size,
          books: res.items.map(shapeBookListItem),
        });
      }),
  );

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List the user's collections (curated shelves). Use a returned collection id with " +
        "get_collection_books to read the books it contains.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const collections = await client.listCollections();
        return ok({ count: collections.length, collections });
      }),
  );

  server.registerTool(
    "get_collection_books",
    {
      title: "Get books in a collection",
      description:
        "List the books in one collection by collectionId (from list_collections), paginated. " +
        "Optionally filter with q or collapse series into a single entry.",
      inputSchema: {
        collectionId: z
          .number()
          .int()
          .describe("The collection id (from list_collections)."),
        page: z.number().int().min(1).optional().describe("1-based page (default 1)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(MAX_BROWSE_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default ${DEFAULT_BROWSE_PAGE_SIZE}).`),
        q: z.string().optional().describe("Filter within the collection."),
        collapseSeries: z
          .boolean()
          .optional()
          .describe("Collapse each series to one entry (default false)."),
      },
    },
    async ({ collectionId, page, size, q, collapseSeries }) =>
      guard(async () => {
        const res = await client.getCollectionBooks(collectionId, {
          page: page ?? 1,
          size: size ?? DEFAULT_BROWSE_PAGE_SIZE,
          q,
          collapseSeries,
        });
        return ok({
          collectionId,
          total: res.total,
          page: res.page,
          size: res.size,
          books: res.items.map(shapeBookListItem),
        });
      }),
  );

  server.registerTool(
    "list_smart_scopes",
    {
      title: "List smart scopes",
      description:
        "List the user's smart scopes (saved dynamic filters). Use a returned scope id with " +
        "get_smart_scope_books to read the books it currently matches.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const scopes = await client.listSmartScopes();
        return ok({ count: scopes.length, smartScopes: scopes });
      }),
  );

  server.registerTool(
    "get_smart_scope_books",
    {
      title: "Get books in a smart scope",
      description:
        "List the books matched by one smart scope by scopeId (from list_smart_scopes), " +
        "paginated. Optionally filter with q.",
      inputSchema: {
        scopeId: z
          .number()
          .int()
          .describe("The smart scope id (from list_smart_scopes)."),
        page: z.number().int().min(1).optional().describe("1-based page (default 1)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(MAX_BROWSE_PAGE_SIZE)
          .optional()
          .describe(`Items per page (default ${DEFAULT_BROWSE_PAGE_SIZE}).`),
        q: z.string().optional().describe("Filter within the scope."),
      },
    },
    async ({ scopeId, page, size, q }) =>
      guard(async () => {
        const res = await client.getSmartScopeBooks(scopeId, {
          page: page ?? 1,
          size: size ?? DEFAULT_BROWSE_PAGE_SIZE,
          q,
        });
        return ok({
          scopeId,
          total: res.total,
          page: res.page,
          size: res.size,
          books: res.items.map(shapeBookListItem),
        });
      }),
  );

  // --- Reading state ---------------------------------------------------------

  server.registerTool(
    "get_reading_progress",
    {
      title: "Get reading progress",
      description:
        "Get the user's reading progress for one book by bookId: per-file percentage and " +
        "position (and audiobook progress when present). Use to answer 'where am I in this book'.",
      inputSchema: {
        bookId: z.number().int().describe("The book's id (from search_books)."),
      },
    },
    async ({ bookId }) =>
      guard(async () => {
        const rows = await client.getReadingProgress(bookId);
        const progress = rows.map((p) => ({
          fileId: p.fileId,
          percentage: p.percentage,
          pageNumber: p.pageNumber,
          cfi: p.cfi,
          koreaderProgress: p.koreaderProgress,
          updatedAt: p.updatedAt,
        }));
        let audioProgress: unknown = null;
        try {
          audioProgress = await client.getAudioProgress(bookId);
        } catch {
          // audiobook progress is optional; ignore if the endpoint errors
        }
        return ok({ bookId, progress, audioProgress: audioProgress ?? null });
      }),
  );

  server.registerTool(
    "list_currently_reading",
    {
      title: "List currently reading",
      description:
        "List the books the user is currently reading, each with progress. Use to answer " +
        "'what am I reading right now'.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const res = await client.listCurrentlyReading();
        const books = (res.books ?? []).map((b) => ({
          bookId: b.bookId,
          title: b.title,
          authors: b.authors,
          progress: b.progress,
          fileFormat: b.fileFormat,
        }));
        return ok({ count: books.length, books });
      }),
  );

  server.registerTool(
    "get_reading_sessions",
    {
      title: "Get reading sessions",
      description:
        "Get the user's reading-session history for one book by bookId, paginated, plus " +
        "aggregate stats (total sessions, total/average time, first/last session, pace).",
      inputSchema: {
        bookId: z.number().int().describe("The book's id (from search_books)."),
        page: z.number().int().min(1).optional().describe("1-based page (default 1)."),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(MAX_BROWSE_PAGE_SIZE)
          .optional()
          .describe(`Sessions per page (default ${DEFAULT_BROWSE_PAGE_SIZE}).`),
      },
    },
    async ({ bookId, page, pageSize }) =>
      guard(async () => {
        const res = await client.getReadingSessions(bookId, {
          page,
          pageSize: pageSize ?? DEFAULT_BROWSE_PAGE_SIZE,
        });
        return ok({
          bookId,
          total: res.total,
          page: res.page,
          pageSize: res.pageSize,
          stats: res.stats,
          sessions: res.items,
        });
      }),
  );

  // --- Statistics & libraries ------------------------------------------------

  server.registerTool(
    "get_library_stats",
    {
      title: "Get library statistics",
      description:
        "Get library-wide totals: number of books, authors, series, publishers, genres, " +
        "languages, total storage, the publication-year range, and books added this year.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        return ok(await client.getStatisticsSummary());
      }),
  );

  server.registerTool(
    "get_reading_stats",
    {
      title: "Get reading statistics",
      description:
        "Get the user's personal reading totals: tracked, started, in-progress, and " +
        "completed book counts, plus mean progress percent.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        return ok(await client.getUserStatisticsSummary());
      }),
  );

  server.registerTool(
    "list_libraries",
    {
      title: "List libraries",
      description:
        "List the libraries in the BookOrbit instance with each library's book count, " +
        "total size, and per-format counts.",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const libraries = await client.listLibraries();
        const withStats = await Promise.all(
          libraries.map(async (lib) => {
            let stats = null;
            try {
              stats = await client.getLibraryStats(lib.id);
            } catch {
              // stats are best-effort per library
            }
            return {
              libraryId: lib.id,
              name: lib.name,
              displayOrder: lib.displayOrder,
              stats,
            };
          }),
        );
        return ok({ count: withStats.length, libraries: withStats });
      }),
  );
}
