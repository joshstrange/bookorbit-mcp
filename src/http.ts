import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Stateless SDK transport: no sticky sessions or per-client backend processes. */
export function httpHandler(createServer: () => McpServer, allowedHosts: string[]) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return new Response(null, { status: 404 });
    // Gateway-to-connector traffic is not a browser API. Do not enable CORS.
    if (
      request.headers.has("origin") ||
      !allowedHosts.includes(request.headers.get("host") ?? url.host)
    )
      return new Response(null, { status: 403 });
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer();
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
}
