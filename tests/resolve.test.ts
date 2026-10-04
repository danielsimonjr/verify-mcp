import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";

import { VERIFY_GIT_REF } from "../src/pin.ts";
import { VerifyNotInstalledError, resolveVerifyLaunch } from "../src/resolve.ts";

describe("resolveVerifyLaunch", () => {
  test("resolves the pinned package CLI with bun and moves data out of node_modules", () => {
    const launch = resolveVerifyLaunch({ ...process.env, VERIHARNESS_BIN: undefined, VERIHARNESS_DATA: undefined, VERIHARNESS_RUNS: undefined });
    expect(launch.source).toBe("package");
    expect(launch.command).toContain("bun");
    // Segments, not a "/" pattern: a Windows path separates with "\".
    expect(launch.args[0]!.split(sep).slice(-4)).toEqual(["node_modules", "veriharness", "harness", "cli.ts"]);
    expect(launch.dataDir).toBe(join(process.cwd(), "data"));
    expect(launch.runsDir).toBe(join(process.cwd(), "runs"));
    expect(launch.env.VERIHARNESS_DATA).toBe(launch.dataDir);
    expect(launch.env.VERIHARNESS_RUNS).toBe(launch.runsDir);
  });

  test("keeps an explicit data directory and expands a checkout bin", () => {
    const root = mkdtempSync(join(tmpdir(), "verify-bin-"));
    const cli = join(root, "harness", "cli.ts");
    mkdirSync(join(root, "harness"), { recursive: true });
    writeFileSync(cli, "export {}\n");
    const launch = resolveVerifyLaunch({
      ...process.env,
      VERIHARNESS_BIN: cli,
      VERIHARNESS_DATA: "~/verify-data-does-not-need-to-exist",
      VERIHARNESS_RUNS: undefined,
    });
    expect(launch.source).toBe("VERIHARNESS_BIN");
    expect(launch.args).toEqual([cli]);
    expect(launch.verifyRoot).toBe(root);
    expect(launch.dataDir).toBe(join(homedir(), "verify-data-does-not-need-to-exist"));
    expect(launch.env.VERIHARNESS_DATA).toBe(launch.dataDir);
    expect(launch.env.VERIHARNESS_RUNS).toBeUndefined();
    expect(launch.runsDir).toBe(join(root, "runs"));
  });

  test("missing VERIHARNESS_BIN names the pin", () => {
    expect(() => resolveVerifyLaunch({ ...process.env, VERIHARNESS_BIN: "/no/such/veriharness" })).toThrow(VerifyNotInstalledError);
    try {
      resolveVerifyLaunch({ ...process.env, VERIHARNESS_BIN: "/no/such/veriharness" });
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyNotInstalledError);
      expect((err as Error).message).toContain(VERIFY_GIT_REF);
      expect((err as Error).message).toContain("bun install");
    }
  });
});
