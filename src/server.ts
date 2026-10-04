import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";

import {
  defaultDeps,
  handleDriver,
  handleEnvDerive,
  handleGrade,
  handleListRuns,
  handleMaterialize,
  handleModelCheck,
  handleReadResult,
  handleRunner,
  handleScore,
  handleStatus,
  progressFrom,
  type Deps,
  type ToolOutcome,
} from "./handlers.ts";
import { PROTOCOL_VERSION, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "./protocol.ts";
import {
  driverInput,
  envDeriveInput,
  gradeInput,
  listRunsInput,
  materializeInput,
  modelCheckInput,
  readResultInput,
  runnerInput,
  scoreInput,
  statusInput,
} from "./schemas.ts";

export const TOOL_NAMES = [
  "verify_status",
  "verify_model_check",
  "verify_driver",
  "verify_runner",
  "verify_score",
  "verify_grade",
  "verify_materialize",
  "verify_env_derive",
  "verify_list_runs",
  "verify_read_result",
] as const;

function toCall(outcome: ToolOutcome): CallToolResult {
  const result: CallToolResult = { content: [{ type: "text", text: outcome.text }] };
  if (outcome.isError) result.isError = true;
  if (outcome.structured) result.structuredContent = outcome.structured;
  return result;
}

function call(outcome: Promise<ToolOutcome>): Promise<CallToolResult> {
  return outcome.then(toCall);
}

/**
 * Capabilities are tools only. Logging, roots, and sampling are omitted:
 * the 2026-07-28 revision deprecates server logging and replaces the
 * server-to-client roots/sampling requests with input_required, which this
 * server does not need. HTTP+SSE is not served.
 */
export function createVerifyServer(deps: Deps = defaultDeps()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.registerTool(
    "verify_status",
    {
      title: "Verify status",
      description:
        "Show the pinned verify revision, the resolved veriharness command, data and runs directories, " +
        "and whether this binary includes model-check. Runs `veriharness --help`.",
      inputSchema: statusInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args, ctx) => call(handleStatus(args, deps, progressFrom(ctx))),
  );

  server.registerTool(
    "verify_model_check",
    {
      title: "Check a local model server",
      description:
        "Probe an Ollama or llama.cpp server with `veriharness model-check`. " +
        "If this binary predates verify PR #2, the error says model-check is absent. " +
        "If the server is down, the error says the local model server is down.",
      inputSchema: modelCheckInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args, ctx) => call(handleModelCheck(args, deps, progressFrom(ctx))),
  );

  server.registerTool(
    "verify_driver",
    {
      title: "Run one task",
      description:
        "Run `veriharness driver` on one task workspace. The directory must contain rollouts/. " +
        "Flags are forwarded only when you set them, so verify keeps its own defaults. " +
        `Negotiated MCP revision when the client asks for it: ${PROTOCOL_VERSION}.`,
      inputSchema: driverInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args, ctx: ServerContext) => call(handleDriver(args, deps, progressFrom(ctx))),
  );

  server.registerTool(
    "verify_runner",
    {
      title: "Batch-run cells",
      description:
        "Run `veriharness runner` for one or more bench:pool cells under a run name. " +
        "Requires cells and run_name. Default wall clock is 4 hours.",
      inputSchema: runnerInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args, ctx) => call(handleRunner(args, deps, progressFrom(ctx))),
  );

  server.registerTool(
    "verify_score",
    {
      title: "Score a cell",
      description:
        "Run `veriharness score` on a cell directory. Passes --json unless json is false, " +
        "and returns the trailing JSON summary as structured content.",
      inputSchema: scoreInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args, ctx) => call(handleScore(args, deps, progressFrom(ctx))),
  );

  server.registerTool(
    "verify_grade",
    {
      title: "Grade deliverables",
      description: "Run `veriharness grade <bench> <task_key> <deliverables_dir>`. Benches: apex, wsb, wb, sb2, jb.",
      inputSchema: gradeInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args, ctx) => call(handleGrade(args, deps, progressFrom(ctx))),
  );

  server.registerTool(
    "verify_materialize",
    {
      title: "Materialize task workspaces",
      description:
        "Run `veriharness materialize <bench>`. Builds task workspaces from the benchmark archive " +
        "into VERIHARNESS_DATA. Needs VERIHARNESS_BENCH_ROOT when the archive is not already local.",
      inputSchema: materializeInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args, ctx) => call(handleMaterialize(args, deps, progressFrom(ctx))),
  );

  server.registerTool(
    "verify_env_derive",
    {
      title: "Derive task images",
      description:
        "Run `veriharness env-derive`. Builds Docker images that add the harness tool stack onto WorkBuddy task images.",
      inputSchema: envDeriveInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args, ctx) => call(handleEnvDerive(args, deps, progressFrom(ctx))),
  );

  server.registerTool(
    "verify_list_runs",
    {
      title: "List runs",
      description:
        "List run directories under VERIHARNESS_RUNS and the cell directories inside each. " +
        "A missing runs directory returns an empty list.",
      inputSchema: listRunsInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => call(handleListRuns(args, deps)),
  );

  server.registerTool(
    "verify_read_result",
    {
      title: "Read a run artifact",
      description:
        "Read one fixed artifact from a run cell or a driver task directory: " +
        "ledger_elim, ledger_fals, finish, repair, driver_log, run, scores, scores_partial, or deliverables. " +
        "deliverables returns names and sizes only. Arbitrary paths are rejected.",
      inputSchema: readResultInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => call(handleReadResult(args, deps)),
  );

  return server;
}
