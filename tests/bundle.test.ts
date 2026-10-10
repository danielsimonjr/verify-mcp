import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPlugin, ROOT } from "../scripts/bundle.ts";
import { envRecord } from "../src/resolve.ts";
import { TOOL_NAMES } from "../src/server.ts";

const FAKE = join(ROOT, "tests", "fixtures", "fake-veriharness.ts");
const bun = Bun.which("bun") ?? process.execPath;

/** A Windows checkout can hold CRLF copies; the comparison is about content. */
const lf = (text: string) => text.replace(/\r\n/g, "\n");

describe("plugin/", () => {
  test("committed files match a fresh build (run `bun run bundle` after changing src/, commands/ or skills/)", async () => {
    for (const [rel, text] of await buildPlugin()) {
      const committed = readFileSync(join(ROOT, "plugin", rel), "utf8");
      expect(lf(committed) === lf(text), `plugin/${rel} is stale`).toBe(true);
    }
    // A cold esbuild load right after `bun install` can pass bun's 5 s test timeout on a scanned disk.
  }, 30_000);

  test("the bundle runs with no node_modules in reach and lists every tool", async () => {
    // Copy the bundle out of the repository: run in place, module resolution would walk up to
    // the repository's node_modules and hide a dependency the bundle failed to inline.
    const dir = mkdtempSync(join(tmpdir(), "verify-mcp-bundle-"));
    const bundle = join(dir, "index.mjs");
    copyFileSync(join(ROOT, "plugin", "bundle", "index.mjs"), bundle);
    const transport = new StdioClientTransport({
      command: bun,
      args: [bundle],
      cwd: dir,
      stderr: "pipe",
      env: { ...envRecord(), VERIHARNESS_BIN: FAKE, VERIHARNESS_RUNS: join(dir, "runs"), VERIHARNESS_DATA: join(dir, "data") },
    });
    const mcp = new Client({ name: "verify-mcp-bundle-test", version: "0.0.0" });
    try {
      await mcp.connect(transport);
      const listed = await mcp.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
      const status = await mcp.callTool({ name: "verify_status", arguments: {} });
      expect(status.isError).toBeFalsy();
    } finally {
      await mcp.close();
    }
  }, 30_000);
});
