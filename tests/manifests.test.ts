import { describe, expect, test } from "bun:test";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv) => Ajv;

import { VERIFY_GIT_REF } from "../src/pin.ts";
import { PROTOCOL_VERSION } from "../src/protocol.ts";

const ROOT = join(import.meta.dir, "..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

function draft07() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv;
}

function draft2020() {
  return new Ajv2020({ strict: false, allErrors: true });
}

function assertValid(ajv: Ajv | Ajv2020, schemaPath: string, document: unknown) {
  const validate = ajv.compile(readJson(schemaPath) as object);
  const ok = validate(document);
  expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
  expect(ok).toBe(true);
}

function mcpCommands(document: { mcpServers: Record<string, { command?: string; args?: string[] }> }): Array<{ command: string; args: string[] }> {
  return Object.values(document.mcpServers).map((server) => ({
    command: server.command ?? "",
    args: server.args ?? [],
  }));
}

describe("manifests", () => {
  test("claude, cursor, and agent plugin files match their published schemas", () => {
    const ajv = draft07();
    assertValid(ajv, "tests/fixtures/claude-plugin.schema.json", readJson(".claude-plugin/plugin.json"));
    assertValid(ajv, "tests/fixtures/claude-marketplace.schema.json", readJson(".claude-plugin/marketplace.json"));
    assertValid(ajv, "tests/fixtures/cursor-plugin.schema.json", readJson(".cursor-plugin/plugin.json"));
    const modern = draft2020();
    assertValid(modern, "tests/fixtures/agent-plugin.schema.json", readJson("plugin.json"));
    assertValid(modern, "tests/fixtures/agent-mcp.schema.json", readJson("mcp.json"));
  });

  test("every MCP registration launches bun on src/index.ts", () => {
    const claude = readJson(".mcp.json") as { mcpServers: Record<string, { command: string; args: string[] }> };
    const cursor = readJson("mcp.cursor.json") as { mcpServers: Record<string, { command: string; args: string[] }> };
    const codex = readJson("mcp.json") as {
      mcpServers: Record<string, { command: string; args: string[]; type: string; cwd: string }>;
    };
    for (const entry of [...mcpCommands(claude), ...mcpCommands(cursor), ...mcpCommands(codex)]) {
      expect(entry.command).toBe("bun");
      expect(entry.args.join(" ")).toContain("src/index.ts");
      expect(entry.args.join(" ")).not.toContain("dist/");
      expect(entry.command).not.toBe("node");
    }
    expect(claude.mcpServers.verify?.args[0]).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(cursor.mcpServers.verify?.args[0]).toContain("${CURSOR_PLUGIN_ROOT}");
    expect(codex.mcpServers.verify?.type).toBe("stdio");
    expect(codex.mcpServers.verify?.cwd).toBe("./");

    const cursorPlugin = readJson(".cursor-plugin/plugin.json") as { mcpServers: string };
    expect(cursorPlugin.mcpServers).toBe("./mcp.cursor.json");
    const codexLegacy = readJson(".codex-plugin/plugin.json") as { skills: string; mcpServers: string };
    expect(codexLegacy.skills.startsWith("./")).toBe(true);
    expect(codexLegacy.mcpServers).toBe("./mcp.json");
  });

  test("the package pin and protocol revision match the source of truth", () => {
    const pkg = readJson("package.json") as { dependencies: { veriharness: string; "@modelcontextprotocol/server": string } };
    expect(pkg.dependencies.veriharness).toContain(VERIFY_GIT_REF);
    expect(pkg.dependencies["@modelcontextprotocol/server"]).toBe("2.3.0");
    expect(PROTOCOL_VERSION).toBe("2026-07-28");
    const pin = readFileSync(join(ROOT, "src", "pin.ts"), "utf8");
    expect(pin).toContain(VERIFY_GIT_REF);
  });
});
