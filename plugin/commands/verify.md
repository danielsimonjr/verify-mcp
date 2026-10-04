---
description: Run a verify task or inspect a previous run with the verify MCP tools
---

Use the verify MCP server.

- Start with `verify_status` if the binary or the runs directory is unknown.
- Probe a local Ollama or llama.cpp server with `verify_model_check` before `verify_driver`.
- A task directory must contain `rollouts/`.
- Read results with `verify_list_runs` and `verify_read_result` instead of guessing file paths.
