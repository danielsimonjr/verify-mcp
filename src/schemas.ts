import * as z from "zod";

export const BENCHES = ["apex", "wsb", "wb", "sb2", "jb"] as const;
/** Lane names in the pinned runner's config.LANES. tests/schemas.test.ts keeps both lists equal to the pin. */
export const LANES = ["flash", "opus"] as const;

// One path segment. The runner joins run_name and `${bench}_${pool}` under VERIHARNESS_RUNS and
// deletes an existing task workspace there, so a separator or a leading dot (which covers "." and
// "..") would reach outside the runs directory.
const SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]*";
const SEGMENT_HELP = "letters, digits, dot, underscore and hyphen, not starting with a dot";
const CELL = new RegExp(`^(?:${BENCHES.join("|")}):${SEGMENT}$`);
// The scheduler compares in-flight counts against these caps. A cap that is 0 or not a number
// never compares true, so the cell's tasks never start and the runner waits forever.
const CAP = `(?:${[...BENCHES, "default"].join("|")})=[1-9][0-9]*`;
const CELL_CAP = new RegExp(`^${CAP}(?:,${CAP})*$`);

const timeoutSeconds = z
  .number()
  .positive()
  .optional()
  .describe("Wall-clock timeout for this call, in seconds. Overrides the tool default.");

export const localModelShape = {
  provider: z
    .string()
    .min(1)
    .optional()
    .describe("Model provider. Local servers: ollama, or llamacpp (aliases llama.cpp and llama-cpp)."),
  model: z.string().min(1).optional().describe("Model name. Required by verify for ollama and llamacpp."),
  base_url: z
    .string()
    .min(1)
    .optional()
    .describe("Local server URL. Ollama defaults to http://127.0.0.1:11434, llama.cpp to http://127.0.0.1:8080."),
  context_size: z.number().int().positive().optional().describe("Context length passed as --context-size."),
  temperature: z.number().optional().describe("Sampling temperature passed as --temperature."),
  max_tokens: z.number().int().positive().optional().describe("Max tokens passed as --max-tokens."),
  top_p: z.number().optional().describe("Top-p passed as --top-p."),
  request_timeout: z
    .number()
    .positive()
    .optional()
    .describe("Per-request timeout in seconds, passed as --request-timeout. Verify's own default is 180."),
};

export const statusInput = z.object({ timeout_seconds: timeoutSeconds }).strict();
/** Arguments of the verify_status tool, as `statusInput` parses them. */
export type StatusInput = z.infer<typeof statusInput>;

export const modelCheckInput = z
  .object({
    provider: z
      .string()
      .min(1)
      .describe("Local provider: ollama, or llamacpp (aliases llama.cpp and llama-cpp)."),
    model: z.string().min(1).describe("Model name to probe."),
    base_url: localModelShape.base_url,
    context_size: localModelShape.context_size,
    temperature: localModelShape.temperature,
    max_tokens: localModelShape.max_tokens,
    top_p: localModelShape.top_p,
    request_timeout: localModelShape.request_timeout,
    timeout_seconds: timeoutSeconds,
  })
  .strict();
/** Arguments of the verify_model_check tool, as `modelCheckInput` parses them. */
export type ModelCheckInput = z.infer<typeof modelCheckInput>;

export const driverInput = z
  .object({
    task_dir: z.string().min(1).describe("Task workspace. Must contain a rollouts/ directory."),
    contract: z.enum(["artifact", "pick-only"]).optional().describe("Driver contract. Omit to keep verify's default (artifact)."),
    thinking: z.string().min(1).optional().describe("Thinking level passed as --thinking."),
    skill: z.array(z.string().min(1)).optional().describe("Skill names. Each becomes a --skill flag."),
    no_skills: z.boolean().optional().describe("Pass --no-skills when true."),
    skills_mode: z.enum(["mounted", "auto"]).optional().describe("Omit to keep verify's default (mounted)."),
    env: z
      .enum(["jail", "none", "native", "native-full"])
      .optional()
      .describe("Execution environment. Omit to keep verify's default (jail)."),
    turn_timeout: z.number().positive().optional().describe("Seconds, passed as --turn-timeout. Verify's default is 1800."),
    nudge_timeout: z.number().positive().optional().describe("Seconds, passed as --nudge-timeout. Verify's default is 600."),
    task_timeout: z.number().positive().optional().describe("Seconds, passed as --task-timeout. Verify's default is 3600."),
    timeout_seconds: timeoutSeconds,
    ...localModelShape,
  })
  .strict();
/** Arguments of the verify_driver tool, as `driverInput` parses them. */
export type DriverInput = z.infer<typeof driverInput>;

export const runnerInput = z
  .object({
    cells: z
      .array(z.string().regex(CELL, `cell must be bench:pool, bench one of ${BENCHES.join(", ")}, pool ${SEGMENT_HELP}`))
      .min(1)
      .describe("Cells to run. Each entry is bench:pool, for example wb:flash."),
    run_name: z
      .string()
      .regex(new RegExp(`^${SEGMENT}$`), `run_name must be one path segment: ${SEGMENT_HELP}`)
      .describe("Run directory name under VERIHARNESS_RUNS. One path segment."),
    contract: z.enum(["artifact", "pick-only"]).optional(),
    lane: z.enum(LANES).optional().describe("Verifier lane. Required when a pool is not itself a lane name."),
    max_flash: z.number().int().positive().optional().describe("In-flight cap for the flash lane. Verify's default is 25."),
    max_opus: z.number().int().positive().optional().describe("In-flight cap for the opus lane. Verify's default is 45."),
    cell_cap: z
      .string()
      .regex(CELL_CAP, "cell_cap must be key=N[,key=N] with N a positive integer and key a bench name or default")
      .optional()
      .describe("In-flight cap per bench, passed as --cell-cap: key=N[,key=N], key a bench name or default."),
    only: z.array(z.string().min(1)).optional().describe("Task keys. Each becomes --only."),
    only_file: z.string().min(1).optional().describe("File of task keys, passed as --only-file."),
    limit: z.number().int().nonnegative().optional(),
    sample: z.number().int().nonnegative().optional(),
    fraction: z.number().nonnegative().optional(),
    seed: z.number().int().nonnegative().optional(),
    turn_timeout: z.number().positive().optional(),
    task_timeout: z.number().positive().optional(),
    skip_inflight: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        "Minutes, passed as --skip-inflight: a task workspace with activity in the last N minutes is skipped as in flight. Verify's default is 45.",
      ),
    skill: z.array(z.string().min(1)).optional(),
    no_skills: z.boolean().optional(),
    skills_mode: z.enum(["mounted", "auto"]).optional(),
    driver_arg: z.array(z.string()).optional().describe("Extra driver arguments. Each becomes --driver-arg."),
    timeout_seconds: timeoutSeconds,
    ...localModelShape,
  })
  .strict();
/** Arguments of the verify_runner tool, as `runnerInput` parses them. */
export type RunnerInput = z.infer<typeof runnerInput>;

export const scoreInput = z
  .object({
    cell_dir: z.string().min(1).describe("Cell directory to score (the bench_pool directory)."),
    workers: z.number().int().positive().optional().describe("Passed as --workers. Verify's default is 6."),
    batch: z.number().int().positive().optional().describe("Passed as --batch. Verify's default is 1."),
    select_only: z.boolean().optional().describe("Pass --select-only when true."),
    redo: z.boolean().optional().describe("Pass --redo when true."),
    json: z.boolean().default(true).describe("Pass --json so the summary can be returned as structured content."),
    timeout_seconds: timeoutSeconds,
  })
  .strict();
/** Arguments of the verify_score tool, as `scoreInput` parses them. `json` defaults to true. */
export type ScoreInput = z.infer<typeof scoreInput>;

export const gradeInput = z
  .object({
    bench: z.enum(BENCHES),
    task_key: z.string().min(1),
    deliverables_dir: z.string().min(1),
    json: z.boolean().default(true).describe("Pass --json and parse the grade result."),
    timeout_seconds: timeoutSeconds,
  })
  .strict();
/** Arguments of the verify_grade tool, as `gradeInput` parses them. `json` defaults to true. */
export type GradeInput = z.infer<typeof gradeInput>;

export const materializeInput = z
  .object({
    bench: z.enum(BENCHES),
    pool: z.string().min(1).optional().describe("Pool name, or omit for verify's default of all pools."),
    only: z.array(z.string().min(1)).optional().describe("Task keys. Each becomes --only."),
    limit: z.number().int().nonnegative().optional(),
    timeout_seconds: timeoutSeconds,
  })
  .strict();
/** Arguments of the verify_materialize tool, as `materializeInput` parses them. */
export type MaterializeInput = z.infer<typeof materializeInput>;

export const envDeriveInput = z
  .object({
    jobs: z.number().int().positive().optional().describe("Parallel docker builds. Verify's default is 8."),
    only: z.array(z.string().min(1)).optional().describe("Base image names passed after --only."),
    timeout_seconds: timeoutSeconds,
  })
  .strict();
/** Arguments of the verify_env_derive tool, as `envDeriveInput` parses them. */
export type EnvDeriveInput = z.infer<typeof envDeriveInput>;

export const listRunsInput = z
  .object({
    run: z.string().min(1).optional().describe("If set, return only this run directory name."),
  })
  .strict();
/** Arguments of the verify_list_runs tool, as `listRunsInput` parses them. */
export type ListRunsInput = z.infer<typeof listRunsInput>;

export const ARTIFACTS = [
  "ledger_elim",
  "ledger_fals",
  "finish",
  "repair",
  "driver_log",
  "run",
  "scores",
  "scores_partial",
  "deliverables",
] as const;
/** An artifact name from ARTIFACTS. results.ts maps each name to one fixed file or folder. */
export type ArtifactName = (typeof ARTIFACTS)[number];

export const readResultInput = z
  .object({
    run: z.string().min(1).optional().describe("Run name under VERIHARNESS_RUNS. Required unless task_dir is set."),
    cell: z
      .string()
      .min(1)
      .optional()
      .describe("Cell directory name under the run, usually bench_pool. Required unless task_dir is set."),
    task_dir: z
      .string()
      .min(1)
      .optional()
      .describe("Driver task workspace. Use this to read ledgers written into the task, instead of run and cell."),
    artifact: z.enum(ARTIFACTS).describe(
      "Fixed artifact name. deliverables lists file names and sizes under out/deliverables and does not return file bytes.",
    ),
    max_bytes: z
      .number()
      .int()
      .positive()
      .max(2_000_000)
      .optional()
      .describe("Maximum bytes of a text artifact. Default 262144, hard cap 2000000."),
  })
  .strict();
/** Arguments of the verify_read_result tool, as `readResultInput` parses them. */
export type ReadResultInput = z.infer<typeof readResultInput>;
