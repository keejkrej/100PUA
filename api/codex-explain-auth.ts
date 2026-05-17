/**
 * Codex explain auth — mirrors @openai/codex-sdk `CodexOptions`: `apiKey` and/or `env`
 * for the spawned `codex exec` CLI. See https://github.com/openai/codex/tree/main/sdk/typescript
 */
import fs from 'node:fs';
import path from 'node:path';

export function codexApiKeyFromEnv(): string {
  return (
    (process.env.CODEX_API_KEY ?? '').trim() ||
    (process.env.OPENAI_API_KEY ?? '').trim()
  );
}

export function codexChatgptAuthHome(): string {
  return (process.env.CODEX_HOME ?? '').trim();
}

/** ChatGPT sign-in session: `CODEX_HOME/auth.json` from `codex login`. */
export function hasCodexChatgptExplainAuth(): boolean {
  const home = codexChatgptAuthHome();
  if (home.length === 0) return false;
  try {
    fs.accessSync(path.join(home, 'auth.json'));
    return true;
  } catch {
    return false;
  }
}

export function hasCodexExplainCredential(): boolean {
  return Boolean(codexApiKeyFromEnv()) || hasCodexChatgptExplainAuth();
}

export type CodexExplainAuthMode = 'api_key' | 'chatgpt';

export function resolveCodexExplainAuthMode():
  | { mode: 'api_key'; apiKey: string }
  | { mode: 'chatgpt' }
  | { error: string } {
  const raw = (process.env.CODEX_EXPLAIN_AUTH ?? '').trim().toLowerCase();
  const apiKey = codexApiKeyFromEnv();

  const oauth = hasCodexChatgptExplainAuth();

  if (raw === 'chatgpt' || raw === 'oauth') {
    if (!oauth) {
      return {
        error:
          'CODEX_EXPLAIN_AUTH=chatgpt requires CODEX_HOME with auth.json from `codex login`.',
      };
    }
    return { mode: 'chatgpt' };
  }
  if (raw === 'api_key' || raw === 'apikey' || raw === 'key' || raw === 'openai') {
    if (!apiKey) {
      return {
        error:
          'CODEX_EXPLAIN_AUTH=api_key requires CODEX_API_KEY or OPENAI_API_KEY.',
      };
    }
    return { mode: 'api_key', apiKey };
  }
  if (raw !== '' && raw !== 'auto') {
    return {
      error: 'CODEX_EXPLAIN_AUTH must be empty (auto), api_key, or chatgpt.',
    };
  }
  if (apiKey) return { mode: 'api_key', apiKey };
  if (oauth) return { mode: 'chatgpt' };
  return {
    error:
      'Set OPENAI_API_KEY or CODEX_API_KEY, or ChatGPT OAuth (CODEX_HOME + auth.json).',
  };
}

/** Cache partition: API-key vs ChatGPT sessions can differ for the same model flags. */
export function codexExplainAuthCacheSegment(): string {
  const r = resolveCodexExplainAuthMode();
  return 'error' in r ? 'none' : r.mode;
}
