# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.2] - 2026-10-06

### Changed

- verify-mcp pins verify `74a39c5`. That verify commit installs its pi agent runtime from
  `@danielsimonjr/pi` (0.84.4) and not from `@earendil-works/pi-coding-agent`. The plugin still
  launches the verify checkout through `VERIHARNESS_BIN`, so a checkout needs `setup_pi.sh` run again
  after it is updated to that commit. No npm publish is involved: verify is a git dependency.
- The README names the real pinned commit. It still named `0a7bbf3`.

## [0.2.1] - 2026-10-05

### Changed

- verify-mcp pins verify `c10100b` (verify PR #19). The dependency is named `verify`, the package's
  new name, and the server looks for `node_modules/verify`. The command and the `VERIHARNESS_`
  variables keep their names.
- The new pin also includes verify PR #17 and PR #18. In a grader, the stdout cap now kills the whole
  process tree and runs the cleanup hook, as the timeout does. The live Claude Code test now checks
  that the verifier picks the right answer.

## [0.2.0] - 2026-10-05

### Added

- The Claude Code verifier. verify-mcp pins verify `0a7bbf3` (verify PR #16). Since verify PR #11
  (`102894a`), verify runs the verifier on Claude Haiku or Claude Sonnet through `claude -p` with the
  login that Claude Code holds. The provider fields name `claude-code`. `verify_model_check` probes it.
- `verify_runner` accepts the lanes `haiku` and `sonnet`, `lane_max` (one `--lane-max LANE=N` per
  lane; a strict object, so an unknown lane or `__proto__` is an input error) and `env`, which
  verify passes to every driver. The Claude Code lanes need `env: "none"`.
- A `verify_model_check` error for a verify build without the Claude Code provider says so and
  names the commit that added it.
- The README, the `verify` skill and the `/verify` command describe the Claude Code verifier, its
  lanes, its Windows setup (`VERIHARNESS_CLAUDE_BIN`) and the fact that it always runs without the
  jail.

### Fixed

- The text for a verify build without `model-check` named the pinned commit as the commit that
  added it. It names `756bc2b` (verify PR #2) now; the pin moves and that commit does not.
- The detached-grandchild test stops the run when the grandchild has started, not after a fixed
  1.5 s timeout. Two Bun cold starts can take longer than 1.5 s on a loaded host; the stop then
  came before the grandchild existed, and the test failed in a full run but passed alone. A
  negative control (taskkill without `/T`) still fails it.

### Changed

- `verify_runner` refuses a cap set twice for one lane (`max_flash` with `lane_max.flash`, or
  `max_opus` with `lane_max.opus`). verify applies `lane_max` over the other two, so one value was
  dropped.
- The README is written for a user of the server. It explains what verify does, gives a quick start
  in Claude Code (a verify checkout, its pi runtime, the plugin, a first task), describes the task
  workspace and each output file, and adds workflows, a defaults table, a Windows section, a
  security section and a source map. It now states that the driver needs pi
  (`harness/scripts/setup_pi.sh`), that `env: "none"` is required off Linux, and that an MCP host
  can start the server with a reduced environment.
- Every exported symbol in `src/` has a doc comment: `repo-tools docs check src` passes with no MUST
  or SHOULD issue. It reported 63 symbols with no comment.
- The README gives the output tail as 65536 characters. It said 64 KiB, but the tail is cut from
  the decoded text, not from the bytes.
- CI runs the tests on `windows-latest` as well as `ubuntu-latest`. The Windows process-tree
  kill and the Windows path handling had no CI coverage.
- Dependabot proposes weekly bumps for the SHA-pinned GitHub Actions. Dependabot alerts and CodeQL
  default setup are on for the repository.

### Security

- The verify pin takes verify's symlink hardening. The verifier can write `out/` in its task
  workspace. verify now refuses a symlink there: a grader does not read through one (verify #15),
  and the driver does not delete, write, create or list through one on the host (verify #16). What
  the verifier leaves under `out/` no longer stops a task before its result is recorded (verify
  #16). The pin also takes the review fixes of verify #12 and #13, among them an SB2 deliverable
  that is a symlink is refused, and the jail stops when a read-only remount fails.

## [0.1.1] - 2026-10-04

### Security

- `verify_runner` rejects a `run_name` or a pool in `cells` that is not one path segment. verify
  joins both under `VERIHARNESS_RUNS` and deletes an existing task workspace there, so a value
  such as `../x` or `wb:..` made the runner delete directories outside the runs directory. A
  segment is letters, digits, `.`, `_` and `-`, not starting with a dot.
- A timeout or a client cancel kills the whole process tree. verify's driver starts each agent
  turn as a detached child, which leads its own process group on POSIX and leaves the parent's
  job object on Windows, so the old group kill left the turn running. POSIX now takes a `ps`
  snapshot of the descendants before it signals them; Windows uses `taskkill /T /F`.

### Fixed

- `verify_runner` rejects a `lane` other than `flash` or `opus` and a `cell_cap` entry whose cap is
  below 1 or whose key is not a bench or `default`. verify accepted both, and its scheduler then
  never started the cell's tasks and waited forever.
- The `skip_inflight` description gives the unit as minutes. It said seconds.
- `verify_read_result` reads at most `max_bytes` plus one byte of a text artifact. It read the
  whole file to return the prefix, so a large `driver.log` blocked the server and could exhaust
  its memory.
- `verify_driver`, `verify_runner`, `verify_score` and `verify_materialize` carry
  `destructiveHint: true`. They overwrite or delete files, and `false` declares additive changes
  only.
- A call that times out and is then cancelled is stopped once. The second stop armed a `SIGKILL`
  timer that was never cleared and fired at a stale list of process IDs.

- The Claude Code plugin installs and starts from a marketplace. It was the repository root, and
  `.mcp.json` launched `bun` on `src/index.ts`. A plugin cache clone has no `node_modules`, so the
  server could not resolve `@modelcontextprotocol/server` or `zod`, and the CLI lookup in
  `node_modules/veriharness` failed too. The plugin is now `plugin/`: its `.mcp.json` launches a
  committed bundle, `plugin/bundle/index.mjs`, and sets `VERIHARNESS_BIN` to a verify checkout at
  `~/Github/verify`. The marketplace entry's `source` is `"./plugin"`.
- `tests/resolve.test.ts` passes on Windows. Two assertions matched `/` path separators.

### Added

- `bun run bundle` (`scripts/bundle.ts`) builds `plugin/`: the Bun-target bundle plus copies of the
  skill and the command. It builds from the repository root, so the output is byte-identical
  wherever it runs.
- `tests/bundle.test.ts`: `plugin/` must match a fresh build, and the bundle must start and list
  every tool from a directory with no `node_modules` in reach.
- `tests/manifests.test.ts`: every manifest must carry the `package.json` version.

### Removed

- The root `.mcp.json`. Its only role was the Claude Code plugin's MCP registration, which
  `plugin/.mcp.json` now holds.

## [0.1.0] - 2026-10-04

### Added

- MCP server for the veriharness CLI on Bun, protocol revision `2026-07-28`, with plugin manifests
  for Claude Code, Codex and Cursor.
