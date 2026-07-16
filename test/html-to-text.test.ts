import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { htmlToText } from "../src/html-to-text.js";

const chapterXhtml = readFileSync(
  fileURLToPath(new URL("./fixtures/chapter-bundle.xhtml", import.meta.url)),
  "utf8",
);

test("strips tags and decodes entities, preserving paragraph breaks", () => {
  const html =
    "<body><h1>Title</h1><p>Hello &amp; <b>world</b>.</p><p>Second&#8212;para.</p></body>";
  const text = htmlToText(html);
  assert.equal(text, "Title\n\nHello & world.\n\nSecond—para.");
});

test("drops script and style content", () => {
  const html =
    "<body><style>.x{color:red}</style><p>Keep</p><script>alert(1)</script></body>";
  assert.equal(htmlToText(html), "Keep");
});

test("anchor range extracts only the requested slice", () => {
  const html =
    '<body><p>intro</p><h2 id="ch002">Two</h2><p>alpha</p><h2 id="ch003">Three</h2><p>beta</p></body>';
  const slice = htmlToText(html, "ch002", "ch003");
  assert.match(slice, /Two/);
  assert.match(slice, /alpha/);
  assert.doesNotMatch(slice, /intro/);
  assert.doesNotMatch(slice, /beta/);
  assert.doesNotMatch(slice, /Three/);
});

test("null start extracts from the top up to the first anchor", () => {
  const html = '<body><p>intro</p><h2 id="ch002">Two</h2><p>alpha</p></body>';
  const slice = htmlToText(html, null, "ch002");
  assert.match(slice, /intro/);
  assert.doesNotMatch(slice, /alpha/);
});

test("real bundled chapter file: slicing isolates one chapter", () => {
  const first = htmlToText(chapterXhtml, null, "ch002");
  const second = htmlToText(chapterXhtml, "ch002", "ch003");
  assert.ok(first.length > 200, "first chapter should have substantial text");
  assert.ok(second.length > 200, "second chapter should have substantial text");
  // The two slices are different content.
  assert.notEqual(first.slice(0, 200), second.slice(0, 200));
  // Whole-file extraction is larger than any single slice.
  const whole = htmlToText(chapterXhtml);
  assert.ok(whole.length > first.length);
});
