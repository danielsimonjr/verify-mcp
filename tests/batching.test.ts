import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { batchArgv, batchTimeoutSeconds, driverArgv, workersArgv, workersTimeoutSeconds } from "../src/argv.ts";
import { handleBatch, handleModelCheck, handleWorkers, type CommandRunner, type Deps, type ProgressCtx } from "../src/handlers.ts";
import { VERIFY_VERSION } from "../src/pin.ts";
import type { VerifyLaunch } from "../src/resolve.ts";
import type { RunRequest, RunResult } from "../src/run.ts";
import { batchInput, driverInput, modelCheckInput, workersInput } from "../src/schemas.ts";

function launch(cwd: string): VerifyLaunch {
  return {
    command: "bun",
    args: ["/opt/veriharness/harness/cli.ts"],
    cwd,
    env: { PATH: "/usr/bin" },
    source: "package",
    binPath: "/opt/veriharness/harness/cli.ts",
    verifyRoot: "/opt/veriharness",
    dataDir: join(cwd, "data"),
    runsDir: join(cwd, "runs"),
  };
}

function result(code: number, stdout: string, stderr = ""): RunResult {
  return { code, stdout, stderr, timedOut: false, aborted: false, durationMs: 5 };
}

function deps(runner: CommandRunner, cwd = "/work", env?: NodeJS.ProcessEnv): Deps {
  return { runner, resolveLaunch: () => launch(cwd), env };
}

describe("context_size auto", () => {
  test("the main model takes auto or a positive whole number", () => {
    expect(driverInput.parse({ task_dir: "t", context_size: "auto" }).context_size).toBe("auto");
    expect(driverInput.parse({ task_dir: "t", context_size: 8192 }).context_size).toBe(8192);
    expect(modelCheckInput.safeParse({ context_size: "auto" }).success).toBe(true);
    expect(driverInput.safeParse({ task_dir: "t", context_size: "big" }).success).toBe(false);
    expect(driverInput.safeParse({ task_dir: "t", context_size: 0 }).success).toBe(false);
  });

  test("a role takes auto or a whole number above 4096", () => {
    const role = (context_size: unknown) =>
      driverInput.safeParse({ task_dir: "t", roles: { checker: { provider: "ollama", model: "m", context_size } } }).success;
    expect(role("auto")).toBe(true);
    expect(role(4097)).toBe(true);
    expect(role(4096)).toBe(false);
    expect(role("big")).toBe(false);
  });

  test("auto reaches verify as the word auto", () => {
    const args = driverArgv(
      driverInput.parse({
        task_dir: "t",
        provider: "ollama",
        model: "m",
        context_size: "auto",
        roles: { checker: { provider: "ollama", model: "c", context_size: "auto" } },
      }),
    );
    expect(args).toContain("--context-size");
    expect(args[args.indexOf("--context-size") + 1]).toBe("auto");
    expect(args.slice(-4)).toEqual(["--role", "checker=ollama:c", "--role-context-size", "checker=auto"]);
  });
});

describe("verify_batch", () => {
  test("argv carries every field as its flag", () => {
    const input = batchInput.parse({
      items: "items.md",
      split: "heading:^### (\\d+)$",
      spec: "task.md",
      out: "work",
      shared: ["CHANGELOG.md", "notes"],
      reference: ["corpus.md", "docs"],
      prompt: "prompt.md",
      items_name: "rows.md",
      provider: "ollama",
      model: "qwen3.5:9b-64k",
      base_url: "http://h:11434",
      context_size: "auto",
      chars_per_token: 3.2,
      overhead_tokens: 1500,
      item_tokens: 40,
      max_items: 25,
    });
    expect(batchArgv(input)).toEqual([
      "batch",
      "--items", "items.md",
      "--split", "heading:^### (\\d+)$",
      "--spec", "task.md",
      "--out", "work",
      "--shared", "CHANGELOG.md",
      "--shared", "notes",
      "--reference", "corpus.md",
      "--reference", "docs",
      "--prompt", "prompt.md",
      "--items-name", "rows.md",
      "--provider", "ollama",
      "--model", "qwen3.5:9b-64k",
      "--base-url", "http://h:11434",
      "--context-size", "auto",
      "--chars-per-token", "3.2",
      "--overhead-tokens", "1500",
      "--item-tokens", "40",
      "--max-items", "25",
    ]);
    expect(batchArgv(batchInput.parse({ items: "i", split: "jsonl", spec: "s", out: "o", batch_tokens: 32768 }))).toEqual([
      "batch", "--items", "i", "--split", "jsonl", "--spec", "s", "--out", "o", "--batch-tokens", "32768",
    ]);
    expect(batchTimeoutSeconds(input)).toBe(600);
  });

  test("the schema refuses a budget together with a model, and a bad split rule", () => {
    const base = { items: "i", spec: "s", out: "o" };
    expect(batchInput.safeParse({ ...base, split: "jsonl", batch_tokens: 1000, provider: "ollama", model: "m" }).success).toBe(false);
    expect(batchInput.safeParse({ ...base, split: "lines" }).success).toBe(false);
    expect(batchInput.safeParse({ ...base, split: "heading:" }).success).toBe(false);
    expect(batchInput.safeParse({ ...base, split: "blank-line", context_size: 4096, provider: "ollama", model: "m" }).success).toBe(false);
  });

  test("a finished batch returns manifest.json as structured content", async () => {
    const root = mkdtempSync(join(tmpdir(), "vmcp-batch-"));
    try {
      const manifest = { budget: 32768, budgetSource: "half-window", window: 65536, windowSource: "loaded", batches: [{ name: "b01" }] };
      mkdirSync(join(root, "work"));
      writeFileSync(join(root, "work", "manifest.json"), JSON.stringify(manifest));
      const calls: RunRequest[] = [];
      const runner: CommandRunner = {
        async run(req) {
          calls.push(req);
          return result(0, "", "batch: 1 batch\n");
        },
      };
      const outcome = await handleBatch(
        batchInput.parse({ items: "i", split: "jsonl", spec: "s", out: "work", provider: "ollama", model: "m" }),
        deps(runner, root),
      );
      expect(outcome.isError).toBeUndefined();
      expect(outcome.structured?.manifest).toEqual(manifest);
      expect(calls[0]!.args.slice(1, 3)).toEqual(["batch", "--items"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a workspace file that the spec names and no batch holds is in the text", async () => {
    const root = mkdtempSync(join(tmpdir(), "vmcp-batch-"));
    try {
      const manifest = { budget: 32768, batches: [{ name: "b01" }], missing: [{ file: "rows.md", namedBy: "spec/task.md" }] };
      mkdirSync(join(root, "work"));
      writeFileSync(join(root, "work", "manifest.json"), JSON.stringify(manifest));
      const runner: CommandRunner = { run: async () => result(0, "", "batch: 1 batch\n") };
      const outcome = await handleBatch(
        batchInput.parse({ items: "i", split: "jsonl", spec: "s", out: "work", provider: "ollama", model: "m" }),
        deps(runner, root),
      );
      expect(outcome.isError).toBeUndefined();
      expect(outcome.text).toContain("workspace files named but not held by any batch: rows.md (spec/task.md); items_name sets the items file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the default model profile fills a batch that names no budget and no model", async () => {
    const calls: RunRequest[] = [];
    const runner: CommandRunner = {
      async run(req) {
        calls.push(req);
        return result(2, "", "error: bad\n");
      },
    };
    const profile = { VERIFY_MCP_PROVIDER: "ollama", VERIFY_MCP_MODEL: "p", VERIFY_MCP_BASE_URL: "http://h:11434" };
    await handleBatch(batchInput.parse({ items: "i", split: "jsonl", spec: "s", out: "o" }), deps(runner, "/work", profile));
    expect(calls[0]!.args).toContain("--model");
    await handleBatch(batchInput.parse({ items: "i", split: "jsonl", spec: "s", out: "o", batch_tokens: 900 }), deps(runner, "/work", profile));
    expect(calls[1]!.args).not.toContain("--model");
  });

  test("the profile sets the per-item and fixed token costs, a call overrides them, and nothing is set without them", async () => {
    const calls: RunRequest[] = [];
    const runner: CommandRunner = {
      async run(req) {
        calls.push(req);
        return result(2, "", "error: bad\n");
      },
    };
    const base = { items: "i", split: "jsonl", spec: "s", out: "o", batch_tokens: 900 } as const;
    const profile = { VERIFY_MCP_ITEM_TOKENS: "1500", VERIFY_MCP_OVERHEAD_TOKENS: "1800" };
    await handleBatch(batchInput.parse(base), deps(runner, "/work", profile));
    const filled = calls[0]!.args;
    expect(filled[filled.indexOf("--item-tokens") + 1]).toBe("1500");
    expect(filled[filled.indexOf("--overhead-tokens") + 1]).toBe("1800");
    await handleBatch(batchInput.parse({ ...base, item_tokens: 0 }), deps(runner, "/work", profile));
    const own = calls[1]!.args;
    expect(own[own.indexOf("--item-tokens") + 1]).toBe("0");
    await handleBatch(batchInput.parse(base), deps(runner, "/work", {}));
    expect(calls[2]!.args).not.toContain("--item-tokens");
    expect(calls[2]!.args).not.toContain("--overhead-tokens");
  });
});

describe("verify_workers", () => {
  test("argv carries every field as its flag", () => {
    const input = workersInput.parse({
      dir: "work",
      provider: "ollama",
      model: "qwen3.5:9b-64k",
      base_url: "http://h:11434",
      context_size: 65536,
      count: 3,
      tools: "read,grep",
      deliverable: "report.json",
      prompt: "p.md",
      only: ["b01", "b02"],
      timeout: 1800,
      max_turns: 25,
      schema: "report.schema.json",
      retries: 2,
      nudge_timeout: 120,
      allow_compaction: true,
      max_parallel: 2,
      env: "none",
      temperature: 0.2,
      thinking: "low",
      max_tokens: 8192,
    });
    expect(workersArgv(input)).toEqual([
      "workers", "work",
      "--provider", "ollama",
      "--model", "qwen3.5:9b-64k",
      "--base-url", "http://h:11434",
      "--context-size", "65536",
      "--count", "3",
      "--tools", "read,grep",
      "--deliverable", "report.json",
      "--prompt", "p.md",
      "--only", "b01",
      "--only", "b02",
      "--timeout", "1800",
      "--max-turns", "25",
      "--schema", "report.schema.json",
      "--retries", "2",
      "--nudge-timeout", "120",
      "--allow-compaction",
      "--max-parallel", "2",
      "--env", "none",
      "--temperature", "0.2",
      "--thinking", "low",
      "--max-tokens", "8192",
    ]);
    expect(workersTimeoutSeconds(input)).toBe(43200);
    expect(workersTimeoutSeconds({ ...input, timeout_seconds: 60 })).toBe(60);
  });

  test("max_turns is a positive whole number", () => {
    expect(workersInput.safeParse({ dir: "w", provider: "p", model: "m", max_turns: 15 }).success).toBe(true);
    for (const bad of [0, -1, 2.5]) {
      expect(workersInput.safeParse({ dir: "w", provider: "p", model: "m", max_turns: bad }).success).toBe(false);
    }
  });

  test("retries and nudge_timeout take whole numbers, and nudge_timeout 0 is allowed", () => {
    const base = { dir: "w", provider: "p", model: "m" };
    expect(workersInput.safeParse({ ...base, retries: 0, nudge_timeout: 0 }).success).toBe(true);
    for (const bad of [-1, 1.5]) {
      expect(workersInput.safeParse({ ...base, retries: bad }).success).toBe(false);
      expect(workersInput.safeParse({ ...base, nudge_timeout: bad }).success).toBe(false);
    }
    expect(workersArgv(workersInput.parse({ ...base, nudge_timeout: 0 }))).toContain("0");
    expect(workersArgv(workersInput.parse({ ...base, allow_compaction: false }))).not.toContain("--allow-compaction");
  });

  test("the schema takes env none only", () => {
    expect(workersInput.safeParse({ dir: "w", provider: "p", model: "m", env: "jail" }).success).toBe(false);
  });

  test("each rollout line is one progress notice, and the records and summary come back", async () => {
    const lines = [
      '{"batch":"b01","rollout":"r01","exit":0,"seconds":66,"error":null}',
      "workers: note on stderr",
      '{"batch":"b01","rollout":"r02","exit":1,"seconds":10,"error":"no-json"}',
      '{"summary":{"complete":1,"errors":1,"skipped":0}}',
    ];
    const runner: CommandRunner = {
      async run(req) {
        for (const line of lines) req.onLine?.(line);
        return result(1, [lines[0], lines[2], lines[3]].join("\n") + "\n", "workers: ollama:m window=65536 source=loaded\nworkers: note on stderr\n");
      },
    };
    const notes: { message: string; force: boolean }[] = [];
    const progress: ProgressCtx = {
      notify: async (message, force = false) => {
        notes.push({ message, force });
      },
    };
    const outcome = await handleWorkers(workersInput.parse({ dir: "w", provider: "ollama", model: "m" }), deps(runner), progress);
    expect(notes.filter((n) => n.force && n.message.includes('"rollout"')).length).toBe(2);
    expect(outcome.isError).toBe(true);
    expect(outcome.structured?.exitCode).toBe(1);
    expect(outcome.structured?.rollouts).toEqual([JSON.parse(lines[0]!), JSON.parse(lines[2]!)]);
    expect(outcome.structured?.summary).toEqual({ complete: 1, errors: 1, skipped: 0 });
    expect(outcome.text).toContain("complete 1, errors 1, skipped 0");
    // The text alone says which rollout failed and why: a host that shows only the text of an error
    // result must not lose the outcome of each rollout.
    expect(outcome.text).toContain("b01/r01: complete");
    expect(outcome.text).toContain("b01/r02: no-json");
    expect(outcome.text).toContain("workers: note on stderr");
  });

  test("a retried rollout shows the time of all its attempts, not only the last", async () => {
    const lines = [
      '{"batch":"b01","rollout":"r01","exit":0,"seconds":17,"totalSeconds":95,"attempts":3,"error":"schema"}',
      '{"batch":"b01","rollout":"r02","exit":0,"seconds":20,"totalSeconds":20,"attempts":1,"error":null}',
      '{"summary":{"complete":1,"errors":1,"skipped":0}}',
    ];
    const runner: CommandRunner = { run: async () => result(1, lines.join("\n") + "\n") };
    const outcome = await handleWorkers(workersInput.parse({ dir: "w", provider: "ollama", model: "m" }), deps(runner));
    expect(outcome.text).toContain("b01/r01: schema (17 s, 95 s in all, 3 attempts)");
    expect(outcome.text).toContain("b01/r02: complete (20 s)");
  });

  test("exit 75 says the usage limit stopped the run", async () => {
    const runner: CommandRunner = {
      async run() {
        return result(75, '{"summary":{"complete":0,"errors":1,"skipped":0}}\n');
      },
    };
    const outcome = await handleWorkers(workersInput.parse({ dir: "w", provider: "claude-code", model: "claude-haiku-5-5", env: "none" }), deps(runner));
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("usage limit");
  });
});

describe("pin and model check", () => {
  test("the pin is verify 0.12.0", () => {
    expect(VERIFY_VERSION).toBe("0.12.0");
  });

  test("model check returns the window and its source", async () => {
    const runner: CommandRunner = {
      async run() {
        return result(0, '{"ok":true,"window":65536,"windowSource":"loaded"}\n');
      },
    };
    const outcome = await handleModelCheck(modelCheckInput.parse({ provider: "ollama", model: "m", context_size: "auto" }), deps(runner));
    expect(outcome.structured?.window).toBe(65536);
    expect(outcome.structured?.windowSource).toBe("loaded");
  });
});
