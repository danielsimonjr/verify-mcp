import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import { createVerifyServer } from "./server.ts";

/** The bound port and hostname of the HTTP server, and `close`, which stops the MCP handler and the server. */
export interface HttpHandle {
  port: number;
  hostname: string;
  close: () => Promise<void>;
}

/**
 * Serves Streamable HTTP on the loopback address.
 *
 * `createMcpHandler` serves protocol revision 2026-07-28. With the default `legacy: 'stateless'`,
 * it still answers a 2025 initialize. `responseMode: 'auto'` upgrades a response to SSE when a
 * tool sends progress. HTTP+SSE is not implemented.
 */
export function startHttp(port = 8787, hostname = "127.0.0.1"): HttpHandle {
  const handler = createMcpHandler(() => createVerifyServer(), { responseMode: "auto" });
  const server = Bun.serve({
    hostname,
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
      const rejected =
        hostHeaderValidationResponse(req, localhostAllowedHostnames()) ??
        originValidationResponse(req, localhostAllowedOrigins());
      if (rejected) return rejected;
      return handler.fetch(req);
    },
  });
  return {
    port: server.port ?? port,
    hostname,
    close: async () => {
      await handler.close();
      await server.stop(true);
    },
  };
}
