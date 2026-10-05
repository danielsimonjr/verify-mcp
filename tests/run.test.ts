import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  // The pinned driver runs each agent turn as a DETACHED child and only its own timer kills it.
  // Detached, the child leads its own process group (POSIX) and leaves the parent's job object
  // (Windows), so killing the driver's group or the driver alone leaves the turn running.
  // The stop comes when the grandchild says it has started, not after a fixed delay: two Bun cold
  // starts can take longer than any fixed delay on a loaded host, and a stop that lands before the
  // grandchild exists proves nothing. A timeout and an abort run the same stop().
  test("kills a detached grandchild when stopped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-grandchild-"));
    const started = join(dir, "started");
    const survived = join(dir, "survived");
    const grandchild =
      `const fs = require("node:fs"); fs.writeFileSync(${JSON.stringify(started)}, "x");` +
      `await Bun.sleep(2500); fs.writeFileSync(${JSON.stringify(survived)}, "x")`;
    const parent =
      `Bun.spawn([process.execPath, "-e", ${JSON.stringify(grandchild)}], { stdio: ["ignore", "ignore", "ignore"], detached: true });` +
      `await Bun.sleep(30_000)`;
    const stop = new AbortController();
    const run = runProcess({ command: bun, args: ["-e", parent], env: envRecord(), timeoutMs: 20_000, signal: stop.signal });
    for (let waited = 0; !existsSync(started) && waited < 15_000; waited += 50) await Bun.sleep(50);
    expect(existsSync(started)).toBe(true);
    stop.abort();
    const result = await run;
    expect(result.aborted).toBe(true);
    // Longer than the grandchild's 2.5 s sleep, so a grandchild that survived has written its file.
    await Bun.sleep(3500);
    expect(existsSync(survived)).toBe(false);
  }, 30_000);

  // A child that ignores SIGTERM outlives the first stop, so the timeout fires as well. A second stop
  // would arm a second SIGKILL timer that `finally` never clears, aimed at a stale pid list. On
  // Windows taskkill /F ends the child at once, so there the timeout never fires.
  test("stops once: an abort followed by a timeout stays an abort", async () => {
    const result = await runProcess({
      command: bun,
      args: ["-e", "process.on('SIGTERM', () => {}); await Bun.sleep(30_000)"],
      env: envRecord(),
      timeoutMs: 300,
      signal: AbortSignal.abort(),
    });
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
  }, 10_000);

  test("extracts a trailing JSON object", () => {
    expect(extractJson('log line\n{"score":1}\n')).toEqual({ score: 1 });
    expect(extractJson("not json")).toBeUndefined();
  });
});
