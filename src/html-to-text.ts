import { parse, type HTMLElement, type Node } from "node-html-parser";

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

/** Tags whose text content should be dropped entirely. */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "LINK", "META", "SVG"]);

/** Block-level tags that force a paragraph break around their content. */
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
  "FIGURE",
  "FIGCAPTION",
  "TABLE",
  "TR",
  "HR",
]);

type Token =
  { kind: "text"; value: string } | { kind: "break" } | { kind: "anchor"; id: string };

function tokenize(node: Node, out: Token[]): void {
  for (const child of node.childNodes) {
    if (child.nodeType === NODE_TYPE_TEXT) {
      const value = (child as unknown as { text: string }).text;
      if (value) out.push({ kind: "text", value });
      continue;
    }
    if (child.nodeType !== NODE_TYPE_ELEMENT) continue;

    const el = child as HTMLElement;
    const tag = el.tagName?.toUpperCase() ?? "";
    if (SKIP_TAGS.has(tag)) continue;

    const id = el.getAttribute("id");
    if (id) out.push({ kind: "anchor", id });

    if (tag === "BR") {
      out.push({ kind: "break" });
      continue;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) out.push({ kind: "break" });
    tokenize(el, out);
    if (isBlock) out.push({ kind: "break" });
  }
}

function renderTokens(tokens: Token[]): string {
  const parts: string[] = [];
  for (const t of tokens) {
    if (t.kind === "text") {
      // Collapse internal whitespace runs to single spaces.
      parts.push(t.value.replace(/\s+/g, " "));
    } else if (t.kind === "break") {
      parts.push("\n\n");
    }
  }
  return parts
    .join("")
    .replace(/[ \t]*\n[ \t]*/g, "\n") // trim spaces around newlines
    .replace(/\n{3,}/g, "\n\n") // collapse blank-line runs
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Convert an XHTML document (or an anchor-delimited slice of one) to plain
 * text, preserving paragraph breaks.
 *
 * @param html        The raw XHTML string.
 * @param startAnchor Element id where extraction begins; null = document start.
 * @param endAnchor   Element id where extraction ends (exclusive); null = end.
 */
export function htmlToText(
  html: string,
  startAnchor: string | null = null,
  endAnchor: string | null = null,
): string {
  const root = parse(html, { comment: false });
  const tokens: Token[] = [];
  tokenize(root, tokens);

  let startIdx = 0;
  if (startAnchor) {
    const i = tokens.findIndex((t) => t.kind === "anchor" && t.id === startAnchor);
    if (i >= 0) startIdx = i;
  }

  let endIdx = tokens.length;
  if (endAnchor) {
    const i = tokens.findIndex(
      (t, idx) => idx > startIdx && t.kind === "anchor" && t.id === endAnchor,
    );
    if (i >= 0) endIdx = i;
  }

  return renderTokens(tokens.slice(startIdx, endIdx));
}
