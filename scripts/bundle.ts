/**
 * Build the Claude Code plugin folder (`plugin/`) from source.
 *
 * Claude Code serves a plugin from a cache clone and never runs `bun install` there, so
 * `plugin/.mcp.json` launches a committed, self-contained bundle instead of `src/index.ts`.
 * The server calls Bun-only APIs (`Bun.spawn`, `Bun.which`, `Bun.serve`), so the bundle
 * targets Bun. The veriharness CLI is not bundled: the server spawns it, and it reads asset
 * folders next to itself.
 *
 * Run `bun run bundle` after changing `src/`, `commands/` or `skills/`.
 * `tests/bundle.test.ts` fails while the committed `plugin/` is stale.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

/** Files copied verbatim into `plugin/`, relative to the repository root. */
export const COPIED = ["commands/verify.md", "skills/verify/SKILL.md"];

/** Every generated `plugin/` file, built in memory: path relative to `plugin/` -> contents. */
export async function buildPlugin(): Promise<Map<string, string>> {
  const previous = process.cwd();
  // Bun writes a source-path comment per module, relative to the working directory.
  // Building from the repository root keeps the bundle byte-identical wherever it is run.
  process.chdir(ROOT);
  try {
    const result = await Bun.build({ entrypoints: ["src/index.ts"], target: "bun" });
    if (!result.success) throw new AggregateError(result.logs, "bundle failed");
    const files = new Map<string, string>();
    files.set("bundle/index.mjs", await result.outputs[0].text());
    for (const rel of COPIED) files.set(rel, readFileSync(join(ROOT, rel), "utf8"));
    return files;
  } finally {
    process.chdir(previous);
  }
}

if (import.meta.main) {
  for (const [rel, text] of await buildPlugin()) {
    const out = join(ROOT, "plugin", rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    console.log(`wrote plugin/${rel}`);
  }
}
