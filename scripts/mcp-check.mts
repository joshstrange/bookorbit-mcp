/**
 * Verifies the built MCP server over stdio: connects, lists tools, and calls
 * a couple. Run after `npm run build`: node --import tsx scripts/mcp-check.mts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), ".env");
if (existsSync(envPath)) (process as any).loadEnvFile?.(envPath);

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
  env: process.env as Record<string, string>,
});
const client = new Client({ name: "mcp-check", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const search = await client.callTool({
  name: "search_books",
  arguments: { query: "Absolution", limit: 2 },
});
const books = JSON.parse((search.content as any)[0].text);
console.log(
  "search_books ->",
  books.map((b: any) => `${b.bookId}:${b.title}(epub=${b.hasEpub})`).join(", "),
);

const list = await client.callTool({
  name: "list_chapters",
  arguments: { bookId: books[0].bookId },
});
const toc = JSON.parse((list.content as any)[0].text);
console.log(`list_chapters -> ${toc.chapterCount} chapters, ${toc.totalChars} chars`);

const chap = await client.callTool({
  name: "get_chapter",
  arguments: { bookId: books[0].bookId, chapter: 7, maxChars: 120 },
});
const c = JSON.parse((chap.content as any)[0].text);
console.log(
  `get_chapter[7] -> "${c.label}" hasMore=${c.hasMore}: ${JSON.stringify(c.text.slice(0, 80))}`,
);

await client.close();
console.log("MCP CHECK OK");
