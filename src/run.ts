const CAPTURE_LIMIT = 1024 * 1024;
const RETURN_LIMIT = 64 * 1024;

export interface RunRequest {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
}

class Tail {
  private chunks: string[] = [];
  private size = 0;

  push(text: string): void {
    if (!text) return;
    this.chunks.push(text);
    this.size += text.length;
    while (this.size > CAPTURE_LIMIT && this.chunks.length > 1) {
      const first = this.chunks.shift();
      if (first) this.size -= first.length;
    }
    const head = this.chunks[0];
    if (head && this.size > CAPTURE_LIMIT) {
      this.chunks[0] = head.slice(this.size - CAPTURE_LIMIT);
      this.size = CAPTURE_LIMIT;
    }
  }

  text(): string {
    return this.chunks.join("").slice(-RETURN_LIMIT);
  }
}

async function pump(
  stream: ReadableStream<Uint8Array> | null | undefined,
  tail: Tail,
  onLine?: (line: string) => void,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const feed = (text: string) => {
    tail.push(text);
    if (!onLine || !text) return;
    pending += text;
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      if (line.trim()) onLine(line);
      newline = pending.indexOf("\n");
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
  feed(decoder.decode());
  if (pending.trim() && onLine) onLine(pending);
}

/**
 * Every descendant of `root`, from one `ps` snapshot. POSIX only.
 *
 * A group signal is not enough: the pinned driver runs each agent turn as a detached child, which
 * leads its own process group, so `kill(-pid)` never reaches it and the turn runs on after a
 * timeout. Take the snapshot before the first signal, while the parent links still exist; a child
 * whose parent has died is re-parented and can no longer be found from the root.
 */
function descendants(root: number): number[] {
  const ps = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="], { stdout: "pipe", stderr: "ignore" });
  if (ps.exitCode !== 0) return [];
  const children = new Map<number, number[]>();
  for (const line of ps.stdout.toString().split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined || Number.isNaN(ppid)) continue;
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }
  const out: number[] = [];
  const stack = [root];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

/** Signals `pid`, its group and each pid in `tree`, including descendants in groups of their own. */
function signalTree(pid: number, tree: number[], signal: NodeJS.Signals): void {
  for (const target of [pid, ...tree]) {
    for (const id of [-target, target]) {
      try {
        process.kill(id, signal);
      } catch {
        /* not a group leader, or already exited */
      }
    }
  }
}

/**
 * Windows has no process groups: `process.kill(-pid)` throws and `process.kill(pid)` ends the
 * direct child only. A detached grandchild has left the parent's job object, so it survives that.
 * `taskkill /T` walks the parent links instead, and /F is needed because a console process
 * ignores the close request a plain taskkill sends.
 */
function killTreeWindows(pid: number): void {
  Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
}

export async function runProcess(req: RunRequest): Promise<RunResult> {
  const started = Date.now();
  let timedOut = false;
  let aborted = false;
  const proc = Bun.spawn([req.command, ...req.args], {
    cwd: req.cwd,
    env: req.env,
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const stdout = new Tail();
  const stderr = new Tail();
  const readers = Promise.all([pump(proc.stdout, stdout, req.onLine), pump(proc.stderr, stderr, req.onLine)]);

  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = (why: "timeout" | "abort") => {
    if (timedOut || aborted) return;
    if (why === "timeout") timedOut = true;
    else aborted = true;
    if (process.platform === "win32") {
      killTreeWindows(proc.pid);
      return;
    }
    const tree = descendants(proc.pid);
    signalTree(proc.pid, tree, "SIGTERM");
    killTimer = setTimeout(() => signalTree(proc.pid, tree, "SIGKILL"), 2000);
    killTimer.unref?.();
  };

  const timer = setTimeout(() => stop("timeout"), req.timeoutMs);
  const onAbort = () => stop("abort");
  if (req.signal) {
    if (req.signal.aborted) stop("abort");
    else req.signal.addEventListener("abort", onAbort, { once: true });
  }

  let code: number | null = null;
  try {
    const [exited] = await Promise.all([proc.exited, readers]);
    code = exited;
  } finally {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    req.signal?.removeEventListener("abort", onAbort);
  }

  return {
    code,
    stdout: stdout.text(),
    stderr: stderr.text(),
    timedOut,
    aborted,
    durationMs: Date.now() - started,
  };
}

/** Parse a JSON document, or the last JSON object in mixed logs (score --json). */
export function extractJson(stdout: string): unknown | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* mixed logs */
  }
  const breakAt = trimmed.lastIndexOf("\n{");
  const start = breakAt === -1 ? trimmed.indexOf("{") : breakAt + 1;
  if (start === -1) return undefined;
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return undefined;
  }
}
