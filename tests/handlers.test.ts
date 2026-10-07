import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { driverArgv } from "../src/argv.ts";
import {
  handleDriver,
  handleListRuns,
  handleModelCheck,
  handleReadResult,
  handleStatus,
  type CommandRunner,
  type Deps,
} from "../src/handlers.ts";
import { VERIFY_SPEC } from "../src/pin.ts";
import { VerifyNotInstalledError, type VerifyLaunch } from "../src/resolve.ts";
import type { RunRequest, RunResult } from "../src/run.ts";
import { driverInput, modelCheckInput, runnerInput } from "../src/schemas.ts";

function launch(over: Partial<VerifyLaunch> = {}): VerifyLaunch {
  return {
    command: "bun",
    args: ["/opt/veriharness/harness/cli.ts"],
    cwd: "/work",
    env: { PATH: "/usr/bin" },
    source: "package",
    binPath: "/opt/veriharness/harness/cli.ts",
    verifyRoot: "/opt/veriharness",
    dataDir: "/work/data",
    runsDir: "/work/runs",
    ...over,
  };
}

function ok(stdout: string, stderr = ""): RunResult {
  return { code: 0, stdout, stderr, timedOut: false, aborted: false, durationMs: 5 };
}

function deps(runner: CommandRunner, current = launch()): Deps {
  return { runner, resolveLaunch: () => current };
}

describe("handlers", () => {
  test("schemas reject a bad cell and accept a driver payload", () => {
    expect(() => runnerInput.parse({ cells: ["nocolon"], run_name: "r" })).toThrow();
    expect(driverInput.parse({ task_dir: "/t", provider: "llama.cpp", model: "m" }).provider).toBe("llama.cpp");
    expect(() => modelCheckInput.parse({ provider: "ollama" })).toThrow();
  });

  test("driver passes argv and returns stdout", async () => {
    const calls: RunRequest[] = [];
    const runner: CommandRunner = {
      async run(req) {
        calls.push(req);
        return ok("done\n");
      },
    };
    const outcome = await handleDriver({ task_dir: "/tasks/one", provider: "ollama", model: "qwen" }, deps(runner));
    expect(outcome.isError).toBeUndefined();
    expect(calls[0]?.args.slice(1)).toEqual(driverArgv({ task_dir: "/tasks/one", provider: "ollama", model: "qwen" }));
    expect(calls[0]?.timeoutMs).toBe(3720 * 1000);
    expect(outcome.text).toContain("done");
  });

  test("model-check parses JSON, reports a missing command, and a down server", async () => {
    const cases: Array<{ result: RunResult; includes: string; error: boolean }> = [
      { result: ok('{"provider":"ollama","model":"qwen"}\n'), includes: "ollama", error: false },
      {
        result: { code: 2, stdout: "", stderr: "unknown command: model-check\n", timedOut: false, aborted: false, durationMs: 3 },
        includes: "does not include model-check",
        error: true,
      },
      {
        result: { code: 1, stdout: "", stderr: "error: Ollama is not reachable at http://127.0.0.1:11434\n", timedOut: false, aborted: false, durationMs: 3 },
        includes: "The local model server is down.",
        error: true,
      },
    ];
    for (const item of cases) {
      const outcome = await handleModelCheck(
        { provider: "ollama", model: "qwen" },
        deps({ async run() { return item.result; } }),
      );
      expect(Boolean(outcome.isError)).toBe(item.error);
      expect(outcome.text).toContain(item.includes);
    }
  });

  // A VERIHARNESS_BIN checkout from before verify PR #11 knows only the local providers.
  test("model-check explains a verify build without the Claude Code provider", async () => {
    const outcome = await handleModelCheck(
      { provider: "claude-code", model: "claude-haiku-4-5-20251001" },
      deps({
        async run() {
          const stderr = "error: provider 'claude-code' is not a local backend (expected ollama or llamacpp)\n";
          return { code: 2, stdout: "", stderr, timedOut: false, aborted: false, durationMs: 3 };
        },
      }),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("does not include the Claude Code provider");
    expect(outcome.text).toContain("is not a local backend");
  });

  // The pin moves; the commit that added model-check does not.
  test("the missing model-check text names the commit that added it, not the pin", async () => {
    const outcome = await handleModelCheck(
      { provider: "ollama", model: "qwen" },
      deps({
        async run() {
          return { code: 2, stdout: "", stderr: "unknown command: model-check\n", timedOut: false, aborted: false, durationMs: 3 };
        },
      }),
    );
    expect(outcome.text).toContain("756bc2b");
  });

  test("timeout and missing install are errors", async () => {
    const timed = await handleDriver(
      { task_dir: "/t" },
      deps({
        async run() {
          return { code: null, stdout: "", stderr: "", timedOut: true, aborted: false, durationMs: 50 };
        },
      }),
    );
    expect(timed.isError).toBe(true);
    expect(timed.text).toContain("timed out");

    const missing = await handleStatus(
      {},
      {
        runner: { async run() { throw new Error("should not run"); } },
        resolveLaunch() {
          throw new VerifyNotInstalledError("gone.");
        },
      },
    );
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("verify is not installed");
    expect(missing.structured?.error).toBe("verify_not_installed");
  });

  test("status reports model-check from usage text", async () => {
    const outcome = await handleStatus(
      {},
      deps({
        async run() {
          return ok("", "commands:\n  driver        run\n  model-check   probe\n");
        },
      }),
    );
    expect(outcome.structured?.modelCheck).toBe(true);
    expect(outcome.structured?.pin).toBe(VERIFY_SPEC);
  });

  test("list and read use the launch runs directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "verify-handler-"));
    const cell = join(root, "run-a", "wb_flash");
    mkdirSync(cell, { recursive: true });
    writeFileSync(join(cell, "ledger_elim.json"), '{"n":1}');
    const current = launch({ runsDir: root });
    const listed = await handleListRuns({}, deps({ async run() { throw new Error("no"); } }, current));
    expect(listed.isError).toBeUndefined();
    expect(listed.structured?.runs).toEqual([{ name: "run-a", cells: ["wb_flash"] }]);
    const read = await handleReadResult(
      { run: "run-a", cell: "wb_flash", artifact: "ledger_elim" },
      deps({ async run() { throw new Error("no"); } }, current),
    );
    expect(read.structured?.json).toEqual({ n: 1 });
    const escaped = await handleReadResult(
      { run: "..", cell: "wb_flash", artifact: "finish" },
      deps({ async run() { throw new Error("no"); } }, current),
    );
    expect(escaped.isError).toBe(true);
  });
});
