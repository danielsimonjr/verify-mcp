import { describe, expect, test } from "bun:test";

import {
  driverArgv,
  driverTimeoutSeconds,
  envDeriveArgv,
  modelCheckArgv,
  modelCheckTimeoutSeconds,
  parseHelpCommands,
  runnerArgv,
  scoreArgv,
} from "../src/argv.ts";
import type { DriverInput, ModelCheckInput, RunnerInput, ScoreInput } from "../src/schemas.ts";

const driver = (extra: Partial<DriverInput> = {}): DriverInput => ({
  task_dir: "/tmp/task",
  ...extra,
});

describe("argv", () => {
  test("driver forwards only the flags the caller set", () => {
    expect(driverArgv(driver())).toEqual(["driver", "/tmp/task"]);
    expect(
      driverArgv(
        driver({
          contract: "pick-only",
          provider: "ollama",
          model: "qwen",
          skill: ["a", "b"],
          no_skills: true,
          env: "none",
          task_timeout: 10,
        }),
      ),
    ).toEqual([
      "driver",
      "/tmp/task",
      "--contract",
      "pick-only",
      "--skill",
      "a",
      "--skill",
      "b",
      "--no-skills",
      "--env",
      "none",
      "--task-timeout",
      "10",
      "--provider",
      "ollama",
      "--model",
      "qwen",
    ]);
  });

  test("driver timeout is task_timeout plus 120 seconds", () => {
    expect(driverTimeoutSeconds(driver())).toBe(3720);
    expect(driverTimeoutSeconds(driver({ task_timeout: 10 }))).toBe(130);
    expect(driverTimeoutSeconds(driver({ timeout_seconds: 5 }))).toBe(5);
  });

  test("model-check timeout is request_timeout plus 30 seconds", () => {
    const input: ModelCheckInput = { provider: "llamacpp", model: "m" };
    expect(modelCheckArgv(input)).toEqual(["model-check", "--provider", "llamacpp", "--model", "m"]);
    expect(modelCheckTimeoutSeconds(input)).toBe(210);
    expect(modelCheckTimeoutSeconds({ ...input, request_timeout: 10 })).toBe(40);
  });

  test("runner requires cells and a run name and repeats flags", () => {
    const input: RunnerInput = {
      cells: ["wb:flash", "apex:opus"],
      run_name: "nightly",
      only: ["k1"],
      driver_arg: ["--thinking", "high"],
    };
    expect(runnerArgv(input)).toEqual([
      "runner",
      "--run-name",
      "nightly",
      "--cells",
      "wb:flash",
      "--cells",
      "apex:opus",
      "--only",
      "k1",
      "--driver-arg",
      "--thinking",
      "--driver-arg",
      "high",
    ]);
  });

  test("runner passes env and one --lane-max per lane, in lane order", () => {
    const input: RunnerInput = {
      cells: ["wb:sonnet"],
      run_name: "cc",
      env: "none",
      lane_max: { sonnet: 3, haiku: 4 },
    };
    expect(runnerArgv(input)).toEqual([
      "runner",
      "--run-name",
      "cc",
      "--cells",
      "wb:sonnet",
      "--lane-max",
      "haiku=4",
      "--lane-max",
      "sonnet=3",
      "--env",
      "none",
    ]);
  });

  test("runner raises the cap of a Claude Code lane in use to 4 when the call sets none", () => {
    const base: RunnerInput = { cells: ["wb:sonnet", "wb:haiku", "wb:flash"], run_name: "cc", env: "none" };
    expect(runnerArgv(base)).toEqual([
      "runner", "--run-name", "cc",
      "--cells", "wb:sonnet", "--cells", "wb:haiku", "--cells", "wb:flash",
      "--lane-max", "haiku=4", "--lane-max", "sonnet=4",
      "--env", "none",
    ]);
    // a cap the call sets wins; a lane the cells do not use gets no flag
    expect(runnerArgv({ cells: ["wb:sonnet"], run_name: "cc", lane_max: { sonnet: 1 } })).toEqual([
      "runner", "--run-name", "cc", "--cells", "wb:sonnet", "--lane-max", "sonnet=1",
    ]);
    expect(runnerArgv({ cells: ["wb:sonnet"], run_name: "cc" })).not.toContain("haiku=4");
  });

  test("model-check passes claude-code with its model id", () => {
    expect(modelCheckArgv({ provider: "claude-code", model: "claude-haiku-4-5-20251001" })).toEqual([
      "model-check",
      "--provider",
      "claude-code",
      "--model",
      "claude-haiku-4-5-20251001",
    ]);
  });

  test("score and env-derive", () => {
    const score: ScoreInput = { cell_dir: "/runs/nightly/wb_flash", json: true };
    expect(scoreArgv(score)).toEqual(["score", "/runs/nightly/wb_flash", "--json"]);
    expect(envDeriveArgv({ jobs: 2, only: ["base:tag"] })).toEqual(["env-derive", "--jobs", "2", "--only", "base:tag"]);
  });

  test("parses command names from veriharness --help", () => {
    const usage = `usage: veriharness <command> [args]

commands:
  driver        run one task workspace
  model-check   probe a local Ollama or llama.cpp server
`;
    expect(parseHelpCommands(usage)).toEqual(["driver", "model-check"]);
  });
});
