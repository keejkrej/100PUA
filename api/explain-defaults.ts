/**
 * Defaults when provider env overrides are omitted.
 * Matches cache variant segments in explain-cache.ts.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';
export const DEFAULT_CURSOR_MODEL = 'composer-2';
export const DEFAULT_CODEX_MODEL = 'gpt-5.5';

export const DEFAULT_CODEX_WEB_SEARCH_MODE = 'live' as const;

/** Full sandbox: matches Codex CLI `SandboxMode`: danger-full-access. */
export const DEFAULT_CODEX_SANDBOX_MODE = 'danger-full-access' as const;

/** Headless: no approval prompts. */
export const DEFAULT_CODEX_APPROVAL_POLICY = 'never' as const;
