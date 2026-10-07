import { ENVS } from "./schemas.ts";

/** The environment variables that make up the default model profile. */
export const DEFAULT_PROFILE_KEYS = [
  "VERIFY_MCP_PROVIDER",
  "VERIFY_MCP_MODEL",
  "VERIFY_MCP_BASE_URL",
  "VERIFY_MCP_CONTEXT_SIZE",
  "VERIFY_MCP_ENV",
] as const;

/** The input fields that the default profile can fill. */
export interface ProfileFields {
  provider?: string;
  model?: string;
  base_url?: string;
  context_size?: number;
  env?: (typeof ENVS)[number];
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Fills the fields a call omits from the default profile in `env`.
 *
 * The profile applies only when the call names no provider and no model, and the profile itself
 * holds both. A call that names either one is returned unchanged, so a Claude Code call never
 * inherits an Ollama URL. `withEnv` adds `VERIFY_MCP_ENV` for a tool that has an `env` field. A
 * context size that is not a positive integer, and an env that is not in `ENVS`, are ignored.
 */
export function applyDefaultProfile<T extends ProfileFields>(
  input: T,
  env: NodeJS.ProcessEnv | undefined,
  withEnv: boolean,
): T {
  if (input.provider || input.model) return input;
  const provider = text(env?.VERIFY_MCP_PROVIDER);
  const model = text(env?.VERIFY_MCP_MODEL);
  if (!provider || !model) return input;
  const out: T = { ...input, provider, model };
  const baseUrl = text(env?.VERIFY_MCP_BASE_URL);
  if (out.base_url === undefined && baseUrl) out.base_url = baseUrl;
  const size = Number(text(env?.VERIFY_MCP_CONTEXT_SIZE));
  if (out.context_size === undefined && Number.isInteger(size) && size > 0) out.context_size = size;
  const exec = text(env?.VERIFY_MCP_ENV);
  if (withEnv && out.env === undefined && exec && (ENVS as readonly string[]).includes(exec)) {
    out.env = exec as (typeof ENVS)[number];
  }
  return out;
}
