import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listRuns, readArtifact, ResultPathError, resultBase } from "../src/results.ts";

describe("results", () => {
  test("lists runs and reads a jailed artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-runs-"));
    const cell = join(root, "nightly", "wb_flash");
    mkdirSync(cell, { recursive: true });
    writeFileSync(join(cell, "finish.json"), JSON.stringify({ decision: "keep" }));
    mkdirSync(join(cell, "out", "deliverables"), { recursive: true });
    writeFileSync(join(cell, "out", "deliverables", "report.txt"), "hello");

    const listing = listRuns(root);
    expect(listing.missing).toBe(false);
    expect(listing.runs).toEqual([{ name: "nightly", cells: ["wb_flash"] }]);
    expect(listRuns(join(root, "missing")).missing).toBe(true);

    const located = resultBase({ runsDir: root, run: "nightly", cell: "wb_flash" });
    const finish = readArtifact(located.baseDir, located.jailRoot, "finish", 1000);
    expect(finish.json).toEqual({ decision: "keep" });
    const files = readArtifact(located.baseDir, located.jailRoot, "deliverables", 1000);
    expect(files.deliverables).toEqual([{ name: "report.txt", bytes: 5 }]);
  });

  test("rejects path escape", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-jail-"));
    const outside = mkdtempSync(join(tmpdir(), "verify-outside-"));
    mkdirSync(join(root, "nightly"), { recursive: true });
    symlinkSync(outside, join(root, "nightly", "escape"));
    expect(() => resultBase({ runsDir: root, run: "nightly", cell: "../nightly" })).toThrow(ResultPathError);
    const located = resultBase({ runsDir: root, run: "nightly", cell: "escape" });
    expect(() => readArtifact(located.baseDir, located.jailRoot, "finish", 100)).toThrow(ResultPathError);
  });
});
