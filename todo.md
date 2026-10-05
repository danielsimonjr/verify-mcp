# todo

Open work for this repository. Check an item off when it lands, in the same commit.

## Claude Code verifier

- [x] Provider `claude-code` and lanes `haiku` and `sonnet`, after verify releases its Claude Code runtime: add the lanes to `LANES` (the drift test compares them with the pin), a `lane_max` option for `--lane-max`, `claude-code` in the `provider` descriptions, and `verify_model_check` for `claude-code`. Done in #2.
- [x] Bump the verify pin to that release and re-run the suite. Done in #2: the pin is `0a7bbf3` (verify #16); 45 pass, 1 skip (POSIX only), 0 fail on Windows.
- [ ] Measure the environment that Claude Code gives a plugin's stdio server. If it is reduced, the Claude Code login and the session markers can differ in the verifier child. Prove it from the server, not from the configuration.

## Quality gates

- [x] Doc comments: `repo-tools docs check src` reported 63 exported symbols without a doc comment (argv.ts 19, handlers.ts 16, schemas.ts 11, resolve.ts 7, results.ts 6, run.ts 3, http.ts 1). It now passes with no MUST or SHOULD issue.

## Hosts

- [ ] Codex installs the plugin from a clone and starts `bun ./src/index.ts`. Confirm that the clone has `node_modules`. If it does not, the Codex manifest needs the bundle, as the Claude Code plugin does.

## Five-axis assessments

- 2026-10-04 — README. Speed, stability, security: no change. Reliability: the README now names the pi runtime and `env: "none"`, without which `verify_driver` cannot start on a fresh Windows checkout. Maintainability: one README section per user question. Left: the doc-comment gate and the Codex install question above.
- 2026-10-05 — verify pin `0a7bbf3` (#2). Speed: no change. Stability: no change; 45 pass, 1 skip, 0 fail. Reliability: what a verifier leaves under `out/` no longer stops a task before its result is recorded (verify #16). Security: the pin takes verify's symlink refusals for graders (#15) and the driver (#16), the SB2 deliverable link refusal and the jail's failed-remount stop (#13). Maintainability: the pin lives in `src/pin.ts` and `package.json`, and a test compares them. Left: a live Haiku and Sonnet task through the server, and the stdio environment measurement above.
