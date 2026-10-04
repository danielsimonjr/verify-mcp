#!/usr/bin/env bun
/**
 * Stand-in for veriharness used by the protocol test. Not a real harness.
 */
const args = process.argv.slice(2);
const cmd = args[0];

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.error(`usage: veriharness <command> [args]

commands:
  driver        run one task workspace
  runner        batch-run cells
  score         score a cell
  materialize   build task workspaces from an archive
  grade         grade one deliverables directory
  env-derive    derive WorkBuddy images with the tool stack
  model-check   probe a local Ollama or llama.cpp server
`);
  process.exit(cmd ? 0 : 2);
}

if (cmd === "model-check") {
  if (process.env.FAKE_DOWN === "1") {
    console.error("error: Ollama is not reachable at http://127.0.0.1:11434");
    process.exit(1);
  }
  const provider = args[args.indexOf("--provider") + 1] ?? "";
  const model = args[args.indexOf("--model") + 1] ?? "";
  console.log(
    JSON.stringify(
      {
        provider,
        model,
        baseUrl: "http://127.0.0.1:11434",
        capabilities: { tools: true },
        models: [model],
        warnings: [],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(JSON.stringify({ command: cmd, args }));
process.exit(0);
