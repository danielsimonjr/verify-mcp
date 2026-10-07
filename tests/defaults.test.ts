import { describe, expect, test } from "bun:test";

import { driverArgv } from "../src/argv.ts";
import { applyDefaultProfile, DEFAULT_PROFILE_KEYS, type ProfileFields } from "../src/defaults.ts";
import { handleDriver, handleModelCheck, type CommandRunner, type Deps } from "../src/handlers.ts";
import type { RunRequest, RunResult } from "../src/run.ts";

const PROFILE = {
  VERIFY_MCP_PROVIDER: "ollama",
  VERIFY_MCP_MODEL: "qwen3.5:9b",
  VERIFY_MCP_BASE_URL: "http://evo-x2:11434",
  VERIFY_MCP_CONTEXT_SIZE: "65536",
  VERIFY_MCP_ENV: "none",
};

type Input = ProfileFields & { task_dir?: string };
const apply = (input: Input, env: NodeJS.ProcessEnv, withEnv: boolean): Input => applyDefaultProfile<Input>(input, env, withEnv);

describe("applyDefaultProfile", () => {
  test("fills every omitted field when the call names no provider and no model", () => {
    const out = apply({ task_dir: "/t" }, PROFILE, true);
    expect(out).toEqual({
      task_dir: "/t",
      provider: "ollama",
      model: "qwen3.5:9b",
      base_url: "http://evo-x2:11434",
      context_size: 65536,
      env: "none",
    });
  });

  test("keeps a field the call sets", () => {
    const out = apply({ base_url: "http://127.0.0.1:11434", context_size: 8192 }, PROFILE, false);
    expect(out.base_url).toBe("http://127.0.0.1:11434");
    expect(out.context_size).toBe(8192);
    expect(out.model).toBe("qwen3.5:9b");
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

  test("lists the five env keys", () => {
    expect([...DEFAULT_PROFILE_KEYS] as string[]).toEqual(Object.keys(PROFILE));
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
      driverArgv({ task_dir: "/t", provider: "ollama", model: "qwen3.5:9b", base_url: "http://evo-x2:11434", context_size: 65536, env: "none" }),
    );
  });

  test("model-check with no model probes the default", async () => {
    const { calls, deps } = recorder();
    await handleModelCheck({}, deps);
    expect(calls[0]?.args.slice(1)).toEqual([
      "model-check", "--provider", "ollama", "--model", "qwen3.5:9b", "--base-url", "http://evo-x2:11434", "--context-size", "65536",
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
