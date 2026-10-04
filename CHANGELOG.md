# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

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
