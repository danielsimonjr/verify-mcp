import { describe, expect, test } from "bun:test";

import { envRecord } from "../src/resolve.ts";
import { extractJson, runProcess } from "../src/run.ts";

const bun = Bun.which("bun") ?? process.execPath;

describe("runProcess", () => {
  test("captures stdout and stderr", async () => {
    const result = await runProcess({
      command: bun,
      args: ["-e", "console.log('hello-out'); console.error('hello-err')"],
      env: envRecord(),
      timeoutMs: 10_000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hello-out");
    expect(result.stderr).toContain("hello-err");
    expect(result.timedOut).toBe(false);
  });

  test("kills the process group on timeout", async () => {
    const lines: string[] = [];
    const result = await runProcess({
      command: bun,
      args: ["-e", "console.log('started'); await Bun.sleep(30_000)"],
      env: envRecord(),
      timeoutMs: 400,
      onLine: (line) => lines.push(line),
    });
    expect(result.timedOut).toBe(true);
    expect(lines.some((line) => line.includes("started"))).toBe(true);
  }, 10_000);

  test("extracts a trailing JSON object", () => {
    expect(extractJson('log line\n{"score":1}\n')).toEqual({ score: 1 });
    expect(extractJson("not json")).toBeUndefined();
  });
});
