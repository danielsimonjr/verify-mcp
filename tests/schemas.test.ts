import { describe, expect, test } from "bun:test";

import { BENCHES as PINNED_BENCHES, LANES as PINNED_LANES } from "verify/harness/config.ts";

import { BENCHES, LANES, driverInput, modelCheckInput, runnerInput } from "../src/schemas.ts";

const ok = (input: Record<string, unknown>) => runnerInput.safeParse({ cells: ["wb:flash"], run_name: "nightly", ...input });

describe("runner input", () => {
  // The pinned runner builds join(RUNS, run_name, `${bench}_${pool}`) and deletes an existing task
  // workspace under it, so a separator or a dot segment in either value reaches outside RUNS.
  test("rejects a pool or run name that is not one path segment", () => {
    for (const cell of ["wb:x/../../../outside", "wb:..", "wb:.", "wb:a\\b", "wb:.hidden"]) {
      expect(ok({ cells: [cell], lane: "flash" }).success).toBe(false);
    }
    for (const run_name of ["../escape", "a/b", "a\\b", "..", ".", ".hidden"]) {
      expect(ok({ run_name }).success).toBe(false);
    }
    expect(ok({ cells: ["wb:flash", "apex:my-pool_2"], lane: "opus", run_name: "run-2026.10.04" }).success).toBe(true);
  });

  test("rejects a bench the pinned runner does not know", () => {
    expect(ok({ cells: ["nope:flash"] }).success).toBe(false);
  });

  // An unknown lane or a cap that is not a positive integer reaches the scheduler as a NaN
  // comparison, which is never true, so the task never starts and the runner waits forever.
  test("rejects a lane or a cell cap the scheduler cannot use", () => {
    expect(ok({ lane: "bogus" }).success).toBe(false);
    for (const cell_cap of ["wb=0", "wb=ten", "wb", "wb=3,", "nope=3", "wb=-1"]) {
      expect(ok({ cell_cap }).success).toBe(false);
    }
    expect(ok({ lane: "flash", cell_cap: "wb=3" }).success).toBe(true);
    expect(ok({ cell_cap: "wb=3,default=5" }).success).toBe(true);
  });

  // The pinned runner reads --lane-max LANE=N and throws on an unknown lane or a cap below 1.
  test("accepts lane caps for known lanes only, as positive integers", () => {
    expect(ok({ lane_max: { haiku: 4, sonnet: 1 } }).success).toBe(true);
    for (const lane_max of [{ bogus: 2 }, { haiku: 0 }, { haiku: 1.5 }, { haiku: -1 }, JSON.parse('{"__proto__": 3}'), { constructor: 3 }]) {
      expect(ok({ lane_max }).success).toBe(false);
    }
  });

  // The pinned runner applies --max-flash, then --lane-max over it, so one of two values is dropped.
  test("refuses a cap set twice for one lane", () => {
    expect(ok({ max_flash: 3, lane_max: { flash: 5 } }).success).toBe(false);
    expect(ok({ max_opus: 3, lane_max: { opus: 5 } }).success).toBe(false);
    expect(ok({ max_flash: 3, lane_max: { haiku: 5 } }).success).toBe(true);
  });

  test("passes the execution environment the Claude Code lanes need", () => {
    expect(ok({ cells: ["wb:haiku"], env: "none" }).success).toBe(true);
    expect(ok({ env: "docker" }).success).toBe(false);
  });

  test("documents skip_inflight in minutes, the unit the runner reads", () => {
    expect(runnerInput.shape.skip_inflight.description).toMatch(/minutes/i);
  });
});

describe("provider text", () => {
  // The pinned verify runs Claude Code as provider claude-code; a caller that reads only the schema
  // must learn that it exists and that it needs env none.
  test("every provider field names claude-code", () => {
    expect(modelCheckInput.shape.provider.description).toMatch(/claude-code/);
    expect(driverInput.shape.provider.description).toMatch(/claude-code/);
    expect(runnerInput.shape.provider.description).toMatch(/claude-code/);
    expect(runnerInput.shape.env.description).toMatch(/none/);
  });
});

describe("mirrors of the pinned verify config", () => {
  test("benches and lanes match the pinned runner", () => {
    expect([...BENCHES].sort()).toEqual([...PINNED_BENCHES].sort());
    const lanes: string[] = [...LANES].sort();
    expect(lanes).toEqual(Object.keys(PINNED_LANES).sort());
  });
});
