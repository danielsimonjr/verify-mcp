import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";

import { createVerifyServer } from "./server.ts";

export interface HttpHandle {
  port: number;
  hostname: string;
  close: () => Promise<void>;
}

/**
 * Streamable HTTP on loopback. `createMcpHandler` serves protocol revision
 * 2026-07-28 and, with the default `legacy: 'stateless'`, still answers a
 * 2025 initialize. `responseMode: 'auto'` upgrades to SSE when a tool emits
 * progress. HTTP+SSE is not implemented.
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
