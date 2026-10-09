---
name: verify
description: Run danielsimonjr/verify (the veriharness CLI) through the verify MCP server. Use when the user wants to drive a task, batch-run cells, score or grade, probe a local Ollama or llama.cpp server or Claude Code, run the verifier on Claude Haiku or Sonnet, or read run ledgers and scores.
---

# verify

The `verify` MCP server wraps `veriharness`. Call tools in this order when you are unsure:

1. `verify_status` confirms the pinned binary, the data and runs directories, and whether `model-check` is in this build.
2. `verify_model_check` probes Ollama, llama.cpp or Claude Code before a long run. Provider `ollama` defaults to `http://127.0.0.1:11434`. Provider `llamacpp` (aliases `llama.cpp` and `llama-cpp`) defaults to `http://127.0.0.1:8080`. Both need a model name. Provider `claude-code` checks Claude Code and its login with a full model id: `claude-haiku-5-5` or `claude-sonnet-5-5`. When the server has a default model (`VERIFY_MCP_PROVIDER` and `VERIFY_MCP_MODEL`), `verify_model_check` and `verify_driver` use it if the call names no provider and no model. Load that model at the default context size first. A call that names a provider or a model ignores the default.
3. `verify_driver` runs one task workspace. The directory must contain `rollouts/`. For Claude Code, pass `provider: "claude-code"`, the full model id and `env: "none"`.
4. `verify_runner` batch-runs cells named `bench:pool` under a run name. Lanes are `fable`, `opus`, `haiku` and `sonnet`; the archived `flash` pools run on the `fable` lane. All four lanes run Claude Code and need `env: "none"`. Their default caps are 2 tasks at a time for `fable` and `opus` and 4 for `haiku` and `sonnet`; `lane_max` changes a cap.
   `roles` on `verify_driver` and `verify_runner` gives `checker`, `challenger`, `reviewer` or `fixer` its own `{provider, model}` (and `base_url`, `context_size` for a local role). A role left out uses the main model; a fixer left out follows the reviewer.
5. `verify_score` scores a cell directory. `verify_grade` grades one deliverables directory.
6. `verify_list_runs` and `verify_read_result` list runs and read fixed artifacts (`ledger_elim`, `ledger_fals`, `finish`, `repair`, `driver_log`, `run`, `scores`, `scores_partial`, `deliverables`). Deliverables are names and sizes only.

Benches are `apex`, `wsb`, `wb`, `sb2`, and `jb`. Omit optional flags so verify keeps its own defaults. Long tools emit progress and stop at their timeout. If the local model server is down, the tool error says so.
