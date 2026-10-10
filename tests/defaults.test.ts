import { describe, expect, test } from "bun:test";

import { driverArgv } from "../src/argv.ts";
import { applyBatchProfile, applyDefaultProfile, DEFAULT_PROFILE_KEYS, type ProfileFields } from "../src/defaults.ts";
import { handleDriver, handleModelCheck, type CommandRunner, type Deps } from "../src/handlers.ts";
import type { RunRequest, RunResult } from "../src/run.ts";

const PROFILE = {
  VERIFY_MCP_PROVIDER: "ollama",
  VERIFY_MCP_MODEL: "sample-model",
  VERIFY_MCP_BASE_URL: "http://models.example:11434",
  VERIFY_MCP_CONTEXT_SIZE: "65536",
  VERIFY_MCP_ENV: "none",
  VERIFY_MCP_THINKING: "low",
  VERIFY_MCP_MAX_TOKENS: "16384",
  VERIFY_MCP_REQUEST_TIMEOUT: "600",
  VERIFY_MCP_NUDGE_TIMEOUT: "900",
};

const BATCH_PROFILE = { VERIFY_MCP_ITEM_TOKENS: "1500", VERIFY_MCP_OVERHEAD_TOKENS: "1800" };

type Input = ProfileFields & { task_dir?: string };
const apply = (input: Input, env: NodeJS.ProcessEnv, withEnv: boolean): Input => applyDefaultProfile<Input>(input, env, withEnv);

describe("applyDefaultProfile", () => {
  test("fills every omitted field when the call names no provider and no model", () => {
    const out = apply({ task_dir: "/t" }, PROFILE, true);
    expect(out).toEqual({
      task_dir: "/t",
      provider: "ollama",
      model: "sample-model",
      base_url: "http://models.example:11434",
      context_size: 65536,
      env: "none",
      thinking: "low",
      max_tokens: 16384,
      request_timeout: 600,
      nudge_timeout: 900,
    });
  });

  test("a tool without driver fields gets only the shared tuning", () => {
    const out = apply({}, PROFILE, false);
    expect(out.max_tokens).toBe(16384);
    expect(out.request_timeout).toBe(600);
    expect(out.thinking).toBeUndefined();
    expect(out.nudge_timeout).toBeUndefined();
    expect(out.env).toBeUndefined();
  });

  test("a bad or empty tuning value is ignored and a call value wins", () => {
    const bad = { ...PROFILE, VERIFY_MCP_MAX_TOKENS: "-5", VERIFY_MCP_REQUEST_TIMEOUT: "x", VERIFY_MCP_NUDGE_TIMEOUT: "0", VERIFY_MCP_THINKING: " " };
    const out = apply({ task_dir: "/t" }, bad, true);
    expect(out.max_tokens).toBeUndefined();
    expect(out.request_timeout).toBeUndefined();
    expect(out.nudge_timeout).toBeUndefined();
    expect(out.thinking).toBeUndefined();
    expect(apply({ max_tokens: 100, thinking: "high" }, PROFILE, true)).toMatchObject({ max_tokens: 100, thinking: "high" });
  });

  test("keeps a field the call sets", () => {
    const out = apply({ base_url: "http://127.0.0.1:11434", context_size: 8192 }, PROFILE, false);
    expect(out.base_url).toBe("http://127.0.0.1:11434");
    expect(out.context_size).toBe(8192);
    expect(out.model).toBe("sample-model");
  });

  test("does not touch a call that names a provider or a model", () => {
    const named = { provider: "claude-code", model: "claude-haiku-4-5-20251001" };
    expect(apply(named, PROFILE, true)).toEqual(named);
    expect(apply({ model: "m" }, PROFILE, true)).toEqual({ model: "m" });
  });

  test("does nothing without a provider and a model in the profile", () => {
    expect(apply({ task_dir: "/t" }, {}, true)).toEqual({ task_dir: "/t" });
    expect(apply({ task_dir: "/t" }, { VERIFY_MCP_MODEL: "m" }, true)).toEqual({ task_dir: "/t" });
  });

  test("ignores a bad context size, a bad env, and the env for a tool that has none", () => {
    const bad = { ...PROFILE, VERIFY_MCP_CONTEXT_SIZE: "abc", VERIFY_MCP_ENV: "sandbox" };
    const out = apply({ task_dir: "/t" }, bad, true);
    expect(out.context_size).toBeUndefined();
    expect(out.env).toBeUndefined();
    expect(apply({}, PROFILE, false).env).toBeUndefined();
  });

  test("lists every env key", () => {
    expect([...DEFAULT_PROFILE_KEYS] as string[]).toEqual([...Object.keys(PROFILE), ...Object.keys(BATCH_PROFILE)]);
  });
});

describe("applyBatchProfile", () => {
  const fill = (input: Record<string, unknown>, env: NodeJS.ProcessEnv) => applyBatchProfile(input as never, env) as Record<string, unknown>;

  test("fills the per-item and fixed token costs a call omits, with no model named", () => {
    expect(fill({ items: "i" }, BATCH_PROFILE)).toEqual({ items: "i", item_tokens: 1500, overhead_tokens: 1800 });
  });

  test("a value in the call wins, including 0", () => {
    expect(fill({ item_tokens: 0, overhead_tokens: 7 }, BATCH_PROFILE)).toEqual({ item_tokens: 0, overhead_tokens: 7 });
  });

  test("sets nothing when the profile has no value, or a value that is not a whole number of tokens", () => {
    expect(fill({ items: "i" }, {})).toEqual({ items: "i" });
    const bad = { VERIFY_MCP_ITEM_TOKENS: "-5", VERIFY_MCP_OVERHEAD_TOKENS: "1.5" };
    expect(fill({ items: "i" }, bad)).toEqual({ items: "i" });
    expect(fill({ items: "i" }, { VERIFY_MCP_ITEM_TOKENS: "abc" })).toEqual({ items: "i" });
  });

  test("0 is a valid profile value: it names the free-item estimate on purpose", () => {
    expect(fill({}, { VERIFY_MCP_ITEM_TOKENS: "0" })).toEqual({ item_tokens: 0 });
  });
});

function recorder(): { calls: RunRequest[]; deps: Deps } {
  const calls: RunRequest[] = [];
  const runner: CommandRunner = {
    async run(req) {
      calls.push(req);
      const res: RunResult = { code: 0, stdout: "{}\n", stderr: "", timedOut: false, aborted: false, durationMs: 1 };
      return res;
    },
  };
  const launch = {
    command: "bun", args: ["/v/cli.ts"], cwd: "/w", env: { PATH: "/usr/bin" }, source: "package" as const,
    binPath: "/v/cli.ts", verifyRoot: "/v", dataDir: "/w/d", runsDir: "/w/r",
  };
  return { calls, deps: { runner, resolveLaunch: () => launch, env: PROFILE } };
}

describe("handlers use the default profile", () => {
  test("driver with no model passes the profile flags", async () => {
    const { calls, deps } = recorder();
    await handleDriver({ task_dir: "/t" }, deps);
    expect(calls[0]?.args.slice(1)).toEqual(
      driverArgv({ task_dir: "/t", provider: "ollama", model: "sample-model", base_url: "http://models.example:11434", context_size: 65536, env: "none", thinking: "low", max_tokens: 16384, request_timeout: 600, nudge_timeout: 900 }),
    );
  });

  test("model-check with no model probes the default", async () => {
    const { calls, deps } = recorder();
    await handleModelCheck({}, deps);
    expect(calls[0]?.args.slice(1)).toEqual([
      "model-check", "--provider", "ollama", "--model", "sample-model", "--base-url", "http://models.example:11434", "--context-size", "65536", "--max-tokens", "16384", "--request-timeout", "600",
    ]);
  });

  test("model-check with no model and no profile is an error that says what to set", async () => {
    const { calls, deps } = recorder();
    const outcome = await handleModelCheck({}, { ...deps, env: {} });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("VERIFY_MCP_MODEL");
    expect(calls.length).toBe(0);
  });
});
