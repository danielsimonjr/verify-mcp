import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { VERIFY_PACKAGE, VERIFY_SPEC } from "./pin.ts";

const require = createRequire(import.meta.url);

/**
 * Error for a missing Bun or veriharness CLI.
 *
 * The message adds the pinned package spec, and tells the user to run `bun install` or set
 * VERIHARNESS_BIN.
 */
export class VerifyNotInstalledError extends Error {
  constructor(detail: string) {
    super(
      `verify is not installed. ${detail} verify-mcp pins verify to ${VERIFY_SPEC}. ` +
        `Run \`bun install\` in the verify-mcp directory, or set ` +
        `VERIHARNESS_BIN to the veriharness executable or to harness/cli.ts.`,
    );
    this.name = "VerifyNotInstalledError";
  }
}

/** How to spawn veriharness: command, arguments, cwd and env, the source of the CLI, and the resolved paths. */
export interface VerifyLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  source: "VERIHARNESS_BIN" | "package";
  binPath: string;
  verifyRoot: string;
  dataDir: string;
  runsDir: string;
}

/** Copies `base` into a plain record and drops each variable that has no string value. */
export function envRecord(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Expands `~` and a leading `~/` to the home folder. Returns other paths unchanged. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function looksLikeBun(path: string): boolean {
  return (path.split(sep).pop() ?? "").includes("bun");
}

/**
 * Finds the Bun executable.
 *
 * The order is `BUN_BIN`, then `bun` on PATH, then the current process when its file name holds
 * "bun". Throws VerifyNotInstalledError when `BUN_BIN` names a missing file, or when the search
 * finds no Bun.
 */
export function resolveBun(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.BUN_BIN;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    const expanded = resolve(expandHome(fromEnv));
    if (!existsSync(expanded)) {
      throw new VerifyNotInstalledError(`BUN_BIN=${fromEnv} does not exist.`);
    }
    return expanded;
  }
  const which = Bun.which("bun");
  if (which) return which;
  if (looksLikeBun(process.execPath) && existsSync(process.execPath)) return process.execPath;
  throw new VerifyNotInstalledError("Bun is not on PATH. Install Bun from https://bun.sh and retry.");
}

function isPackagedRoot(verifyRoot: string): boolean {
  const parts = resolve(verifyRoot).split(sep);
  return parts.includes("node_modules") && parts[parts.length - 1] === "verify";
}

/**
 * Resolves the data and runs folders and the child env.
 *
 * A non-empty `VERIHARNESS_DATA` or `VERIHARNESS_RUNS` sets its folder. Otherwise a packaged install
 * (node_modules/@danielsimonjr/verify) uses `cwd`/data and `cwd`/runs, and a checkout uses `verifyRoot`/data
 * and `verifyRoot`/runs. The child env gets the resolved path when the variable was set or the
 * install is packaged.
 */
export function harnessLocations(
  verifyRoot: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): { env: Record<string, string>; dataDir: string; runsDir: string } {
  const child = envRecord(env);
  const packaged = isPackagedRoot(verifyRoot);
  const dataRaw = env.VERIHARNESS_DATA;
  const runsRaw = env.VERIHARNESS_RUNS;
  const dataSet = typeof dataRaw === "string" && dataRaw.length > 0;
  const runsSet = typeof runsRaw === "string" && runsRaw.length > 0;
  const dataDir = dataSet
    ? resolve(expandHome(dataRaw))
    : packaged
      ? resolve(cwd, "data")
      : resolve(verifyRoot, "data");
  const runsDir = runsSet
    ? resolve(expandHome(runsRaw))
    : packaged
      ? resolve(cwd, "runs")
      : resolve(verifyRoot, "runs");
  if (dataSet || packaged) child.VERIHARNESS_DATA = dataDir;
  if (runsSet || packaged) child.VERIHARNESS_RUNS = runsDir;
  return { env: child, dataDir, runsDir };
}

function rootFromBin(binPath: string): string {
  const normalized = resolve(binPath);
  if (normalized.endsWith(`${sep}harness${sep}cli.ts`) || normalized.endsWith(`${sep}harness${sep}cli.js`)) {
    return resolve(normalized, "..", "..");
  }
  return dirname(normalized);
}

/**
 * Builds the VerifyLaunch from `VERIHARNESS_BIN` or from the installed verify package.
 *
 * A non-empty `VERIHARNESS_BIN` comes first: a TypeScript or JavaScript file runs under Bun, and any
 * other file runs directly. Otherwise Bun runs harness/cli.ts from the package. Throws
 * VerifyNotInstalledError when Bun, the configured file, the package or its CLI is missing.
 */
export function resolveVerifyLaunch(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): VerifyLaunch {
  const bun = resolveBun(env);
  const configured = env.VERIHARNESS_BIN;
  let command: string;
  let args: string[];
  let binPath: string;
  let source: VerifyLaunch["source"];
  let verifyRoot: string;

  if (typeof configured === "string" && configured.length > 0) {
    binPath = resolve(expandHome(configured));
    if (!existsSync(binPath)) {
      throw new VerifyNotInstalledError(`VERIHARNESS_BIN=${configured} does not exist.`);
    }
    source = "VERIHARNESS_BIN";
    verifyRoot = rootFromBin(binPath);
    if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(binPath)) {
      command = bun;
      args = [binPath];
    } else {
      command = binPath;
      args = [];
    }
  } else {
    let pkgJson: string;
    try {
      pkgJson = require.resolve(`${VERIFY_PACKAGE}/package.json`);
    } catch {
      throw new VerifyNotInstalledError("The verify package is not installed.");
    }
    verifyRoot = dirname(pkgJson);
    binPath = join(verifyRoot, "harness", "cli.ts");
    if (!existsSync(binPath)) {
      throw new VerifyNotInstalledError(`Expected the CLI at ${binPath}.`);
    }
    command = bun;
    args = [binPath];
    source = "package";
  }

  const locations = harnessLocations(verifyRoot, env, cwd);
  return {
    command,
    args,
    cwd,
    env: locations.env,
    source,
    binPath,
    verifyRoot,
    dataDir: locations.dataDir,
    runsDir: locations.runsDir,
  };
}
