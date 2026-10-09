import {
  LANES,
  type DriverInput,
  type EnvDeriveInput,
  type GradeInput,
  type MaterializeInput,
  type ModelCheckInput,
  type RunnerInput,
  type ScoreInput,
} from "./schemas.ts";

/** Local model fields that `appendLocalModel` turns into veriharness flags. */
export interface LocalFlags {
  provider?: string;
  model?: string;
  base_url?: string;
  context_size?: number;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  request_timeout?: number;
}

/** Converts seconds to milliseconds, rounded to the nearest integer. */
export function timeoutMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/**
 * Appends one flag to `args` for each local model field in `input`.
 *
 * The flag name is the field name with hyphens, for example `base_url` gives `--base-url`. A string
 * field adds its flag only when not empty. A number field adds its flag when defined, 0 included.
 */
export function appendLocalModel(args: string[], input: LocalFlags): void {
  if (input.provider) args.push("--provider", input.provider);
  if (input.model) args.push("--model", input.model);
  if (input.base_url) args.push("--base-url", input.base_url);
  if (input.context_size !== undefined) args.push("--context-size", String(input.context_size));
  if (input.temperature !== undefined) args.push("--temperature", String(input.temperature));
  if (input.max_tokens !== undefined) args.push("--max-tokens", String(input.max_tokens));
  if (input.top_p !== undefined) args.push("--top-p", String(input.top_p));
  if (input.request_timeout !== undefined) args.push("--request-timeout", String(input.request_timeout));
}

function pushSkills(args: string[], skill: string[] | undefined, noSkills: boolean | undefined, mode: string | undefined): void {
  for (const name of skill ?? []) args.push("--skill", name);
  if (noSkills) args.push("--no-skills");
  if (mode) args.push("--skills-mode", mode);
}

/** Builds the status argv: `--help` alone. The usage text lists the veriharness commands. */
export function statusArgv(): string[] {
  return ["--help"];
}

/** Returns `timeout_seconds`, or the default of 30 seconds. */
export function statusTimeoutSeconds(input: { timeout_seconds?: number }): number {
  return input.timeout_seconds ?? 30;
}

/** Builds `model-check` followed by the local model flags. */
export function modelCheckArgv(input: ModelCheckInput): string[] {
  const args = ["model-check"];
  appendLocalModel(args, input);
  return args;
}

/**
 * Returns `timeout_seconds`, or `request_timeout` plus 30.
 *
 * An unset `request_timeout` counts as 180, so the default is 210 seconds.
 */
export function modelCheckTimeoutSeconds(input: ModelCheckInput): number {
  if (input.timeout_seconds !== undefined) return input.timeout_seconds;
  return (input.request_timeout ?? 180) + 30;
}

/**
 * Builds `driver <task_dir>` and one flag for each option that `input` sets.
 *
 * `skill` adds one `--skill` flag per name. The local model flags come last.
 */
export function driverArgv(input: DriverInput): string[] {
  const args = ["driver", input.task_dir];
  if (input.contract) args.push("--contract", input.contract);
  if (input.thinking) args.push("--thinking", input.thinking);
  pushSkills(args, input.skill, input.no_skills, input.skills_mode);
  if (input.env) args.push("--env", input.env);
  if (input.turn_timeout !== undefined) args.push("--turn-timeout", String(input.turn_timeout));
  if (input.nudge_timeout !== undefined) args.push("--nudge-timeout", String(input.nudge_timeout));
  if (input.task_timeout !== undefined) args.push("--task-timeout", String(input.task_timeout));
  appendLocalModel(args, input);
  return args;
}

/**
 * Returns `timeout_seconds`, or `task_timeout` plus 120.
 *
 * An unset `task_timeout` counts as 3600, so the default is 3720 seconds.
 */
export function driverTimeoutSeconds(input: DriverInput): number {
  if (input.timeout_seconds !== undefined) return input.timeout_seconds;
  return (input.task_timeout ?? 3600) + 120;
}

/**
 * Builds `runner --run-name <run_name>` and one `--cells` flag per cell.
 *
 * Each option that `input` sets adds a flag. `only`, `skill` and `driver_arg` add one flag per
 * entry, and `lane_max` one `--lane-max LANE=N` per lane, in LANES order. The local model flags come last.
 */
export function runnerArgv(input: RunnerInput): string[] {
  const args = ["runner", "--run-name", input.run_name];
  for (const cell of input.cells) args.push("--cells", cell);
  if (input.contract) args.push("--contract", input.contract);
  if (input.lane) args.push("--lane", input.lane);
  if (input.max_flash !== undefined) args.push("--max-flash", String(input.max_flash));
  if (input.max_opus !== undefined) args.push("--max-opus", String(input.max_opus));
  for (const lane of LANES) {
    const cap = input.lane_max?.[lane];
    if (cap !== undefined) args.push("--lane-max", `${lane}=${cap}`);
  }
  if (input.env) args.push("--env", input.env);
  if (input.cell_cap) args.push("--cell-cap", input.cell_cap);
  for (const key of input.only ?? []) args.push("--only", key);
  if (input.only_file) args.push("--only-file", input.only_file);
  if (input.limit !== undefined) args.push("--limit", String(input.limit));
  if (input.sample !== undefined) args.push("--sample", String(input.sample));
  if (input.fraction !== undefined) args.push("--fraction", String(input.fraction));
  if (input.seed !== undefined) args.push("--seed", String(input.seed));
  if (input.turn_timeout !== undefined) args.push("--turn-timeout", String(input.turn_timeout));
  if (input.task_timeout !== undefined) args.push("--task-timeout", String(input.task_timeout));
  if (input.skip_inflight !== undefined) args.push("--skip-inflight", String(input.skip_inflight));
  pushSkills(args, input.skill, input.no_skills, input.skills_mode);
  for (const extra of input.driver_arg ?? []) args.push("--driver-arg", extra);
  appendLocalModel(args, input);
  return args;
}

/** Returns `timeout_seconds`, or the default of 4 hours (14400 seconds). */
export function runnerTimeoutSeconds(input: RunnerInput): number {
  return input.timeout_seconds ?? 4 * 60 * 60;
}

/** Builds `score <cell_dir>` with `--workers`, `--batch`, `--select-only`, `--redo` and `--json` when set. */
export function scoreArgv(input: ScoreInput): string[] {
  const args = ["score", input.cell_dir];
  if (input.workers !== undefined) args.push("--workers", String(input.workers));
  if (input.batch !== undefined) args.push("--batch", String(input.batch));
  if (input.select_only) args.push("--select-only");
  if (input.redo) args.push("--redo");
  if (input.json) args.push("--json");
  return args;
}

/** Returns `timeout_seconds`, or the default of 2 hours (7200 seconds). */
export function scoreTimeoutSeconds(input: ScoreInput): number {
  return input.timeout_seconds ?? 2 * 60 * 60;
}

/** Builds `grade <bench> <task_key> <deliverables_dir>`, and `--json` when `json` is true. */
export function gradeArgv(input: GradeInput): string[] {
  const args = ["grade", input.bench, input.task_key, input.deliverables_dir];
  if (input.json) args.push("--json");
  return args;
}

/** Returns `timeout_seconds`, or the default of 30 minutes (1800 seconds). */
export function gradeTimeoutSeconds(input: GradeInput): number {
  return input.timeout_seconds ?? 30 * 60;
}

/** Builds `materialize <bench>` with `--pool`, one `--only` flag per task key, and `--limit` when set. */
export function materializeArgv(input: MaterializeInput): string[] {
  const args = ["materialize", input.bench];
  if (input.pool) args.push("--pool", input.pool);
  for (const key of input.only ?? []) args.push("--only", key);
  if (input.limit !== undefined) args.push("--limit", String(input.limit));
  return args;
}

/** Returns `timeout_seconds`, or the default of 1 hour (3600 seconds). */
export function materializeTimeoutSeconds(input: MaterializeInput): number {
  return input.timeout_seconds ?? 60 * 60;
}

/** Builds `env-derive` with `--jobs` when set, and one `--only` flag followed by every base image name. */
export function envDeriveArgv(input: EnvDeriveInput): string[] {
  const args = ["env-derive"];
  if (input.jobs !== undefined) args.push("--jobs", String(input.jobs));
  if (input.only && input.only.length > 0) args.push("--only", ...input.only);
  return args;
}

/** Returns `timeout_seconds`, or the default of 1 hour (3600 seconds). */
export function envDeriveTimeoutSeconds(input: EnvDeriveInput): number {
  return input.timeout_seconds ?? 60 * 60;
}

/** Command names from `veriharness --help`, which prints the usage block to stderr. */
export function parseHelpCommands(usage: string): string[] {
  const names: string[] = [];
  for (const line of usage.split("\n")) {
    const match = /^ {2}([a-z0-9-]+) {2,}/.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}
