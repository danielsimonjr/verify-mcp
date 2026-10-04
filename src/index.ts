#!/usr/bin/env bun
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { startHttp } from "./http.ts";
import { PROTOCOL_VERSION } from "./protocol.ts";
import { createVerifyServer } from "./server.ts";

const HELP =
  `verify-mcp (MCP ${PROTOCOL_VERSION})\n` +
  `usage: bun src/index.ts [--http [port]]\n` +
  `  stdio is the default and is what the plugins launch\n` +
  `  --http [port]  streamable HTTP on 127.0.0.1 (default port 8787), path /mcp\n`;

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("-")) return undefined;
  return next;
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stderr.write(HELP);
  process.exit(0);
}

const unknown = argv.filter((arg, index) => {
  if (arg === "--http") return false;
  const previous = argv[index - 1];
  if (previous === "--http" && !arg.startsWith("-")) return false;
  return true;
});
if (unknown.length > 0) {
  process.stderr.write(`unknown argument: ${unknown.join(" ")}\n${HELP}`);
  process.exit(2);
}

if (argv.includes("--http")) {
  const raw = flagValue("--http");
  const port = raw === undefined ? 8787 : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`invalid port: ${raw ?? ""}\n`);
    process.exit(2);
  }
  const handle = startHttp(port);
  process.stderr.write(`verify-mcp listening on http://${handle.hostname}:${handle.port}/mcp\n`);
} else {
  serveStdio(() => createVerifyServer());
}
