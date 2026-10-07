import { describe, expect, test } from "bun:test";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as (ajv: Ajv) => Ajv;

import { DEFAULT_PROFILE_KEYS } from "../src/defaults.ts";
import { VERIFY_PACKAGE, VERIFY_VERSION } from "../src/pin.ts";
import { PROTOCOL_VERSION, SERVER_VERSION } from "../src/protocol.ts";

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
    assertValid(ajv, "tests/fixtures/claude-plugin.schema.json", readJson("plugin/.claude-plugin/plugin.json"));
    assertValid(ajv, "tests/fixtures/claude-marketplace.schema.json", readJson(".claude-plugin/marketplace.json"));
    assertValid(ajv, "tests/fixtures/cursor-plugin.schema.json", readJson(".cursor-plugin/plugin.json"));
    const modern = draft2020();
    assertValid(modern, "tests/fixtures/agent-plugin.schema.json", readJson("plugin.json"));
    assertValid(modern, "tests/fixtures/agent-mcp.schema.json", readJson("mcp.json"));
  });

  test("the Claude Code plugin is plugin/ and launches the committed bundle on bun", () => {
    // A plugin cache clone has no node_modules, so src/index.ts cannot resolve its imports there.
    const marketplace = readJson(".claude-plugin/marketplace.json") as { plugins: Array<{ source: string }> };
    expect(marketplace.plugins.map((plugin) => plugin.source)).toEqual(["./plugin"]);
    const claude = readJson("plugin/.mcp.json") as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };
    expect(Object.keys(claude.mcpServers)).toEqual(["verify"]);
    const server = claude.mcpServers.verify!;
    expect(server.command).toBe("bun");
    expect(server.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/bundle/index.mjs"]);
    // The CLI is spawned from a real checkout; it is not in the bundle.
    expect(server.env?.VERIHARNESS_BIN?.endsWith("/harness/cli.ts")).toBe(true);
  });

  test("the plugin ships no default model: each VERIFY_MCP_* variable passes through empty", () => {
    // A machine sets its own default model in its own settings. The repository names no model or host.
    const claude = readJson("plugin/.mcp.json") as { mcpServers: { verify: { env?: Record<string, string> } } };
    const profile = Object.entries(claude.mcpServers.verify.env ?? {}).filter(([key]) => key.startsWith("VERIFY_MCP_"));
    expect(profile.map(([key]) => key).sort()).toEqual([...DEFAULT_PROFILE_KEYS].sort());
    for (const [key, value] of profile) expect(value).toBe(`\${${key}:-}`);
  });

  test("the Codex and Cursor registrations launch bun on src/index.ts", () => {
    const cursor = readJson("mcp.cursor.json") as { mcpServers: Record<string, { command: string; args: string[] }> };
    const codex = readJson("mcp.json") as {
      mcpServers: Record<string, { command: string; args: string[]; type: string; cwd: string }>;
    };
    for (const entry of [...mcpCommands(cursor), ...mcpCommands(codex)]) {
      expect(entry.command).toBe("bun");
      expect(entry.args.join(" ")).toContain("src/index.ts");
      expect(entry.args.join(" ")).not.toContain("dist/");
      expect(entry.command).not.toBe("node");
    }
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
    const pkg = readJson("package.json") as { dependencies: Record<string, string> };
    expect(pkg.dependencies[VERIFY_PACKAGE]).toBe(VERIFY_VERSION);
    expect(pkg.dependencies).not.toHaveProperty("verify");
    expect(pkg.dependencies).not.toHaveProperty("veriharness");
    expect(pkg.dependencies["@modelcontextprotocol/server"]).toBe("2.3.0");
    expect(PROTOCOL_VERSION).toBe("2026-07-28");
    const pin = readFileSync(join(ROOT, "src", "pin.ts"), "utf8");
    expect(pin).toContain(VERIFY_VERSION);
  });

  test("every manifest carries the package.json version", () => {
    // Claude Code caches a plugin per version, so a manifest left behind on a bump ships nothing.
    const version = (readJson("package.json") as { version: string }).version;
    const marketplace = readJson(".claude-plugin/marketplace.json") as { version: string; plugins: Array<{ version: string }> };
    const found: Record<string, string> = {
      "plugin.json": (readJson("plugin.json") as { version: string }).version,
      ".codex-plugin/plugin.json": (readJson(".codex-plugin/plugin.json") as { version: string }).version,
      ".cursor-plugin/plugin.json": (readJson(".cursor-plugin/plugin.json") as { version: string }).version,
      "plugin/.claude-plugin/plugin.json": (readJson("plugin/.claude-plugin/plugin.json") as { version: string }).version,
      ".claude-plugin/marketplace.json": marketplace.version,
      ".claude-plugin/marketplace.json plugins[0]": marketplace.plugins[0]!.version,
      "src/protocol.ts SERVER_VERSION": SERVER_VERSION,
    };
    for (const [where, value] of Object.entries(found)) expect(`${where}: ${value}`).toBe(`${where}: ${version}`);
  });
});
