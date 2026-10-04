# verify-mcp

MCP server for [danielsimonjr/verify](https://github.com/danielsimonjr/verify) (the `veriharness` CLI). It runs on Bun, speaks protocol revision `2026-07-28`, and installs as a plugin in Claude Code, Codex, and Cursor.

The package is not published to npm, and the plugin is not submitted to a marketplace. Install it from this repository.

## Protocol

There is no spec numbered 2.0. MCP versions are dates. The current revision, which is the one people mean by “MCP 2.0”, is **`2026-07-28`**. This server negotiates that revision. A test pins the client to `2026-07-28` and asserts `getProtocolEra() === "modern"` and `getNegotiatedProtocolVersion() === "2026-07-28"`.

Checked:

- [Specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (changes since `2025-11-25`, including stateless requests and required `server/discover`)
- [Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) and the [docs versioning page](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning), which name `2026-07-28` as the current revision
- npm `latest` for [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) and [`@modelcontextprotocol/client`](https://www.npmjs.com/package/@modelcontextprotocol/client): **2.3.0**
- npm `latest` for the v1 package [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk): **1.32.0**, which does not speak `2026-07-28`

SDK 2.3.0 exports `LATEST_PROTOCOL_VERSION` as the legacy date `2025-11-25`. This server does not use that constant. Stdio is `serveStdio` from `@modelcontextprotocol/server/stdio`. HTTP is `createMcpHandler` from `@modelcontextprotocol/server`. Both default to serving a 2025 `initialize` as well, so Claude Code, Codex, and Cursor can connect before they pin `2026-07-28`. A client that pins `2026-07-28` gets that revision for the connection.

The server advertises **tools only**. It does not declare logging, roots, or sampling. Those are deprecated or replaced on `2026-07-28` (logging moves to stderr; roots and sampling become `input_required`, which these tools do not need). HTTP+SSE is not implemented. Streamable HTTP is available with `bun src/index.ts --http 8787` at `http://127.0.0.1:8787/mcp`. Progress notifications upgrade that response to SSE.

## How it runs verify

The server **spawns the veriharness CLI**. It does not import the library.

verify’s programmatic entry is `main(argv)` on each command module. Importing it reads environment variables at load time, writes to stdout and stderr, and exits the process. A driver run also starts child processes that have to be killed as a group when the tool times out or the client cancels. `model-check` missing from an older binary is an `unknown command` exit, which a spawn sees and an import would not. The documented contract is the CLI.

Bun runs `harness/cli.ts` directly, so the git dependency does not need a `dist/` build. The pin is the full SHA of “Add Ollama and llama.cpp local model backends (#2)” on verify `main`:

```text
github:danielsimonjr/verify#756bc2b381b2505f307c850db5922820ce0b2e05
```

Resolution order:

1. `VERIHARNESS_BIN`, if set. A `.ts` / `.js` / `.mjs` path is launched with `bun`. Anything else is executed as-is.
2. Otherwise `node_modules/veriharness/harness/cli.ts` via `bun`.

If neither exists, the tool returns an error that names the pin, `bun install`, and `VERIHARNESS_BIN`.

When the resolved checkout is `node_modules/veriharness` and you did not set `VERIHARNESS_DATA` or `VERIHARNESS_RUNS`, those directories default to `./data` and `./runs` in the server’s working directory. That keeps run output out of `node_modules`. A real checkout keeps verify’s own defaults unless you set the variables. `~` is expanded, and a value you set is passed through as an absolute path.

Long tools send `notifications/progress` (monotonic, throttled, with a 15s heartbeat) and are killed by process group on timeout or client cancel. The tool result keeps the last 64KiB of stdout and stderr.

## Requirements

- [Bun](https://bun.sh) 1.1 or newer (CI uses 1.4.2). `bun` must be on `PATH` for every plugin host.
- For local models: Ollama on `http://127.0.0.1:11434` or llama.cpp’s `llama-server` on `http://127.0.0.1:8080`, unless you pass `base_url`.

## Install the server

```bash
git clone https://github.com/danielsimonjr/verify-mcp.git
cd verify-mcp
bun install
bun src/index.ts
```

`bun src/index.ts` speaks stdio and is what the plugins launch. `bun src/index.ts --http 8787` serves Streamable HTTP on loopback.

## Tools

| Tool | verify command | What it does |
| --- | --- | --- |
| `verify_status` | `--help` | Pin, resolved command, data and runs directories, and whether `model-check` is in this binary |
| `verify_model_check` | `model-check` | Probe Ollama or llama.cpp. Requires `provider` and `model` |
| `verify_driver` | `driver <task_dir>` | One task. The directory must contain `rollouts/` |
| `verify_runner` | `runner --cells bench:pool --run-name NAME` | Batch cells under `VERIHARNESS_RUNS/<run>/` |
| `verify_score` | `score <cell_dir> --json` | Score a cell. `--json` is on unless you set `json` false |
| `verify_grade` | `grade <bench> <task_key> <deliverables_dir>` | Grade one deliverables directory |
| `verify_materialize` | `materialize <bench>` | Build task workspaces from the benchmark archive |
| `verify_env_derive` | `env-derive` | Derive WorkBuddy images that include the tool stack |
| `verify_list_runs` | (reads the filesystem) | List run directories and their cells. A missing runs directory is an empty list |
| `verify_read_result` | (reads the filesystem) | Read one fixed artifact from a run cell or a task directory |

Benches are `apex`, `wsb`, `wb`, `sb2`, and `jb`. Optional flags are forwarded only when you set them, so verify keeps its own defaults (`--contract artifact`, `--env jail`, `--skills-mode mounted`, turn timeout 1800s, nudge timeout 600s, task timeout 3600s, flash lane cap 25, opus lane cap 45).

Local providers: `ollama` (aliases none; default `http://127.0.0.1:11434`) and `llamacpp` (aliases `llama.cpp` and `llama-cpp`; default `http://127.0.0.1:8080`). Both need `model`. verify also accepts its cloud providers on `provider` / `model`; this server does not add any of its own.

`verify_read_result` artifacts: `ledger_elim`, `ledger_fals`, `finish`, `repair`, `driver_log`, `run`, `scores`, `scores_partial`, `deliverables`. `deliverables` returns names and sizes under `out/deliverables`, not file bytes. Paths with `..` or a symlink that leaves the runs root or the task directory are rejected.

### Timeouts

| Tool | Default wall clock |
| --- | --- |
| `verify_status` | 30s |
| `verify_model_check` | `request_timeout` (default 180) + 30s |
| `verify_driver` | `task_timeout` (default 3600) + 120s |
| `verify_runner` | 4 hours |
| `verify_score` | 2 hours |
| `verify_grade` | 30 minutes |
| `verify_materialize`, `verify_env_derive` | 1 hour |

`timeout_seconds` overrides the default for that call.

### Errors

- **verify is not installed.** The message names the pin, `bun install`, and `VERIHARNESS_BIN`.
- **model-check is absent.** An older `VERIHARNESS_BIN` that exits with `unknown command: model-check` returns an error that points at verify PR #2. The pinned SHA includes the command.
- **The local model server is down.** verify’s `Ollama is not reachable` / `llama-server is not reachable` text is prefixed with that sentence.

## Plugins

Bun must be on `PATH`. The Codex and Cursor manifests launch `bun` on `src/index.ts`. The Claude Code plugin launches a committed bundle (see below). Formats were checked against the pages and schemas below; the copies used in CI are in `tests/fixtures/`.

### Claude Code

The Claude Code plugin is the `plugin/` folder. Claude Code serves a plugin from a cache clone and does not run `bun install` there, so `src/index.ts` cannot resolve its imports. `plugin/.mcp.json` launches a self-contained bundle instead.

| File | Role | Checked against |
| --- | --- | --- |
| `plugin/.claude-plugin/plugin.json` | Plugin manifest | [Plugins reference](https://code.claude.com/docs/en/plugins-reference) and [claude-code-plugin-manifest.json](https://json.schemastore.org/claude-code-plugin-manifest.json) |
| `plugin/.mcp.json` | MCP server: `bun ${CLAUDE_PLUGIN_ROOT}/bundle/index.mjs`. Auto-discovered, so `plugin.json` does not also set `mcpServers` | same reference (`.mcp.json` is loaded in addition to `mcpServers`) |
| `plugin/bundle/index.mjs` | The server and its npm dependencies, built by `bun run bundle` | `tests/bundle.test.ts` compares it with a fresh build and starts it with no `node_modules` in reach |
| `.claude-plugin/marketplace.json` | Marketplace entry with `source` `"./plugin"` | [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces) and [claude-code-marketplace.json](https://json.schemastore.org/claude-code-marketplace.json) |
| `plugin/skills/verify/SKILL.md` | Skill, copied from `skills/` by `bun run bundle` | discovered from `skills/` |
| `plugin/commands/verify.md` | Slash command, copied from `commands/` by `bun run bundle` | discovered from `commands/` |

The bundle targets Bun, because the server calls `Bun.spawn`, `Bun.which` and `Bun.serve`.

The bundle does not contain the veriharness CLI. The server spawns the CLI, and the CLI reads asset folders next to itself. `plugin/.mcp.json` sets `VERIHARNESS_BIN` to `~/Github/verify/harness/cli.ts`. Clone [danielsimonjr/verify](https://github.com/danielsimonjr/verify) to that path, at the pinned commit or later, and run `bun install` in it. Run output then goes to the checkout's `data/` and `runs/`, which verify ignores. To use a checkout at a different path, edit `plugin/.mcp.json`.

Local, from a checkout:

```bash
claude --plugin-dir /path/to/verify-mcp/plugin
```

From GitHub:

```bash
claude plugin marketplace add danielsimonjr/verify-mcp
claude plugin install verify-mcp@verify-mcp
```

Inside a session the same steps are `/plugin marketplace add danielsimonjr/verify-mcp` and `/plugin install verify-mcp@verify-mcp`.

### Codex

| File | Role | Checked against |
| --- | --- | --- |
| `plugin.json` | Portable Agent Plugin manifest | [Package your plugin](https://developers.openai.com/plugins/build/plugins) and [plugin.schema.json](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) |
| `mcp.json` | stdio server, `cwd` `"./"` | [mcp.schema.json](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json) |
| `.codex-plugin/plugin.json` | Compatibility fallback. Not merged when the root portable manifest is present | same packaging page |
| `.agents/plugins/marketplace.json` | Repository marketplace | Codex plugin marketplace docs ([CLI reference](https://developers.openai.com/codex/cli/reference)) |

```bash
codex plugin marketplace add danielsimonjr/verify-mcp
codex plugin add verify-mcp@verify-mcp
```

You can also install from `/plugins` after the marketplace is added. `bun` must be on `PATH`, and the server entry is `./src/index.ts` with working directory `./` (the plugin root). Codex does not expand `${CURSOR_PLUGIN_ROOT}`.

### Cursor

| File | Role | Checked against |
| --- | --- | --- |
| `.cursor-plugin/plugin.json` | Cursor plugin. `mcpServers` is `./mcp.cursor.json`, which overrides root `mcp.json` discovery | [Plugins](https://cursor.com/docs/plugins) and [Plugins reference](https://cursor.com/docs/reference/plugins). Schema: [plugin.schema.json](https://raw.githubusercontent.com/cursor/plugins/main/schemas/plugin.schema.json) |
| `mcp.cursor.json` | stdio server using `${CURSOR_PLUGIN_ROOT}` | same reference. Cursor expands `${CURSOR_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}`, not `${PLUGIN_ROOT}` |
| `plugin.json` + `mcp.json` | Agent Plugin, which Cursor also loads | [Plugins](https://cursor.com/docs/plugins) |

Copy the checkout into the local plugin directory (a symlink to a path outside that directory is not loaded), then reload:

```bash
mkdir -p ~/.cursor/plugins/local
cp -R /path/to/verify-mcp ~/.cursor/plugins/local/verify-mcp
```

Restart Cursor, or run **Developer: Reload Window**, then open **Customize** and install the plugin.

This repo contains both a root Agent Plugin and a Cursor plugin, because each host asked for its own manifest. Cursor can load both and show two `verify` servers. If that happens, keep `.cursor-plugin/plugin.json` (it uses `${CURSOR_PLUGIN_ROOT}`) and ignore the duplicate.

## Environment

| Variable | Effect |
| --- | --- |
| `VERIHARNESS_BIN` | Override the CLI path |
| `VERIHARNESS_DATA` | Materialized pools. Default `./data` for the packaged install |
| `VERIHARNESS_RUNS` | Run output. Default `./runs` for the packaged install |
| `VERIHARNESS_BENCH_ROOT` | Benchmark archive checkout. Passed through to verify. Needed to materialize |
| `VERIHARNESS_TMP` | Grader temp dir. Passed through |
| `VERIHARNESS_OLLAMA_BASE_URL`, `OLLAMA_HOST` | Ollama URL when `base_url` is omitted |
| `VERIHARNESS_LLAMACPP_BASE_URL`, `LLAMA_BASE_URL` | llama.cpp URL when `base_url` is omitted |
| `BUN_BIN` | Override the `bun` executable used to launch a TypeScript CLI |

## Development

```bash
bun install
bun run typecheck
bun test
bun run bundle   # after a change to src/, commands/ or skills/
```

Commit the rebuilt `plugin/` with the change. `tests/bundle.test.ts` fails while `plugin/` is stale.

CI is [`.github/workflows/ci.yml`](.github/workflows/ci.yml): `oven-sh/setup-bun`, `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`.

## License

Apache-2.0, the same license as verify.
