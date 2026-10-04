import type {
  DriverInput,
  EnvDeriveInput,
  GradeInput,
  MaterializeInput,
  ModelCheckInput,
  RunnerInput,
  ScoreInput,
} from "./schemas.ts";

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

export function timeoutMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

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

export function statusArgv(): string[] {
  return ["--help"];
}

export function statusTimeoutSeconds(input: { timeout_seconds?: number }): number {
  return input.timeout_seconds ?? 30;
}

export function modelCheckArgv(input: ModelCheckInput): string[] {
  const args = ["model-check"];
  appendLocalModel(args, input);
  return args;
}

export function modelCheckTimeoutSeconds(input: ModelCheckInput): number {
  if (input.timeout_seconds !== undefined) return input.timeout_seconds;
  return (input.request_timeout ?? 180) + 30;
}

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

export function driverTimeoutSeconds(input: DriverInput): number {
  if (input.timeout_seconds !== undefined) return input.timeout_seconds;
  return (input.task_timeout ?? 3600) + 120;
}

export function runnerArgv(input: RunnerInput): string[] {
  const args = ["runner", "--run-name", input.run_name];
  for (const cell of input.cells) args.push("--cells", cell);
  if (input.contract) args.push("--contract", input.contract);
  if (input.lane) args.push("--lane", input.lane);
  if (input.max_flash !== undefined) args.push("--max-flash", String(input.max_flash));
  if (input.max_opus !== undefined) args.push("--max-opus", String(input.max_opus));
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

export function runnerTimeoutSeconds(input: RunnerInput): number {
  return input.timeout_seconds ?? 4 * 60 * 60;
}

export function scoreArgv(input: ScoreInput): string[] {
  const args = ["score", input.cell_dir];
  if (input.workers !== undefined) args.push("--workers", String(input.workers));
  if (input.batch !== undefined) args.push("--batch", String(input.batch));
  if (input.select_only) args.push("--select-only");
  if (input.redo) args.push("--redo");
  if (input.json) args.push("--json");
  return args;
}

export function scoreTimeoutSeconds(input: ScoreInput): number {
  return input.timeout_seconds ?? 2 * 60 * 60;
}

export function gradeArgv(input: GradeInput): string[] {
  const args = ["grade", input.bench, input.task_key, input.deliverables_dir];
  if (input.json) args.push("--json");
  return args;
}

export function gradeTimeoutSeconds(input: GradeInput): number {
  return input.timeout_seconds ?? 30 * 60;
}

export function materializeArgv(input: MaterializeInput): string[] {
  const args = ["materialize", input.bench];
  if (input.pool) args.push("--pool", input.pool);
  for (const key of input.only ?? []) args.push("--only", key);
  if (input.limit !== undefined) args.push("--limit", String(input.limit));
  return args;
}

export function materializeTimeoutSeconds(input: MaterializeInput): number {
  return input.timeout_seconds ?? 60 * 60;
}

export function envDeriveArgv(input: EnvDeriveInput): string[] {
  const args = ["env-derive"];
  if (input.jobs !== undefined) args.push("--jobs", String(input.jobs));
  if (input.only && input.only.length > 0) args.push("--only", ...input.only);
  return args;
}

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
