/**
 * Protocol revision this server negotiates.
 *
 * Nothing in the spec is numbered "2.0". Protocol versions are ISO dates.
 * The current revision, informally called MCP 2.0, is `2026-07-28`:
 * - https://modelcontextprotocol.io/specification/2026-07-28
 * - https://modelcontextprotocol.io/specification/2026-07-28/changelog
 * - https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning
 *
 * The TypeScript SDK that implements that revision is major 2. This package
 * pins `@modelcontextprotocol/server` and `@modelcontextprotocol/client`
 * at 2.3.0, the latest stable release on the npm registry. The v1 monolith
 * `@modelcontextprotocol/sdk` does not speak `2026-07-28`.
 *
 * `LATEST_PROTOCOL_VERSION` exported by the SDK is the legacy latest
 * (`2025-11-25`). Serving goes through `serveStdio` / `createMcpHandler`,
 * which negotiate `2026-07-28` when the client asks for it and still accept
 * a 2025 `initialize` so Claude Code, Codex, and Cursor can connect.
 */

export const PROTOCOL_VERSION = "2026-07-28";

export const SERVER_NAME = "verify";

export const SERVER_VERSION = "0.1.0";

export const SERVER_INSTRUCTIONS =
  "Tools wrap the veriharness CLI from danielsimonjr/verify. " +
  "A task directory must contain rollouts/. Local models use provider ollama " +
  "(default http://127.0.0.1:11434) or llamacpp (default http://127.0.0.1:8080). " +
  "Long tools report progress and stop at their timeout. " +
  "verify_model_check probes a local server before a run. " +
  "verify_list_runs and verify_read_result read the runs directory; " +
  "they do not accept arbitrary paths.";
