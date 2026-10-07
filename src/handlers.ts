import type { ServerContext } from "@modelcontextprotocol/server";

import {
  driverArgv,
  driverTimeoutSeconds,
  envDeriveArgv,
  envDeriveTimeoutSeconds,
  gradeArgv,
  gradeTimeoutSeconds,
  materializeArgv,
  materializeTimeoutSeconds,
  modelCheckArgv,
  modelCheckTimeoutSeconds,
  parseHelpCommands,
  runnerArgv,
  runnerTimeoutSeconds,
  scoreArgv,
  scoreTimeoutSeconds,
  statusArgv,
  statusTimeoutSeconds,
  timeoutMs,
} from "./argv.ts";
import { applyDefaultProfile } from "./defaults.ts";
import { VERIFY_SPEC, VERIFY_VERSION } from "./pin.ts";
import { VerifyNotInstalledError, resolveVerifyLaunch, type VerifyLaunch } from "./resolve.ts";
import { ResultPathError, DEFAULT_MAX_BYTES, listRuns, readArtifact, resultBase } from "./results.ts";
import { extractJson, runProcess, type RunRequest, type RunResult } from "./run.ts";
import type {
  DriverInput,
  EnvDeriveInput,
  GradeInput,
  ListRunsInput,
  MaterializeInput,
  ModelCheckInput,
  ReadResultInput,
  RunnerInput,
  ScoreInput,
  StatusInput,
} from "./schemas.ts";

/** Spawns one process and returns its result. `defaultDeps` uses `runProcess`. */
export interface CommandRunner {
  run(req: RunRequest): Promise<RunResult>;
}

/** The process runner and the launch resolver that the handlers use. */
export interface Deps {
  runner: CommandRunner;
  resolveLaunch: () => VerifyLaunch;
  /** The environment that holds the default model profile. Absent means no profile. */
  env?: NodeJS.ProcessEnv;
}

/** Returns deps that spawn with `runProcess` and resolve each launch with `resolveVerifyLaunch`. */
export function defaultDeps(): Deps {
  return {
    runner: { run: runProcess },
    resolveLaunch: () => resolveVerifyLaunch(),
    env: process.env,
  };
}

/** The text, error flag and structured content that a handler returns for one tool call. */
export interface ToolOutcome {
  text: string;
  isError?: boolean;
  structured?: Record<string, unknown>;
}

/** The abort signal of one tool call and a function that sends progress notifications. */
export interface ProgressCtx {
  signal?: AbortSignal;
  notify: (message: string, force?: boolean) => Promise<void>;
}

/**
 * Builds a ProgressCtx from the request context.
 *
 * `notify` sends nothing when the request has no progress token. `notify` drops a message within
 * 400 ms of the last one, unless `force` is true or nothing went out yet. `notify` cuts each
 * message to 240 characters and ignores a send failure.
 */
export function progressFrom(ctx: ServerContext): ProgressCtx {
  const token = ctx.mcpReq._meta?.progressToken;
  let progress = 0;
  let last = 0;
  return {
    signal: ctx.mcpReq.signal,
    notify: async (message, force = false) => {
      if (token === undefined) return;
      const now = Date.now();
      if (!force && progress > 0 && now - last < 400) return;
      last = now;
      progress += 1;
      try {
        await ctx.mcpReq.notify({
          method: "notifications/progress",
          params: {
            progressToken: token,
            progress,
            message: message.slice(0, 240),
          },
        });
      } catch {
        /* a client that did not request progress can ignore this */
      }
    },
  };
}

const MODEL_CHECK_MISSING =
  `This verify build does not include model-check. It was added with the Ollama and llama.cpp ` +
  `backends (verify PR #2, commit 756bc2b). The pinned version ${VERIFY_VERSION} includes it; ` +
  `this VERIHARNESS_BIN is older.`;

const CLAUDE_CODE_MISSING =
  `This verify build does not include the Claude Code provider. It was added with the Haiku and Sonnet ` +
  `lanes (verify PR #11, commit 102894a). The pinned version ${VERIFY_VERSION} includes it; ` +
  `this VERIHARNESS_BIN is older.`;

function explain(command: string, result: RunResult): string {
  const combined = `${result.stderr}\n${result.stdout}`;
  if (command === "model-check" && /unknown command:\s*model-check/.test(combined)) {
    return `${MODEL_CHECK_MISSING}\n\n${result.stderr.trim()}`;
  }
  // Verify before PR #11 rejects every provider but the two local ones with this message.
  if (/provider 'claude-code' is not a local backend/.test(combined)) {
    return `${CLAUDE_CODE_MISSING}\n\n${result.stderr.trim()}`;
  }
  if (/Ollama is not reachable|llama-server is not reachable/.test(combined)) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return `The local model server is down.\n${detail}`;
  }
  if (result.aborted) return `veriharness ${command} was cancelled.\n${result.stderr.trim()}`;
  if (result.timedOut) {
    return `veriharness ${command} timed out after ${result.durationMs}ms.\n${result.stderr.trim()}\n${result.stdout.trim()}`.trim();
  }
  const detail = result.stderr.trim() || result.stdout.trim();
  return `veriharness ${command} failed with exit ${result.code ?? "null"}.\n${detail}`.trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function finish(command: string, result: RunResult, parse: boolean): ToolOutcome {
  if (result.timedOut || result.aborted || result.code !== 0) {
    return {
      text: explain(command, result),
      isError: true,
      structured: {
        command,
        exitCode: result.code,
        timedOut: result.timedOut,
        aborted: result.aborted,
      },
    };
  }
  const parsed = parse ? extractJson(result.stdout) : undefined;
  const record = asRecord(parsed);
  const text = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n") || `veriharness ${command} exited 0`;
  return {
    text,
    structured: {
      command,
      exitCode: result.code,
      durationMs: result.durationMs,
      ...(record ?? (parsed === undefined ? {} : { result: parsed })),
    },
  };
}

async function invoke(
  deps: Deps,
  launch: VerifyLaunch,
  command: string,
  args: string[],
  seconds: number,
  progress: ProgressCtx | undefined,
): Promise<RunResult> {
  const heartbeat = progress
    ? setInterval(() => {
        void progress.notify(`veriharness ${command} still running`);
      }, 15_000)
    : undefined;
  try {
    await progress?.notify(`veriharness ${command} started`, true);
    const result = await deps.runner.run({
      command: launch.command,
      args: [...launch.args, ...args],
      cwd: launch.cwd,
      env: launch.env,
      timeoutMs: timeoutMs(seconds),
      signal: progress?.signal,
      onLine: (line) => {
        void progress?.notify(line);
      },
    });
    await progress?.notify(`veriharness ${command} finished`, true);
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

async function withLaunch(deps: Deps, fn: (launch: VerifyLaunch) => Promise<ToolOutcome>): Promise<ToolOutcome> {
  try {
    return await fn(deps.resolveLaunch());
  } catch (err) {
    if (err instanceof VerifyNotInstalledError) {
      return { text: err.message, isError: true, structured: { error: "verify_not_installed" } };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { text: message, isError: true };
  }
}

/**
 * Runs `veriharness --help` and reports the launch and the command list.
 *
 * The report holds the pin, the launch command, and the data and runs folders. `modelCheck` is
 * true when the list holds `model-check`. A failed run returns an error outcome.
 */
export function handleStatus(input: StatusInput, deps: Deps, progress?: ProgressCtx): Promise<ToolOutcome> {
  return withLaunch(deps, async (launch) => {
    const result = await invoke(deps, launch, "status", statusArgv(), statusTimeoutSeconds(input), progress);
    if (result.code !== 0 || result.timedOut || result.aborted) return finish("status", result, false);
    const usage = `${result.stderr}\n${result.stdout}`;
    const commands = parseHelpCommands(usage);
    const structured = {
      pin: VERIFY_SPEC,
      source: launch.source,
      command: launch.command,
      args: launch.args,
      binPath: launch.binPath,
      dataDir: launch.dataDir,
      runsDir: launch.runsDir,
      commands,
      modelCheck: commands.includes("model-check"),
    };
    return {
      text: [
        `pin ${VERIFY_SPEC}`,
        `command ${launch.command} ${launch.args.join(" ")}`.trim(),
        `data ${launch.dataDir}`,
        `runs ${launch.runsDir}`,
        `model-check ${structured.modelCheck ? "present" : "absent"}`,
        `commands ${commands.join(", ")}`,
      ].join("\n"),
      structured,
    };
  });
}

/**
 * Runs `veriharness model-check`. JSON in stdout goes into the structured content.
 *
 * A failed run returns an error outcome. The error text explains a verify build that lacks
 * model-check.
 */
export function handleModelCheck(raw: ModelCheckInput, deps: Deps, progress?: ProgressCtx): Promise<ToolOutcome> {
  const input = applyDefaultProfile(raw, deps.env, false);
  if (!input.provider || !input.model) {
    return Promise.resolve({
      text:
        "Name a provider and a model, or set VERIFY_MCP_PROVIDER and VERIFY_MCP_MODEL in the server environment " +
        "to give verify_model_check a default.",
      isError: true,
      structured: { error: "no_model" },
    });
  }
  return withLaunch(deps, async (launch) => {
    const result = await invoke(
      deps,
      launch,
      "model-check",
      modelCheckArgv(input),
      modelCheckTimeoutSeconds(input),
      progress,
    );
    return finish("model-check", result, true);
  });
}

/** Runs `veriharness driver`. A non-zero exit, a timeout or a cancel returns an error outcome. */
export function handleDriver(raw: DriverInput, deps: Deps, progress?: ProgressCtx): Promise<ToolOutcome> {
  const input = applyDefaultProfile(raw, deps.env, true);
  return withLaunch(deps, async (launch) => {
    const result = await invoke(deps, launch, "driver", driverArgv(input), driverTimeoutSeconds(input), progress);
    return finish("driver", result, false);
  });
}

/** Runs `veriharness runner`. A non-zero exit, a timeout or a cancel returns an error outcome. */
export function handleRunner(input: RunnerInput, deps: Deps, progress?: ProgressCtx): Promise<ToolOutcome> {
  return withLaunch(deps, async (launch) => {
    const result = await invoke(deps, launch, "runner", runnerArgv(input), runnerTimeoutSeconds(input), progress);
    return finish("runner", result, false);
  });
}

/** Runs `veriharness score`. When `json` is true, JSON in stdout goes into the structured content. */
export function handleScore(input: ScoreInput, deps: Deps, progress?: ProgressCtx): Promise<ToolOutcome> {
  return withLaunch(deps, async (launch) => {
    const result = await invoke(deps, launch, "score", scoreArgv(input), scoreTimeoutSeconds(input), progress);
    return finish("score", result, input.json);
  });
}

/** Runs `veriharness grade`. When `json` is true, JSON in stdout goes into the structured content. */
export function handleGrade(input: GradeInput, deps: Deps, progress?: ProgressCtx): Promise<ToolOutcome> {
  return withLaunch(deps, async (launch) => {
    const result = await invoke(deps, launch, "grade", gradeArgv(input), gradeTimeoutSeconds(input), progress);
    return finish("grade", result, input.json);
  });
}

/** Runs `veriharness materialize`. A non-zero exit, a timeout or a cancel returns an error outcome. */
export function handleMaterialize(input: MaterializeInput, deps: Deps, progress?: ProgressCtx): Promise<ToolOutcome> {
  return withLaunch(deps, async (launch) => {
    const result = await invoke(
      deps,
      launch,
      "materialize",
      materializeArgv(input),
      materializeTimeoutSeconds(input),
      progress,
    );
    return finish("materialize", result, false);
  });
}

/** Runs `veriharness env-derive`. A non-zero exit, a timeout or a cancel returns an error outcome. */
export function handleEnvDerive(input: EnvDeriveInput, deps: Deps, progress?: ProgressCtx): Promise<ToolOutcome> {
  return withLaunch(deps, async (launch) => {
    const result = await invoke(
      deps,
      launch,
      "env-derive",
      envDeriveArgv(input),
      envDeriveTimeoutSeconds(input),
      progress,
    );
    return finish("env-derive", result, false);
  });
}

/**
 * Lists each run folder under the runs directory with its cell folders.
 *
 * `run` keeps only that run. A missing runs directory returns an empty list, not an error. A `run`
 * that is not one path segment returns an error outcome.
 */
export function handleListRuns(input: ListRunsInput, deps: Deps): Promise<ToolOutcome> {
  return withLaunch(deps, async (launch) => {
    try {
      const listing = listRuns(launch.runsDir, input.run);
      const lines = listing.missing
        ? [`runs directory does not exist yet: ${listing.runsDir}`, "runs 0"]
        : listing.runs.map((run) => `${run.name}: ${run.cells.join(", ") || "(no cells)"}`);
      return {
        text: lines.join("\n") || "runs 0",
        structured: {
          runsDir: listing.runsDir,
          missing: listing.missing,
          runs: listing.runs,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { text: message, isError: true };
    }
  });
}

/**
 * Reads one named artifact from `run`/`cell` under the runs directory, or from `task_dir`.
 *
 * A text artifact stops at `max_bytes`, default 262144. A bad or escaping path returns an error
 * outcome.
 */
export function handleReadResult(input: ReadResultInput, deps: Deps): Promise<ToolOutcome> {
  return withLaunch(deps, async (launch) => {
    try {
      const located = resultBase({
        runsDir: launch.runsDir,
        run: input.run,
        cell: input.cell,
        taskDir: input.task_dir,
      });
      const read = readArtifact(located.baseDir, located.jailRoot, input.artifact, input.max_bytes ?? DEFAULT_MAX_BYTES);
      const structured: Record<string, unknown> = {
        path: read.path,
        artifact: read.artifact,
        truncated: read.truncated,
      };
      if (read.json !== undefined) structured.json = read.json;
      if (read.deliverables) structured.deliverables = read.deliverables;
      const note = read.truncated ? "\n[truncated]" : "";
      return { text: `${read.path}\n${read.text}${note}`, structured };
    } catch (err) {
      const message = err instanceof ResultPathError || err instanceof Error ? err.message : String(err);
      return { text: message, isError: true };
    }
  });
}
