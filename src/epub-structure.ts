import type { EpubInfo, Section, TocNode } from "./types.js";

interface FlatTocEntry {
  label: string;
  spineHref: string;
  fragment: string | null;
}

/** Split "OPS/x.xhtml#ch002" into { spineHref, fragment }. */
function splitHref(href: string): { spineHref: string; fragment: string | null } {
  const hashIdx = href.indexOf("#");
  if (hashIdx === -1) return { spineHref: href, fragment: null };
  return {
    spineHref: href.slice(0, hashIdx),
    fragment: href.slice(hashIdx + 1) || null,
  };
}

/** Depth-first flatten of the nested TOC into ordered entries with an href. */
function flattenToc(node: TocNode, out: FlatTocEntry[]): void {
  if (node.href) {
    const { spineHref, fragment } = splitHref(node.href);
    out.push({ label: node.label.trim() || spineHref, spineHref, fragment });
  }
  for (const child of node.children ?? []) flattenToc(child, out);
}

/** Turn a spine idref like "xhtml_009_part002" into a readable fallback label. */
function labelFromIdref(idref: string): string {
  const cleaned = idref
    .replace(/^xhtml[_-]?/i, "")
    .replace(/^\d+[_-]?/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!cleaned) return idref;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Resolve an EPUB's spine + TOC into an ordered list of reading sections.
 *
 * Sections follow spine (reading) order. For each spine file, TOC entries that
 * point into it become sections sliced by anchor ranges; spine files absent
 * from the TOC become a single whole-file section labeled from their idref.
 */
export function resolveSections(info: EpubInfo): Section[] {
  const flat: FlatTocEntry[] = [];
  flattenToc(info.toc, flat);

  // Group TOC entries by the spine file they reference, preserving order.
  const byFile = new Map<string, FlatTocEntry[]>();
  for (const entry of flat) {
    const list = byFile.get(entry.spineHref);
    if (list) list.push(entry);
    else byFile.set(entry.spineHref, [entry]);
  }

  const sections: Section[] = [];
  for (const item of info.spine) {
    const entries = byFile.get(item.href);
    if (!entries || entries.length === 0) {
      sections.push({
        index: 0,
        label: labelFromIdref(item.idref),
        spineHref: item.href,
        startAnchor: null,
        endAnchor: null,
      });
      continue;
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const next = entries[i + 1];
      sections.push({
        index: 0,
        label: entry.label,
        spineHref: item.href,
        startAnchor: entry.fragment,
        endAnchor: next ? next.fragment : null,
      });
    }
  }

  sections.forEach((s, i) => (s.index = i));
  return sections;
}
