# verify-mcp

An MCP server for [verify](https://github.com/danielsimonjr/verify), the VeriHarness verification
harness. It lets an agent in Claude Code, Codex or Cursor verify a task, run a benchmark, and read
the results through ten tools.

verify-mcp is version 0.5.0. It is not published to npm or to a public plugin marketplace. Install it
from this repository.

## Contents

- [What verify does](#what-verify-does)
- [Requirements](#requirements)
- [Quick start in Claude Code](#quick-start-in-claude-code)
- [Task workspace](#task-workspace)
- [Workflows](#workflows)
- [Tools](#tools)
- [Configuration](#configuration)
- [Other hosts](#other-hosts)
- [Windows](#windows)
- [Security](#security)
- [Protocol](#protocol)
- [Development](#development)
- [License](#license)

## What verify does

verify takes one task and the results of *N* independent attempts at it (the *rollouts*). A
verifier model then checks the rollouts against the task's own files, in four phases:

1. **Resolve disagreements.** One session finds the claims on which the rollouts differ, runs the
   check that separates them, and records who was right (`ledger_elim.json`).
2. **Challenge the consensus.** A second, isolated session finds the claims that all rollouts share
   and tries to break each one against the inputs (`ledger_fals.json`).
3. **Adjudicate.** A fresh session reads only the two records. It selects the best rollout as the
   base, lists the changes the evidence supports, and lists the questions it cannot settle
   (`finish.json`).
4. **Repair.** The adjudication session applies those changes and delivers the result to
   `out/deliverables/`, with a record of what it changed (`repair.json`).

The verifier is not a stronger judge. Its advantage comes from the structure of the rollout pool
and from evidence that it collects from the task's files. The method, the benchmarks and the
results are described in the [verify README](https://github.com/danielsimonjr/verify#readme) and in
the [paper](https://arxiv.org/abs/2610.00972).

verify-mcp does not change the method. It starts the verify command-line tool (`veriharness`),
reports progress while it runs, and returns its output.

## Requirements

- [Bun](https://bun.sh) 1.1 or later on `PATH`. CI uses Bun 1.4.2.
- A checkout of [danielsimonjr/verify](https://github.com/danielsimonjr/verify) at version 0.1.0
  (`@danielsimonjr/verify`, the pinned version) or later, with its dependencies installed (`bun install`). The Claude Code
  plugin expects it at `~/Github/verify`. The Claude Code provider needs `102894a` or later; a
  checkout from `756bc2b` up to that commit runs local models only.
- verify's agent runtime, pi, installed in that checkout: run `harness/scripts/setup_pi.sh` once.
  It installs the pinned pi (`@danielsimonjr/pi`) into `harness/vendor/`. `verify_driver` and `verify_runner` need it for
  every provider except `claude-code`.
- A model for the verifier:
  - Claude Code: the `claude` program, version 2.1 or later, signed in on the host. verify uses
    the login that Claude Code holds (a subscription or `ANTHROPIC_API_KEY`). See
    [Claude Code as the verifier](#claude-code-as-the-verifier); or
  - a local server: Ollama on `http://127.0.0.1:11434`, or llama.cpp's `llama-server` on
    `http://127.0.0.1:8080`; or
  - a hosted provider that pi supports, with its credentials set in the environment. The
    [verify README](https://github.com/danielsimonjr/verify#setup) lists them.
- For benchmark runs only: Docker for the graders, and the benchmark archive
  (`VERIHARNESS_BENCH_ROOT`). See the verify README.

## Quick start in Claude Code

1. Clone verify and install its dependencies and pi runtime:

   ```bash
   git clone https://github.com/danielsimonjr/verify.git ~/Github/verify
   cd ~/Github/verify
   bun install
   harness/scripts/setup_pi.sh
   ```

2. Install the plugin:

   ```bash
   claude plugin marketplace add danielsimonjr/verify-mcp
   claude plugin install verify-mcp@verify-mcp
   ```

   In a session, the same steps are `/plugin marketplace add danielsimonjr/verify-mcp` and
   `/plugin install verify-mcp@verify-mcp`. To load a local checkout instead, start Claude Code with
   `claude --plugin-dir /path/to/verify-mcp/plugin`.

3. In a session, ask Claude to call `verify_status`. The result shows the verify command that the
   server resolved, the data and runs directories, and whether this verify build has
   `model-check`.

4. Check the model before a long run. For a local Ollama model, ask Claude to call
   `verify_model_check` with these arguments:

   ```json
   { "provider": "ollama", "model": "qwen2.5-coder:7b" }
   ```

   For Claude Haiku through Claude Code, use
   `{ "provider": "claude-code", "model": "claude-haiku-4-5-20251001" }`.

5. Verify one task workspace (see [Task workspace](#task-workspace)) with `verify_driver`:

   ```json
   {
     "task_dir": "/path/to/task",
     "provider": "ollama",
     "model": "qwen2.5-coder:7b",
     "env": "none"
   }
   ```

   `env: "none"` runs without verify's jail. Use it on Windows and macOS, where the jail is not
   available, and always with `claude-code`. See [Windows](#windows) and [Security](#security).

6. Read the decision with `verify_read_result`:

   ```json
   { "task_dir": "/path/to/task", "artifact": "finish" }
   ```

   Then read the list of delivered files with `"artifact": "deliverables"`.

The plugin also adds the `verify` skill and the `/verify` command, which tell the agent the order
in which to call the tools.

## Task workspace

The verifier sees one directory. You make it yourself, or `verify_materialize` builds it from a
benchmark archive:

```text
<task>/
  spec/task.md                  the task description
  workspace/                    the task's input files
  rollouts/<name>/deliverables/ what that rollout delivered
  rollouts/<name>/trajectory/   its execution record (optional)
```

`verify_driver` refuses a directory that has no `rollouts/`. Rollout names are directory names,
for example `r01` and `r02`.

The driver writes its output into the same directory:

| File | `verify_read_result` artifact | Contents |
| --- | --- | --- |
| `ledger_elim.json` | `ledger_elim` | The disagreements, the checks run, and who was right |
| `ledger_fals.json` | `ledger_fals` | The shared claims, the attempt to break each one, and whether it held |
| `finish.json` | `finish` | The decision: `base` (a rollout name, or `none`), `work` (the changes to make, with evidence), `open` (unsettled questions, with both readings), `notes` |
| `repair.json` | `repair` | What the repair phase changed |
| `out/deliverables/` | `deliverables` | The delivered files. The tool returns names and sizes, not file contents |
| `driver.log` | `driver_log` | The driver's log |

The driver also writes the model transcripts under `session/`. With `contract: "pick-only"`, the
driver stops after adjudication and writes no `repair.json` or `out/deliverables/`.

A batch run has the same files for each task, under `VERIHARNESS_RUNS/<run>/<bench>_<pool>/`. The
cell directory also holds `run.json`, and `verify_score` writes `scores.json` and
`scores.partial.jsonl` there.

## Workflows

### Verify one task

1. `verify_status`: confirm the verify command and the directories.
2. `verify_model_check`: confirm that the model server is up, the model is present, and the model
   can call tools. verify refuses a model that cannot call tools, because a verifier that cannot
   call tools writes no ledger.
3. `verify_driver` with `task_dir`, `provider`, `model` and, off Linux or with `claude-code`,
   `env: "none"`.
4. `verify_read_result` with `task_dir` and `finish`, then `repair` and `deliverables`.

### Run a benchmark

The benchmarks are `apex`, `wsb`, `wb`, `sb2` and `jb`. A *cell* is one `bench:pool` pair, for
example `wb:flash`. A pool named after a lane runs on that lane: `flash`, `opus`, `haiku` or
`sonnet`. For another pool name, set `lane`.

1. `verify_materialize` with `bench`: build the task workspaces from the benchmark archive.
2. `verify_runner` with `cells` and `run_name`: verify every task in each cell. The runner can
   resume. It skips finished tasks and restarts unfinished ones.
3. `verify_score` with `cell_dir`: score the cell against the archived scores and re-grade the
   delivered bundles.
4. `verify_list_runs` and `verify_read_result` with `run`, `cell` and an artifact.

`verify_grade` grades one deliverables directory. `verify_env_derive` builds the WorkBuddy images
that the native environments use.

## Tools

| Tool | verify command | What it does |
| --- | --- | --- |
| `verify_status` | `--help` | Shows the pin, the resolved command, the data and runs directories, and whether `model-check` is available |
| `verify_model_check` | `model-check` | Probes Ollama, llama.cpp or Claude Code. Needs `provider` and `model` |
| `verify_driver` | `driver <task_dir>` | Verifies one task. The directory must contain `rollouts/` |
| `verify_runner` | `runner --cells bench:pool --run-name NAME` | Verifies the tasks of one or more cells under `VERIHARNESS_RUNS/<run>/` |
| `verify_score` | `score <cell_dir> --json` | Scores a cell. Set `json` to false to get text only |
| `verify_grade` | `grade <bench> <task_key> <deliverables_dir>` | Grades one deliverables directory |
| `verify_materialize` | `materialize <bench>` | Builds task workspaces from the benchmark archive |
| `verify_env_derive` | `env-derive` | Builds WorkBuddy images that include the tool stack |
| `verify_list_runs` | none (reads the runs directory) | Lists run directories and their cells. A missing runs directory gives an empty list |
| `verify_read_result` | none (reads one file) | Reads one fixed artifact from a run cell or a task directory |

### Defaults

The server passes an optional flag only when you set it, so verify keeps its own defaults:

| Option | verify default |
| --- | --- |
| `contract` | `artifact` (repair and deliver). `pick-only` stops after adjudication |
| `env` | `jail` (Linux only) |
| `skills_mode` | `mounted` |
| `turn_timeout`, `nudge_timeout`, `task_timeout` | 1800 s, 600 s, 3600 s |
| `lane_max` (runner lane caps) | flash 25, opus 45, haiku 2, sonnet 2. `max_flash` and `max_opus` also set the first two |
| `skip_inflight` (runner) | 45 minutes |
| `workers`, `batch` (score) | 6, 1 |
| `request_timeout` (local models) | 180 s |

When you set no `provider` and `model`, verify passes none to pi, and pi uses its own default.

Local providers are `ollama` (default `http://127.0.0.1:11434`) and `llamacpp`, with the aliases
`llama.cpp` and `llama-cpp` (default `http://127.0.0.1:8080`). Both need `model`. `base_url`
overrides the address. The `provider` field also accepts the hosted providers that verify accepts.

### Claude Code as the verifier

Provider `claude-code` runs each verifier turn as `claude -p` with Claude Haiku or Claude Sonnet.
It uses the login that Claude Code holds and does not read or print a credential.

- `model` is a full model id: `claude-haiku-4-5-20251001` or `claude-sonnet-5-5`.
- `env` must be `none`. The jail replaces `$HOME`, so Claude Code finds no login in it.
- Do not set `base_url`, `context_size`, `temperature`, `max_tokens`, `top_p` or
  `request_timeout` for `verify_driver` or `verify_runner`, or `thinking` for `verify_driver`.
  verify refuses them with this provider. `verify_model_check` accepts `request_timeout`.
- The runner lanes `haiku` and `sonnet` use this provider with those model ids. A cell such as
  `sb2:haiku` runs on the `haiku` lane. Set `env: "none"` for the run.
- The lanes start two tasks at a time, because the account's usage limit is shared with every
  other Claude Code session. `lane_max` raises a lane, for example `{ "haiku": 4 }`. When the
  account reaches its usage limit, the runner starts no more tasks on that lane.

A runner call for one cell on Haiku:

```json
{
  "cells": ["sb2:haiku"],
  "run_name": "haiku-trial",
  "env": "none",
  "lane_max": { "haiku": 4 }
}
```

verify's [Claude Code design document](https://github.com/danielsimonjr/verify/blob/main/docs/claude-code.md)
gives the flags that each turn uses and what they do not isolate.

### Input checks

`verify_runner` refuses input that verify would act on unsafely:

- `run_name` and each pool in `cells` must be one path segment: letters, digits, `.`, `_` and
  `-`, not starting with a dot. verify joins both under `VERIHARNESS_RUNS` and deletes an existing
  task workspace there.
- `lane` and each `lane_max` key must be `flash`, `opus`, `haiku` or `sonnet`. Each `lane_max`
  value must be 1 or more.
- The `flash` and `opus` caps are set once: with `max_flash` or `max_opus`, or in `lane_max`.
  verify applies `lane_max` over the other two, so a second value would be dropped.
- Each `cell_cap` entry must be `key=N`, where `key` is a bench or `default` and `N` is 1 or more.
  verify accepts a cap of 0, and its scheduler then never starts the cell's tasks.

`verify_driver`, `verify_runner`, `verify_score` and `verify_materialize` carry
`destructiveHint: true`, because they overwrite or delete files under the task or runs directory.

`verify_read_result` reads at most `max_bytes` of a text artifact (default 262144, maximum
2000000). It refuses a path with `..`, and a symbolic link that leaves the runs directory or the
task directory.

### Progress and timeouts

Long tools send `notifications/progress`, at least every 15 seconds. At the timeout, or when the
client cancels, the server stops the verify command and every process under it, including the
detached processes that the driver starts for each agent turn. The result keeps the last 65536
characters of stdout and of stderr.

| Tool | Default timeout |
| --- | --- |
| `verify_status` | 30 s |
| `verify_model_check` | `request_timeout` (default 180) + 30 s |
| `verify_driver` | `task_timeout` (default 3600) + 120 s |
| `verify_runner` | 4 hours |
| `verify_score` | 2 hours |
| `verify_grade` | 30 minutes |
| `verify_materialize`, `verify_env_derive` | 1 hour |

`timeout_seconds` overrides the default for one call.

### Errors

| Message starts with | Cause | Action |
| --- | --- | --- |
| verify is not installed | The server found no verify command | Set `VERIHARNESS_BIN`, or run `bun install` in this repository |
| model-check is absent | The verify build is older than commit `756bc2b` (verify 0.1.0 has it) | Update the verify checkout |
| The local model server is down | Ollama or `llama-server` did not answer | Start the server, or set `base_url` |

## Configuration

### Environment variables

| Variable | Effect |
| --- | --- |
| `VERIHARNESS_BIN` | The verify command. The Claude Code plugin sets it to `~/Github/verify/harness/cli.ts` |
| `VERIHARNESS_DATA` | Materialized task pools |
| `VERIHARNESS_RUNS` | Run output |
| `VERIHARNESS_BENCH_ROOT` | Benchmark archive. `verify_materialize` and the graders need it |
| `VERIHARNESS_TMP` | Grader staging directory |
| `VERIHARNESS_OLLAMA_BASE_URL`, `OLLAMA_HOST` | Ollama address when `base_url` is not set |
| `VERIHARNESS_LLAMACPP_BASE_URL`, `LLAMA_BASE_URL` | llama.cpp address when `base_url` is not set |
| `BUN_BIN` | The `bun` executable that starts a TypeScript verify command |
| `VERIFY_MCP_PROVIDER`, `VERIFY_MCP_MODEL` | The default model. `verify_driver` and `verify_model_check` use it when a call names no provider and no model. Both must be set |
| `VERIFY_MCP_BASE_URL`, `VERIFY_MCP_CONTEXT_SIZE` | The default server URL and context size. A call that sets its own value keeps it |
| `VERIFY_MCP_ENV` | The default execution environment of `verify_driver` (`none` on Windows) |
| `VERIFY_MCP_THINKING`, `VERIFY_MCP_NUDGE_TIMEOUT` | The default `thinking` level and `nudge_timeout` seconds of `verify_driver` |
| `VERIFY_MCP_MAX_TOKENS`, `VERIFY_MCP_REQUEST_TIMEOUT` | The default `max_tokens` and `request_timeout` seconds of `verify_driver` and `verify_model_check` |

The plugin ships no default model. Its `.mcp.json` passes each of these variables through, empty when unset, so a machine sets its own default in the `env` block of its Claude Code `settings.json`. Verify refuses a model that does not report a `num_ctx` of at least the context size, so a default Ollama model needs a `num_ctx` set, in a variant made with `ollama create` or by loading the model at that size. A call that names a provider or a model ignores the whole default.

`example.mcp.json` shows a server entry with every variable set and placeholder values. Copy it to `.mcp.json` in a project, or into your user `.mcp.json`, set the paths and the model, and use it when you run verify-mcp without the plugin. Git ignores a `.mcp.json` at the repository root, so a local copy stays local. With the plugin installed, set the `VERIFY_MCP_*` variables in the `env` block of your Claude Code `settings.json` instead of adding a second server.

The server expands `~` and passes a value that you set to verify as an absolute path.

The server gives verify its own environment. An MCP host can start a stdio server with a reduced
environment, so a variable that you export in your shell can be absent in the server. If a hosted
provider's key or one of the variables above does not reach verify, set it in the `env` block of
the server's MCP configuration. For the Claude Code plugin, that is `plugin/.mcp.json`.

### How the server finds verify

The server starts the verify command as a child process. It does not import verify as a library:
verify's command modules read the environment when they load, write to stdout and stderr, and exit
the process, and a driver run starts process trees that must be stopped as a group.

The server looks for the command in this order:

1. `VERIHARNESS_BIN`. A `.ts`, `.js` or `.mjs` file starts with `bun`. Any other file runs as it
   is.
2. `node_modules/@danielsimonjr/verify/harness/cli.ts`, which `bun install` in this repository puts there.
   It is the npm package `@danielsimonjr/verify`, pinned to the exact version named in `src/pin.ts`.

With the copy in `node_modules`, and no `VERIHARNESS_DATA` or `VERIHARNESS_RUNS` set, the data and
run directories are `./data` and `./runs` in the server's working directory. That keeps run output
out of `node_modules`. A verify checkout keeps verify's own defaults, which are `data/` and `runs/`
in the checkout.

The Claude Code plugin contains the server but not verify, because verify reads its prompts, skills
and scripts from the folders next to its command. To use a checkout at another path, change
`VERIHARNESS_BIN` in `plugin/.mcp.json`.

## Other hosts

### Codex

```bash
codex plugin marketplace add danielsimonjr/verify-mcp
codex plugin add verify-mcp@verify-mcp
```

You can also install it from `/plugins` after you add the marketplace. Codex starts
`bun ./src/index.ts` in the plugin root (`mcp.json`).

### Cursor

Copy the checkout into the local plugin directory. Cursor does not load a symbolic link to a path
outside that directory.

```bash
mkdir -p ~/.cursor/plugins/local
cp -R /path/to/verify-mcp ~/.cursor/plugins/local/verify-mcp
cd ~/.cursor/plugins/local/verify-mcp && bun install
```

Restart Cursor, or run **Developer: Reload Window**. Then open **Customize** and install the
plugin. Cursor can load both the Cursor manifest and the root Agent Plugin manifest, and then shows
two `verify` servers. Keep the one from `.cursor-plugin/plugin.json`.

### Any MCP client

```bash
git clone https://github.com/danielsimonjr/verify-mcp.git
cd verify-mcp
bun install
bun src/index.ts              # stdio
bun src/index.ts --http 8787  # Streamable HTTP on http://127.0.0.1:8787/mcp
```

The HTTP server listens on the loopback address only.

## Windows

- verify's default environment, `jail`, uses Linux mount namespaces. On Windows, pass
  `env: "none"` to `verify_driver` and `verify_runner`. Without it, the driver refuses to start
  and says why.
- For `claude-code`, Claude Code needs Git for Windows. verify starts `claude` from `PATH`. If
  `claude` is a `.cmd` shim, set `VERIHARNESS_CLAUDE_BIN` to the path of `claude.exe` in the
  server's environment. Node cannot start a `.cmd` file without a shell.
- Run `harness/scripts/setup_pi.sh` from Git Bash. It installs pi with npm, which makes the
  `pi`, `pi.cmd` and `pi.ps1` launchers. verify-mcp starts verify with Bun, and Bun starts pi
  through them.
- The server stops a timed-out verify command with `taskkill /T /F`, so the processes under it
  stop too.
- CI runs the test suite on `windows-latest` and on `ubuntu-latest`.

## Security

- **`env: "none"` is not a sandbox.** The verifier runs shell commands as your user, on your
  machine. Verify only rollouts whose files you are willing to have read and run there. On Linux,
  the default jail hides the rest of `$HOME`, the archived scores and the benchmark answer keys from
  the verifier.
- **The Claude Code lanes always run without the jail.** A verifier on `haiku` or `sonnet` can read
  the results of other tasks and the benchmark answer keys. Do not use those scores where
  answer-key secrecy matters. With `env: "none"`, the runner also runs the pi cells of the same run
  without the jail.
- `verify_list_runs` and `verify_read_result` read only inside the runs directory or the task
  directory that you name. They accept fixed artifact names, not paths.
- `verify_runner` refuses run and pool names that would reach outside the runs directory.
- The server returns no environment values in tool results. It passes its own environment to
  verify, so the verifier model's credentials reach verify only through that environment.

## Protocol

The server negotiates MCP protocol revision
[`2026-07-28`](https://modelcontextprotocol.io/specification/2026-07-28). It also accepts a client
that starts with a 2025 `initialize`, so hosts that do not yet ask for `2026-07-28` can connect. A
test pins a client to `2026-07-28` and checks that the server answers with that revision.

- The server declares tools only. It does not declare logging, roots or sampling, which the
  `2026-07-28` revision deprecates or replaces.
- Transports: stdio (`serveStdio`) and Streamable HTTP (`createMcpHandler`), from
  `@modelcontextprotocol/server` 2.3.0. Progress notifications switch an HTTP response to SSE. The
  older HTTP+SSE transport is not implemented.
- The v1 SDK, `@modelcontextprotocol/sdk`, does not support `2026-07-28`, so the server does not
  use it.

## Development

```bash
bun install
bun run typecheck
bun test
bun run bundle   # after a change to src/, commands/ or skills/
```

`bun run bundle` rebuilds `plugin/`. Commit the rebuilt `plugin/` with the change:
`tests/bundle.test.ts` fails when `plugin/` does not match a fresh build.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `bun install --frozen-lockfile`,
`bun run typecheck` and `bun test` on `ubuntu-latest` and `windows-latest`.

### Source

| Path | Role |
| --- | --- |
| `src/index.ts` | Entry point: stdio, or HTTP with `--http PORT` |
| `src/http.ts` | Streamable HTTP on `127.0.0.1`, with host and origin checks |
| `src/server.ts` | Tool registration |
| `src/schemas.ts` | Tool input schemas |
| `src/handlers.ts` | Tool handlers |
| `src/argv.ts` | Tool input to verify arguments, and the timeouts |
| `src/run.ts` | Child process, progress, process-tree stop |
| `src/resolve.ts` | Finds the verify command and the directories |
| `src/results.ts` | `verify_list_runs` and `verify_read_result` |
| `src/protocol.ts`, `src/pin.ts` | Protocol revision, server identity, verify pin |

### Plugin files

| File | Host | Role |
| --- | --- | --- |
| `plugin/.claude-plugin/plugin.json` | Claude Code | Plugin manifest |
| `plugin/.mcp.json` | Claude Code | Starts `bun ${CLAUDE_PLUGIN_ROOT}/bundle/index.mjs` and sets `VERIHARNESS_BIN` |
| `plugin/bundle/index.mjs` | Claude Code | The server and its dependencies in one file. A plugin cache has no `node_modules`, so the plugin cannot start `src/index.ts` |
| `plugin/skills/verify/SKILL.md`, `plugin/commands/verify.md` | Claude Code | Copies of `skills/` and `commands/`, made by `bun run bundle` |
| `.claude-plugin/marketplace.json` | Claude Code | Marketplace entry, `source` `./plugin` |
| `plugin.json`, `mcp.json` | Codex, Cursor | Agent Plugin manifest and stdio server |
| `.codex-plugin/plugin.json` | Codex | Fallback manifest. Codex ignores it when the root `plugin.json` exists |
| `.agents/plugins/marketplace.json` | Codex | Repository marketplace |
| `.cursor-plugin/plugin.json`, `mcp.cursor.json` | Cursor | Cursor plugin and its stdio server, with `${CURSOR_PLUGIN_ROOT}` |

`tests/manifests.test.ts` checks each manifest against the host's published schema (copies are in
`tests/fixtures/`) and checks that every manifest carries the `package.json` version.

## License

Apache-2.0, the same license as verify.
