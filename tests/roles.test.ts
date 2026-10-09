import { describe, expect, test } from "bun:test";

import { ROLES as PINNED_ROLES } from "@danielsimonjr/verify/harness/roles.ts";

import { driverArgv, runnerArgv } from "../src/argv.ts";
import { ROLES, driverInput, runnerInput } from "../src/schemas.ts";

const driver = (roles: unknown) => driverInput.safeParse({ task_dir: "t", roles });
const runner = (roles: unknown) => runnerInput.safeParse({ cells: ["wb:sonnet"], run_name: "r", roles });

describe("roles", () => {
  test("ROLES matches the pinned verify", () => {
    expect([...ROLES]).toEqual([...PINNED_ROLES]);
  });

  test("each role takes provider and model, and a local role a base URL and a context size", () => {
    const roles = {
      checker: { provider: "ollama", model: "qwen3.5:9b", base_url: "http://h:11434", context_size: 32768 },
      reviewer: { provider: "claude-code", model: "claude-opus-5-5" },
    };
    expect(driver(roles).success).toBe(true);
    expect(runner(roles).success).toBe(true);
  });

  test("an unknown role, a missing provider or model, or an unknown field is an error", () => {
    for (const roles of [
      { boss: { provider: "ollama", model: "m" } },
      { checker: { model: "m" } },
      { checker: { provider: "ollama" } },
      { checker: { provider: "", model: "m" } },
      { checker: { provider: "a:b", model: "m" } },
      { checker: { provider: " ", model: "m" } },
      { checker: { provider: "ollama", model: "m", temperature: 0.2 } },
      { checker: { provider: "ollama", model: "m", context_size: 0 } },
      JSON.parse('{"__proto__": {"provider": "ollama", "model": "m"}}'),
    ]) {
      expect(driver(roles).success).toBe(false);
      expect(runner(roles).success).toBe(false);
    }
  });

  test("driver and runner pass one --role per role, in role order, with its server options after it", () => {
    const roles = {
      fixer: { provider: "claude-code", model: "claude-haiku-5-5" },
      checker: { provider: "ollama", model: "qwen3.5:9b", base_url: "http://h:11434", context_size: 32768 },
    };
    const want = [
      "--role", "checker=ollama:qwen3.5:9b",
      "--role-base-url", "checker=http://h:11434",
      "--role-context-size", "checker=32768",
      "--role", "fixer=claude-code:claude-haiku-5-5",
    ];
    const d = driverArgv(driverInput.parse({ task_dir: "t", roles }));
    expect(d.slice(-want.length)).toEqual(want);
    const r = runnerArgv(runnerInput.parse({ cells: ["wb:sonnet"], run_name: "r", roles }));
    expect(r.slice(-want.length)).toEqual(want);
  });

  test("no roles, no role flags", () => {
    expect(driverArgv(driverInput.parse({ task_dir: "t" }))).not.toContain("--role");
    expect(runnerArgv(runnerInput.parse({ cells: ["wb:sonnet"], run_name: "r" }))).not.toContain("--role");
  });
});
