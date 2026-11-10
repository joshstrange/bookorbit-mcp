import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedBook, SectionWithSize } from "./types.js";

/** PDF.js performs parsing locally; no OCR, model, subprocess, or external parser service. */
export async function parsePdf(
  data: Uint8Array,
  bookId: number,
  title: string,
  author: string,
): Promise<{ parsed: ParsedBook; texts: string[] }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const assets = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
  const task = getDocument({
    cMapUrl: join(assets, "cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: join(assets, "standard_fonts/"),
    wasmUrl: join(assets, "wasm/"),
    data: new Uint8Array(data),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 2000)
      throw new Error("PDF exceeds the 2000-page extraction limit.");
    const labels = new Map<number, string[]>();
    async function outline(
      nodes: Awaited<ReturnType<typeof pdf.getOutline>>,
    ): Promise<void> {
      for (const item of nodes ?? []) {
        const destination =
          typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
        if (Array.isArray(destination) && destination[0] != null) {
          const page =
            typeof destination[0] === "number"
              ? destination[0] + 1
              : (await pdf.getPageIndex(destination[0])) + 1;
          if (page >= 1 && page <= pdf.numPages)
            labels.set(page, [...(labels.get(page) ?? []), item.title]);
        }
        await outline(item.items);
      }
    }
    await outline(await pdf.getOutline());
    const starts = labels.size
      ? [...new Set([1, ...labels.keys()])].sort((a, b) => a - b)
      : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const texts: string[] = [];
    const sections: SectionWithSize[] = [];
    const requiresOcrPages: number[] = [];
    let totalChars = 0;
    for (const [index, pageStart] of starts.entries()) {
      const pageEnd = (starts[index + 1] ?? pdf.numPages + 1) - 1;
      const pages: string[] = [];
      for (let number = pageStart; number <= pageEnd; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
          .join("")
          .trim();
        if (!text) requiresOcrPages.push(number);
        pages.push(`[Page ${number}]\n${text}`);
        totalChars += pages[pages.length - 1].length + (number > pageStart ? 2 : 0);
        if (totalChars > 10_000_000)
          throw new Error("PDF exceeds the 10-million-character extraction limit.");
        page.cleanup();
      }
      const text = pages.join("\n\n");
      texts.push(text);
      sections.push({
        index,
        label: labels.get(pageStart)?.join(" / ") ?? `Page ${pageStart}`,
        spineHref: `pdf:page:${pageStart}`,
        startAnchor: null,
        endAnchor: null,
        pageStart,
        pageEnd,
        charCount: text.length,
        wordCount: text.trim().split(/\s+/).length,
      });
    }
    return {
      parsed: {
        bookId,
        title,
        author,
        sections,
        totalChars,
        format: "pdf",
        requiresOcrPages,
      },
      texts,
    };
  } finally {
    await task.destroy();
  }
}
