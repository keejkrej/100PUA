import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { Agent, CursorAgentError } from '@cursor/sdk';
import { Codex } from '@openai/codex-sdk';

import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_APPROVAL_POLICY,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_SANDBOX_MODE,
  DEFAULT_CODEX_WEB_SEARCH_MODE,
  DEFAULT_CURSOR_MODEL,
} from './explain-defaults.js';
import {
  codexChatgptAuthHome,
  hasCodexExplainCredential,
  resolveCodexExplainAuthMode,
} from './codex-explain-auth.js';
import type { ExplainProviderKind } from './explain-cache.js';

export type PromptRow = {
  topicTitle?: string;
  title?: string;
  chatQuery?: string;
};

export type PromptIndex = Record<string, Record<string, PromptRow>>;

export type ExplainRunOk = { ok: true; text: string };
export type ExplainRunErr = { ok: false; error: string };
export type ExplainRunResult = ExplainRunOk | ExplainRunErr;

export const DEFAULT_EXPLAIN_AGENT_TIMEOUT_MS = 240_000;

export function explainAgentTimeoutMs(): number {
  return Number.isFinite(Number(process.env.CLAUDE_EXPLAIN_TIMEOUT_MS))
    ? Math.max(45_000, Number(process.env.CLAUDE_EXPLAIN_TIMEOUT_MS))
    : DEFAULT_EXPLAIN_AGENT_TIMEOUT_MS;
}

export function loadPromptIndex(apiRoot: string): PromptIndex | null {
  try {
    const fp = path.join(apiRoot, 'data', 'prompt-index.json');
    const raw = fs.readFileSync(fp, 'utf8');
    const j: unknown = JSON.parse(raw);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    return j as PromptIndex;
  } catch {
    console.warn(
      '[explain-prompt] missing data/prompt-index.json - run `npm run build` in ./api',
    );
    return null;
  }
}

export function explainContentKey(chatQuery: string): string {
  return crypto
    .createHash('sha256')
    .update(chatQuery.trim(), 'utf8')
    .digest('hex');
}

export function explainAgentConfigured(provider: ExplainProviderKind): boolean {
  if (provider === 'cursor') return hasCursorApiKey();
  if (provider === 'codex') {
    if (!hasCodexExplainCredential()) return false;
    const r = resolveCodexExplainAuthMode();
    return !('error' in r);
  }
  return hasClaudeCredential();
}

export function explainAgentMisconfiguredMessage(
  provider: ExplainProviderKind,
): string {
  if (provider === 'cursor') {
    return 'Set CURSOR_API_KEY on the API service.';
  }
  if (provider === 'codex') {
    if (!hasCodexExplainCredential()) {
      return 'Set OPENAI_API_KEY or CODEX_API_KEY, or ChatGPT OAuth (CODEX_HOME with auth.json); see api/.env.example.';
    }
    const r = resolveCodexExplainAuthMode();
    if ('error' in r) return r.error;
    return 'Codex auth is misconfigured.';
  }
  return 'Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY on the API service.';
}

export function buildFullExplainPrompt(
  provider: ExplainProviderKind,
  row: PromptRow,
): string {
  const chatQuery = typeof row.chatQuery === 'string' ? row.chatQuery.trim() : '';
  const topicLine = typeof row.topicTitle === 'string' ? row.topicTitle : '';
  const rowTitle = typeof row.title === 'string' ? row.title : '';
  const preamble = buildExplainPreambleLines(provider).join('\n');

  return (
    `${preamble}\n\n---\nTopic: ${topicLine}\nPrompt title: ${rowTitle}\n\n` +
    `--- Student-facing study prompt ---\n\n${chatQuery}`
  );
}

export async function runExplanation(
  provider: ExplainProviderKind,
  fullPromptText: string,
  abortController: AbortController,
): Promise<ExplainRunResult> {
  if (provider === 'cursor')
    return runCursorExplanation(fullPromptText, abortController);
  if (provider === 'codex')
    return runCodexExplanation(fullPromptText, abortController);
  return runClaudeExplanation(fullPromptText, abortController);
}

function hasClaudeCredential(): boolean {
  const o = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '').trim();
  const k = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  return Boolean(o || k);
}

function hasCursorApiKey(): boolean {
  return Boolean((process.env.CURSOR_API_KEY ?? '').trim());
}

function buildExplainPreambleLines(provider: ExplainProviderKind): string[] {
  const common = [
    `You help students digest topic-aligned study prompts (the same text they might paste into ChatGPT).`,
    ``,
    `- Reply in Markdown. Prefer clarity over length (about 500-900 words unless the question is narrow).`,
    `- Use short sections, bullets, and concrete examples when helpful.`,
    `- Do not claim you watched a video or opened a specific URL; infer from the pasted prompt and any links in it only.`,
  ];
  if (provider === 'claude') {
    return [
      ...common,
      `- You have the full Claude Code toolset (WebSearch, WebFetch, Bash, etc.). Use tools freely when they improve accuracy or add useful detail; do not hold back merely to minimize tool use.`,
      `- If you relied on external sources from tools, cite them briefly where it builds trust.`,
    ];
  }
  if (provider === 'codex') {
    return [
      ...common,
      `- Use every capability the Codex agent exposes (filesystem, terminal, MCP, web search, etc.) when it helps - you are not restricted to quoting the pasted prompt alone.`,
      `- When facts need grounding, use web search and other tools proactively; cite concise sources where helpful.`,
    ];
  }
  return [
    ...common,
    `- Use everything the Cursor agent can do (browse, fetch, run commands, MCP, etc.) when it strengthens the answer; don't default to the pasted text only.`,
    `- When facts need grounding, use available tools proactively; cite concise sources where helpful.`,
  ];
}

async function runClaudeExplanation(
  fullPromptText: string,
  abortController: AbortController,
): Promise<ExplainRunResult> {
  const sessionHome = await fsp.mkdtemp(path.join(os.tmpdir(), '100pua-cc-'));
  let qIter: Query | null = null;
  try {
    qIter = query({
      prompt: fullPromptText,
      options: {
        cwd: sessionHome,
        env: {
          ...process.env,
          HOME: sessionHome,
          CLAUDE_AGENT_SDK_CLIENT_APP: '100pua-api/1.0',
        },
        abortController,
        tools: { type: 'preset', preset: 'claude_code' },
        maxTurns: 32,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        model:
          (process.env.CLAUDE_MODEL ?? '').trim() || DEFAULT_CLAUDE_MODEL,
      },
    });

    let finalText: string | undefined;
    const errLines: string[] = [];
    try {
      for await (const msg of qIter) {
        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            if (typeof msg.result === 'string' && msg.result.trim())
              finalText = msg.result;
          } else {
            errLines.push(...(msg.errors ?? []));
          }
        }
      }
    } finally {
      if (qIter) qIter.close();
    }

    if (finalText) return { ok: true, text: finalText };
    return {
      ok: false,
      error:
        errLines.length > 0 ? errLines.join('; ') : 'agent_finished_without_result',
    };
  } catch (e: unknown) {
    const name =
      e && typeof e === 'object' && 'name' in e
        ? String((e as Error).name)
        : '';
    if (name === 'AbortError')
      return { ok: false, error: 'timeout_or_aborted' };
    console.error('[explain-prompt]', e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'claude_sdk_error',
    };
  } finally {
    await fsp.rm(sessionHome, { recursive: true, force: true }).catch(() => {});
  }
}

async function runCursorExplanation(
  fullPromptText: string,
  abortController: AbortController,
): Promise<ExplainRunResult> {
  const apiKey = (process.env.CURSOR_API_KEY ?? '').trim();
  if (!apiKey) return { ok: false, error: 'missing_cursor_api_key' };

  const modelId =
    (process.env.CURSOR_MODEL ?? '').trim() || DEFAULT_CURSOR_MODEL;

  const sessionHome = await fsp.mkdtemp(path.join(os.tmpdir(), '100pua-cursor-'));

  try {
    const agent = await Agent.create({
      apiKey,
      model: { id: modelId },
      name: '100pua-explain-prompt',
      local: {
        cwd: sessionHome,
        settingSources: [],
        sandboxOptions: { enabled: false },
      },
    });
    try {
      const run = await agent.send(fullPromptText);

      const onAbort = (): void => {
        if (run.supports('cancel')) void run.cancel().catch(() => {});
      };
      abortController.signal.addEventListener('abort', onAbort, {
        once: true,
      });

      let result;
      try {
        if (abortController.signal.aborted) {
          onAbort();
          return { ok: false, error: 'timeout_or_aborted' };
        }
        result = await run.wait();
      } finally {
        abortController.signal.removeEventListener('abort', onAbort);
      }

      if (abortController.signal.aborted || result.status === 'cancelled') {
        return { ok: false, error: 'timeout_or_aborted' };
      }
      if (result.status === 'error') {
        const msg =
          typeof result.result === 'string' && result.result.trim()
            ? result.result.trim()
            : 'cursor_run_failed';
        return { ok: false, error: msg };
      }

      const finalText =
        typeof result.result === 'string' ? result.result.trim() : '';
      if (finalText) return { ok: true, text: finalText };
      return { ok: false, error: 'agent_finished_without_result' };
    } finally {
      await agent[Symbol.asyncDispose]().catch(() => {});
    }
  } catch (e: unknown) {
    if (e instanceof CursorAgentError)
      console.error('[explain-prompt]', e.message);
    else console.error('[explain-prompt]', e);

    const name =
      e && typeof e === 'object' && 'name' in e
        ? String((e as Error).name)
        : '';
    if (name === 'AbortError')
      return { ok: false, error: 'timeout_or_aborted' };

    const msg = e instanceof Error ? e.message : 'cursor_sdk_error';
    return { ok: false, error: msg };
  } finally {
    await fsp.rm(sessionHome, { recursive: true, force: true }).catch(() => {});
  }
}

type CodexSandboxSetting = 'read-only' | 'workspace-write' | 'danger-full-access';

function codexSandboxMode(): CodexSandboxSetting {
  const raw = (process.env.CODEX_SANDBOX_MODE ?? '').trim().toLowerCase();
  if (raw === '') return DEFAULT_CODEX_SANDBOX_MODE;
  if (raw === 'workspace-write' || raw === 'workspace_write')
    return 'workspace-write';
  if (raw === 'danger-full-access' || raw === 'danger_full_access')
    return 'danger-full-access';
  if (raw === 'read-only' || raw === 'read_only') return 'read-only';
  return DEFAULT_CODEX_SANDBOX_MODE;
}

function codexWebSearchModeSetting(): 'disabled' | 'cached' | 'live' {
  const raw = (process.env.CODEX_WEB_SEARCH_MODE ?? '').trim().toLowerCase();
  if (raw === 'disabled' || raw === 'cached') return raw;
  if (raw === 'live') return 'live';
  return DEFAULT_CODEX_WEB_SEARCH_MODE;
}

type CodexApprovalSetting =
  | 'never'
  | 'on-request'
  | 'on-failure'
  | 'untrusted';

function codexApprovalPolicy(): CodexApprovalSetting {
  const v = (process.env.CODEX_APPROVAL_POLICY ?? '').trim().toLowerCase();
  if (v === '') return DEFAULT_CODEX_APPROVAL_POLICY;
  if (v === 'on-request' || v === 'on_request') return 'on-request';
  if (v === 'on-failure' || v === 'on_failure') return 'on-failure';
  if (v === 'untrusted') return 'untrusted';
  if (v === 'never') return 'never';
  return DEFAULT_CODEX_APPROVAL_POLICY;
}

async function ensureCodexChatgptAuthHome(): Promise<string | null> {
  const codexHome = codexChatgptAuthHome();
  if (!codexHome) return null;

  const authPath = path.join(codexHome, 'auth.json');
  try {
    await fsp.access(authPath);
    return codexHome;
  } catch {
    return null;
  }
}

async function runCodexExplanation(
  fullPromptText: string,
  abortController: AbortController,
): Promise<ExplainRunResult> {
  const auth = resolveCodexExplainAuthMode();
  if ('error' in auth) return { ok: false, error: auth.error };

  const sessionHome = await fsp.mkdtemp(path.join(os.tmpdir(), '100pua-codex-'));
  const webSearch = codexWebSearchModeSetting();

  try {
    const codexModel =
      (process.env.CODEX_MODEL ?? '').trim() || DEFAULT_CODEX_MODEL;

    let codex: Codex;
    if (auth.mode === 'api_key') {
      codex = new Codex({ apiKey: auth.apiKey });
    } else {
      const codexHome = await ensureCodexChatgptAuthHome();
      if (!codexHome) return { ok: false, error: 'missing_codex_chatgpt_auth' };

      const childEnv: Record<string, string> = {};
      for (const [key, val] of Object.entries(process.env)) {
        if (val === undefined) continue;
        if (key === 'OPENAI_API_KEY' || key === 'CODEX_API_KEY') continue;
        childEnv[key] = val;
      }
      childEnv.CODEX_HOME = codexHome;

      codex = new Codex({ env: childEnv });
    }

    const thread = codex.startThread({
      workingDirectory: sessionHome,
      skipGitRepoCheck: true,
      sandboxMode: codexSandboxMode(),
      model: codexModel,
      webSearchMode: webSearch,
      approvalPolicy: codexApprovalPolicy(),
      networkAccessEnabled: true,
    });
    const turn = await thread.run(fullPromptText, {
      signal: abortController.signal,
    });
    const text = turn.finalResponse?.trim();
    if (text) return { ok: true, text };
    return { ok: false, error: 'agent_finished_without_result' };
  } catch (e: unknown) {
    const name =
      e && typeof e === 'object' && 'name' in e
        ? String((e as Error).name)
        : '';
    if (name === 'AbortError' || abortController.signal.aborted)
      return { ok: false, error: 'timeout_or_aborted' };
    console.error('[explain-prompt]', e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'codex_sdk_error',
    };
  } finally {
    await fsp.rm(sessionHome, { recursive: true, force: true }).catch(() => {});
  }
}
