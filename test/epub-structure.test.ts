import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSections } from "../src/epub-structure.js";
import type { EpubInfo } from "../src/types.js";

const info: EpubInfo = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/epub-info.json", import.meta.url)),
    "utf8",
  ),
);

test("resolveSections produces contiguous zero-based indexes", () => {
  const sections = resolveSections(info);
  assert.ok(sections.length > 0);
  sections.forEach((s, i) => assert.equal(s.index, i));
});

test("every section maps to a real spine file", () => {
  const spineHrefs = new Set(info.spine.map((s) => s.href));
  for (const s of resolveSections(info)) {
    assert.ok(spineHrefs.has(s.spineHref), `unknown spineHref ${s.spineHref}`);
  }
});

test("bundled chapters in one spine file become distinct anchored sections", () => {
  const sections = resolveSections(info);
  const bundled = sections.filter((s) => s.spineHref.endsWith("bundle.xhtml"));
  // Fixture bundles 13 chapters in a single spine file.
  assert.ok(bundled.length >= 10, `expected many sections, got ${bundled.length}`);
  // First one starts at the top of the file (no anchor) and ends at the next anchor.
  assert.equal(bundled[0].startAnchor, null);
  assert.equal(bundled[0].endAnchor, "ch002");
  // A later one is delimited by consecutive anchors.
  const ch002 = bundled[1];
  assert.equal(ch002.startAnchor, "ch002");
  assert.equal(ch002.endAnchor, "ch003");
  // Human-meaningful labels survive.
  assert.match(bundled[0].label, /Arrival/i);
});

test("meaningful chapter labels are preserved from the TOC", () => {
  const labels = resolveSections(info).map((s) => s.label);
  assert.ok(labels.some((l) => /The Signal/i.test(l)));
});

test("spine files absent from the TOC get a fallback label", () => {
  const sections = resolveSections(info);
  const appendix = sections.find((s) => s.spineHref.endsWith("appendix.xhtml"));
  assert.ok(appendix, "appendix spine item should produce a section");
  assert.match(appendix!.label, /appendix/i);
});
