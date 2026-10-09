# todo

Open work for this repository. Check an item off when it lands, in the same commit.

## Claude Code verifier

- [x] Provider `claude-code` and lanes `haiku` and `sonnet`, after verify releases its Claude Code runtime: add the lanes to `LANES` (the drift test compares them with the pin), a `lane_max` option for `--lane-max`, `claude-code` in the `provider` descriptions, and `verify_model_check` for `claude-code`. Done in #2.
- [x] Bump the verify pin to that release and re-run the suite. Done in #2: the pin is `0a7bbf3` (verify #16); 45 pass, 1 skip (POSIX only), 0 fail on Windows.
- [x] Measure the environment that Claude Code gives a plugin's stdio server. If it is reduced, the Claude Code login and the session markers can differ in the verifier child. Prove it from the server, not from the configuration. Done 2026-10-05, proven by outcome through a server that Claude Code started: `verify_model_check` (claude-code, Haiku) replied OK with `keySource` none, so the verifier child found the Claude Code login; `verify_driver` (Haiku, `env: "none"`) exited 0 in 149 s with base r1 and a valid repair, and left no claude.exe running. The variable list itself was not dumped.

## Quality gates

- [x] Doc comments: `repo-tools docs check src` reported 63 exported symbols without a doc comment (argv.ts 19, handlers.ts 16, schemas.ts 11, resolve.ts 7, results.ts 6, run.ts 3, http.ts 1). It now passes with no MUST or SHOULD issue.

## Hosts

- [ ] Codex installs the plugin from a clone and starts `bun ./src/index.ts`. Confirm that the clone has `node_modules`. If it does not, the Codex manifest needs the bundle, as the Claude Code plugin does.

## Five-axis assessments

- 2026-10-04 — README. Speed, stability, security: no change. Reliability: the README now names the pi runtime and `env: "none"`, without which `verify_driver` cannot start on a fresh Windows checkout. Maintainability: one README section per user question. Left: the doc-comment gate and the Codex install question above.
- 2026-10-05 — verify pin `0a7bbf3` (#2). Speed: no change. Stability: no change; 45 pass, 1 skip, 0 fail. Reliability: what a verifier leaves under `out/` no longer stops a task before its result is recorded (verify #16). Security: the pin takes verify's symlink refusals for graders (#15) and the driver (#16), the SB2 deliverable link refusal and the jail's failed-remount stop (#13). Maintainability: the pin lives in `src/pin.ts` and `package.json`, and a test compares them. Left: a live Haiku and Sonnet task through the server, and the stdio environment measurement above.
- 2026-10-05 — verify pin `c10100b` (#19, package name `verify`). Speed: no change. Stability: no change; 45 pass, 1 skip, 0 fail. Reliability: the resolver looks for `node_modules/verify`; `bun install` left the old `node_modules/veriharness` in place, so it was moved aside before the local run, which then resolved only what a fresh install has. Security: no change. Maintainability: verify and verify-mcp use one package name, and a test fails if the `veriharness` dependency key returns. Left: nothing.
- 2026-10-06 — verify pin `74a39c5` (pi runtime from `@danielsimonjr/pi`), 0.2.2. Speed: no change. Stability: no change. Reliability: the pin matches the verify commit whose `setup_pi.sh` the README tells a user to run; the README no longer names a stale commit. Security: no change; the pin stays a full SHA. Maintainability: one source for the pin, `src/pin.ts`, checked by the manifest test. Left alone: the README requirement lines for the earlier minimum commits `756bc2b` and `102894a`, which are feature floors and still true.
- 2026-10-06 — verify comes from npm (`@danielsimonjr/verify` 0.1.0), 0.3.0. Speed: no change. Stability: no change. Reliability: an exact registry version replaces a git commit, so `bun install` needs no GitHub access and no git clone of verify. Security: no change; the version is exact, and the lockfile holds the registry integrity hash. Maintainability: one pin in `src/pin.ts`, checked against `package.json` by a test. Left alone: the plugin still points at a verify checkout through `VERIHARNESS_BIN`; moving it to the npm package needs an install step at plugin start.
- [x] Default model profile from the environment (`VERIFY_MCP_*`), 0.4.0
- [x] Default model variant that carries a num_ctx, 0.4.1 (the plugin default was removed in 0.4.2)
- [x] The plugin ships no default model: pass VERIFY_MCP_* through empty, drop the model and host from the docs, pin it with a test, 0.4.2
- [x] example.mcp.json for a user's own server entry, README mention, gitignore a local root .mcp.json
- [x] Tuning variables in the env profile: VERIFY_MCP_THINKING, _NUDGE_TIMEOUT, _MAX_TOKENS, _REQUEST_TIMEOUT (0.5.0)
- [x] Haiku and sonnet lane caps default to 4 when the cells use the lane and the call names no cap (0.5.1)
- [x] All four lanes run Claude Code (verify 0.2.0): pin verify 0.2.0, drop the wrapper cap default, say that every lane needs env none (0.6.0)
