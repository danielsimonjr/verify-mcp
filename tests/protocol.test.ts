import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { envRecord } from "../src/resolve.ts";
import { startHttp } from "../src/http.ts";
import { PROTOCOL_VERSION } from "../src/protocol.ts";
import { TOOL_NAMES } from "../src/server.ts";

const ROOT = join(import.meta.dir, "..");
const FAKE = join(ROOT, "tests", "fixtures", "fake-veriharness.ts");
const bun = Bun.which("bun") ?? process.execPath;

function client(): Client {
  return new Client(
    { name: "verify-mcp-test", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: PROTOCOL_VERSION } } },
  );
}

describe("MCP protocol", () => {
  test("stdio negotiates 2026-07-28, lists tools, and calls them", async () => {
    const runs = mkdtempSync(join(tmpdir(), "verify-mcp-runs-"));
    mkdirSync(join(runs, "nightly", "wb_flash"), { recursive: true });
    const transport = new StdioClientTransport({
      command: bun,
      args: ["src/index.ts"],
      cwd: ROOT,
      stderr: "pipe",
      env: {
        ...envRecord(),
        VERIHARNESS_BIN: FAKE,
        VERIHARNESS_RUNS: runs,
        VERIHARNESS_DATA: join(runs, "data"),
      },
    });
    const mcp = client();
    try {
      await mcp.connect(transport);
      expect(mcp.getProtocolEra()).toBe("modern");
      expect(mcp.getNegotiatedProtocolVersion()).toBe(PROTOCOL_VERSION);
      expect(PROTOCOL_VERSION).toBe("2026-07-28");

      const discovered = mcp.getDiscoverResult() ?? (await mcp.discover());
      expect(discovered.supportedVersions).toContain("2026-07-28");
      expect(discovered.capabilities.tools).toBeDefined();
      expect(discovered.capabilities.logging).toBeUndefined();
      expect("sampling" in discovered.capabilities).toBe(false);

      const listed = await mcp.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
      // destructiveHint false means "additive updates only". These four overwrite or delete files:
      // the driver rewrites MISSION.md and finish.json, the runner and materialize remove existing
      // task workspaces, and score replaces scores.json.
      const destructive = listed.tools.filter((tool) => tool.annotations?.destructiveHint).map((tool) => tool.name);
      expect(destructive.sort()).toEqual(["verify_driver", "verify_materialize", "verify_runner", "verify_score"]);

      // A client builds its call from this schema: lane_max must name each lane and allow no other key.
      const runner = listed.tools.find((tool) => tool.name === "verify_runner");
      const laneMax = (runner?.inputSchema.properties as Record<string, Record<string, unknown>> | undefined)?.lane_max;
      expect(Object.keys((laneMax?.properties as object | undefined) ?? {}).sort()).toEqual(["fable", "haiku", "opus", "sonnet"]);
      expect(laneMax?.additionalProperties).toBe(false);

      const checked = await mcp.callTool({
        name: "verify_model_check",
        arguments: { provider: "ollama", model: "qwen" },
      });
      expect(checked.isError).toBeFalsy();
      const checkedText = checked.content.find((block) => block.type === "text");
      expect(checkedText && "text" in checkedText ? checkedText.text : "").toContain("qwen");

      const runsResult = await mcp.callTool({ name: "verify_list_runs", arguments: {} });
      expect(runsResult.isError).toBeFalsy();
      expect(runsResult.structuredContent).toMatchObject({
        runs: [{ name: "nightly", cells: ["wb_flash"] }],
      });
    } finally {
      await mcp.close();
    }
  }, 30_000);

  test("streamable HTTP negotiates the same protocol version", async () => {
    const http = startHttp(0);
    const mcp = client();
    try {
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://${http.hostname}:${http.port}/mcp`)));
      expect(mcp.getProtocolEra()).toBe("modern");
      expect(mcp.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const listed = await mcp.listTools();
      expect(listed.tools.length).toBe(TOOL_NAMES.length);
    } finally {
      await mcp.close();
      await http.close();
    }
  }, 30_000);
});
