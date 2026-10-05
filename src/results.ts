import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import type { ArtifactName } from "./schemas.ts";

const ARTIFACT_PATH: Record<ArtifactName, string> = {
  ledger_elim: "ledger_elim.json",
  ledger_fals: "ledger_fals.json",
  finish: "finish.json",
  repair: "repair.json",
  driver_log: "driver.log",
  run: "run.json",
  scores: "scores.json",
  scores_partial: "scores.partial.jsonl",
  deliverables: "out/deliverables",
};

const JSON_ARTIFACTS = new Set<ArtifactName>(["ledger_elim", "ledger_fals", "finish", "repair", "run", "scores"]);

export const DEFAULT_MAX_BYTES = 262_144;
export const MAX_DELIVERABLE_ENTRIES = 500;

/** The runs directory, a flag for a missing directory, and the cell folder names of each run. */
export interface RunListing {
  runsDir: string;
  missing: boolean;
  runs: Array<{ name: string; cells: string[] }>;
}

/**
 * One artifact read: the real path, the text, and the truncation flag.
 *
 * `json` holds the parse of a complete JSON artifact. `deliverables` holds the file list of the
 * deliverables folder.
 */
export interface ReadResult {
  path: string;
  artifact: ArtifactName;
  truncated: boolean;
  text: string;
  json?: unknown;
  deliverables?: Array<{ name: string; bytes: number }>;
}

/** Error for a bad result request: an invalid name, a missing or escaping path, or a wrong mix of options. */
export class ResultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultPathError";
  }
}

function assertSegment(label: string, value: string): void {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new ResultPathError(`invalid ${label} '${value}'`);
  }
}

function jail(root: string, target: string): string {
  const rootReal = realpathSync(root);
  const targetReal = realpathSync(target);
  const rel = relative(rootReal, targetReal);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new ResultPathError(`path escapes ${rootReal}`);
  }
  return targetReal;
}

/**
 * Lists the run folders under `runsDir` and the cell folders in each, sorted, without dot folders.
 *
 * `run` keeps only that run. A missing `runsDir` returns `missing: true`. An unreadable run folder
 * lists no cells. Throws ResultPathError when `run` is not one path segment.
 */
export function listRuns(runsDir: string, run?: string): RunListing {
  if (run) assertSegment("run", run);
  if (!existsSync(runsDir)) return { runsDir, missing: true, runs: [] };
  const root = realpathSync(runsDir);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  const selected = run ? names.filter((name) => name === run) : names;
  const runs = selected.map((name) => {
    const dir = join(root, name);
    let cells: string[] = [];
    try {
      cells = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
    } catch {
      cells = [];
    }
    return { name, cells };
  });
  return { runsDir: root, missing: false, runs };
}

function listDeliverables(dir: string): Array<{ name: string; bytes: number }> {
  const out: Array<{ name: string; bytes: number }> = [];
  const walk = (current: string, rel: string) => {
    if (out.length >= MAX_DELIVERABLE_ENTRIES) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (out.length >= MAX_DELIVERABLE_ENTRIES) return;
      if (entry.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full, childRel);
      else if (entry.isFile()) out.push({ name: childRel, bytes: statSync(full).size });
    }
  };
  walk(dir, "");
  return out;
}

/**
 * Returns the first `maxBytes` of a file, and whether more follows.
 *
 * The read stops at `maxBytes + 1` bytes. A driver.log can grow to gigabytes. Loading it whole to
 * return a small slice blocks the server and can exhaust its memory.
 */
export function readPrefix(path: string, maxBytes: number): { bytes: Uint8Array; truncated: boolean } {
  const buf = new Uint8Array(maxBytes + 1);
  const fd = openSync(path, "r");
  try {
    let filled = 0;
    while (filled < buf.length) {
      const n = readSync(fd, buf, filled, buf.length - filled, null);
      if (n === 0) break;
      filled += n;
    }
    return { bytes: buf.subarray(0, Math.min(filled, maxBytes)), truncated: filled > maxBytes };
  } finally {
    closeSync(fd);
  }
}

/**
 * Reads `artifact` under `baseDir`.
 *
 * The folder and the file must both resolve, after symlinks, inside `jailRoot`. A text artifact
 * returns its first `maxBytes`, and a complete JSON artifact also returns its parse.
 * `deliverables` lists up to 500 files with their sizes and skips symlinks. Throws ResultPathError
 * when a path is missing or escapes `jailRoot`, or `deliverables` is not a folder.
 */
export function readArtifact(baseDir: string, jailRoot: string, artifact: ArtifactName, maxBytes: number): ReadResult {
  if (!existsSync(baseDir)) throw new ResultPathError(`directory does not exist: ${baseDir}`);
  const baseReal = jail(jailRoot, baseDir);
  const rel = ARTIFACT_PATH[artifact];
  const full = resolve(baseReal, rel);
  if (!existsSync(full)) throw new ResultPathError(`artifact not found: ${rel} under ${baseReal}`);
  const real = jail(jailRoot, full);
  if (artifact === "deliverables") {
    const info = statSync(real);
    if (!info.isDirectory()) throw new ResultPathError(`deliverables path is not a directory: ${real}`);
    const deliverables = listDeliverables(real);
    return {
      path: real,
      artifact,
      truncated: deliverables.length >= MAX_DELIVERABLE_ENTRIES,
      text: deliverables.map((file) => `${file.bytes}\t${file.name}`).join("\n"),
      deliverables,
    };
  }
  const { bytes, truncated } = readPrefix(real, maxBytes);
  const text = new TextDecoder().decode(bytes);
  let json: unknown;
  if (!truncated && JSON_ARTIFACTS.has(artifact)) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { path: real, artifact, truncated, text, json };
}

/**
 * Picks the folder to read and the jail root.
 *
 * `taskDir` gives both, and excludes `run` and `cell`. Without `taskDir`, `run` and `cell` name a
 * folder under `runsDir`, the jail root. Throws ResultPathError when the options break those rules
 * or a name is not one path segment. Also throws when `taskDir` or `runsDir` is missing.
 */
export function resultBase(options: {
  runsDir: string;
  run?: string;
  cell?: string;
  taskDir?: string;
}): { baseDir: string; jailRoot: string } {
  if (options.taskDir) {
    if (options.run || options.cell) {
      throw new ResultPathError("pass either task_dir or run and cell, not both");
    }
    const baseDir = resolve(options.taskDir);
    if (!existsSync(baseDir)) throw new ResultPathError(`task_dir does not exist: ${baseDir}`);
    return { baseDir, jailRoot: realpathSync(baseDir) };
  }
  if (!options.run || !options.cell) {
    throw new ResultPathError("run and cell are required when task_dir is omitted");
  }
  assertSegment("run", options.run);
  assertSegment("cell", options.cell);
  if (!existsSync(options.runsDir)) throw new ResultPathError(`runs directory does not exist: ${options.runsDir}`);
  const jailRoot = realpathSync(options.runsDir);
  const baseDir = join(jailRoot, options.run, options.cell);
  return { baseDir, jailRoot };
}
