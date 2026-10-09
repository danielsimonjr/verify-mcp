import { ENVS } from "./schemas.ts";

/** The environment variables that make up the default model profile. */
export const DEFAULT_PROFILE_KEYS = [
  "VERIFY_MCP_PROVIDER",
  "VERIFY_MCP_MODEL",
  "VERIFY_MCP_BASE_URL",
  "VERIFY_MCP_CONTEXT_SIZE",
  "VERIFY_MCP_ENV",
  "VERIFY_MCP_THINKING",
  "VERIFY_MCP_MAX_TOKENS",
  "VERIFY_MCP_REQUEST_TIMEOUT",
  "VERIFY_MCP_NUDGE_TIMEOUT",
] as const;

/** The input fields that the default profile can fill. */
export interface ProfileFields {
  provider?: string;
  model?: string;
  base_url?: string;
  context_size?: number | "auto";
  env?: (typeof ENVS)[number];
  thinking?: string;
  max_tokens?: number;
  request_timeout?: number;
  nudge_timeout?: number;
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positive(value: string | undefined): number | undefined {
  const raw = text(value);
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Fills the fields a call omits from the default profile in `env`.
 *
 * The profile applies only when the call names no provider and no model, and the profile itself
 * holds both. A call that names either one is returned unchanged, so a Claude Code call never
 * inherits an Ollama URL. `driver` adds the fields only `verify_driver` has: `VERIFY_MCP_ENV`,
 * `VERIFY_MCP_THINKING` and `VERIFY_MCP_NUDGE_TIMEOUT`. A context size or token count that is not a
 * positive integer is ignored. A timeout that is not a positive number is ignored. An env that is
 * not in `ENVS` is ignored.
 */
export function applyDefaultProfile<T extends ProfileFields>(
  input: T,
  env: NodeJS.ProcessEnv | undefined,
  driver: boolean,
): T {
  if (input.provider || input.model) return input;
  const provider = text(env?.VERIFY_MCP_PROVIDER);
  const model = text(env?.VERIFY_MCP_MODEL);
  if (!provider || !model) return input;
  const out: T = { ...input, provider, model };
  const baseUrl = text(env?.VERIFY_MCP_BASE_URL);
  if (out.base_url === undefined && baseUrl) out.base_url = baseUrl;
  const size = positive(env?.VERIFY_MCP_CONTEXT_SIZE);
  if (out.context_size === undefined && size !== undefined && Number.isInteger(size)) out.context_size = size;
  const tokens = positive(env?.VERIFY_MCP_MAX_TOKENS);
  if (out.max_tokens === undefined && tokens !== undefined && Number.isInteger(tokens)) out.max_tokens = tokens;
  const request = positive(env?.VERIFY_MCP_REQUEST_TIMEOUT);
  if (out.request_timeout === undefined && request !== undefined) out.request_timeout = request;
  if (!driver) return out;
  const exec = text(env?.VERIFY_MCP_ENV);
  if (out.env === undefined && exec && (ENVS as readonly string[]).includes(exec)) {
    out.env = exec as (typeof ENVS)[number];
  }
  const thinking = text(env?.VERIFY_MCP_THINKING);
  if (out.thinking === undefined && thinking) out.thinking = thinking;
  const nudge = positive(env?.VERIFY_MCP_NUDGE_TIMEOUT);
  if (out.nudge_timeout === undefined && nudge !== undefined) out.nudge_timeout = nudge;
  return out;
}
