import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BookOrbitClient } from "./bookorbit-client.js";
import { BookOrbitError } from "./bookorbit-client.js";
import type { BookService } from "./book-service.js";
import type { Annotation } from "./types.js";

/** Default cap on chapter text returned per call (~6k tokens). */
const DEFAULT_MAX_CHARS = 24_000;
const MAX_ALLOWED_CHARS = 50_000;

/** Default page size for the annotation hub (matches the server default). */
const DEFAULT_ANNOTATION_PAGE_SIZE = 25;
const MAX_ANNOTATION_PAGE_SIZE = 100;

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
      return fail(`Book Orbit error (${err.status}) on ${err.path}: ${err.message}`);
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
        "Search the Book Orbit library by title, author, or series. Returns matching " +
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
        "the book's own chapterTitle/chapterIndex. NOTE: chapterIndex is Book Orbit's own " +
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
}
