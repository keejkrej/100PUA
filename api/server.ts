/**
 * API for 100PUA · Render Web Service (Hono)
 *
 * Env:
 *   GITHUB_TOKEN             — PAT / fine-grained with issues write (required for POST /suggestions)
 *   POST /suggestions rejects thin topic payloads with 400 `weak_topic_suggestion` (see validateAndBuild).
 *   GITHUB_REPO              — owner/repo (default: keejkrej/100PUA)
 *   PORT                     — injected by Render
 *   ALLOWED_ORIGINS          — comma-separated origins or "*" (default "*")
 *   SUGGEST_RATE_LIMIT       — max /suggestions per IP per window (default 20)
 *   SUGGEST_RATE_WINDOW_MS   — window ms (default 900000)
 *
 * POST /explain-prompt (after `npm run build` → data/prompt-index.json):
 *   EXPLAIN_AI_PROVIDER     — `codex` (default), `claude`, or `cursor` — backend for explains
 *
 * Claude (Anthropic Claude Agent SDK) when provider is `claude`:
 *   CLAUDE_CODE_OAUTH_TOKEN  — from `claude setup-token` (subscription OAuth); or
 *   ANTHROPIC_API_KEY        — Console API key
 *
 * Cursor (@cursor/sdk) when provider is `cursor`:
 *   CURSOR_API_KEY           — Cursor API key (dashboard or service account)
 *   CURSOR_MODEL             — optional; default composer-2; use `auto` for server-selected model
 *
 * Codex (@openai/codex-sdk) when provider is `codex` — https://developers.openai.com/codex/sdk
 *   Auth (see https://github.com/openai/codex/tree/main/sdk/typescript — `apiKey` and `env`):
 *   OPENAI_API_KEY or CODEX_API_KEY — API usage; SDK sets CODEX_API_KEY on the CLI process when using api_key mode
 *   ChatGPT (OAuth) — set CODEX_EXPLAIN_AUTH=chatgpt or rely on auto when no API key is set:
 *     CODEX_HOME — directory containing auth.json (from `codex login` / CI flow; CLI uses CODEX_HOME for auth)
 *     CODEX_CHATGPT_AUTH_JSON — optional full auth.json body (e.g. Render secret); written to a temp CODEX_HOME per request
 *   When using ChatGPT auth, OPENAI_API_KEY and CODEX_API_KEY are omitted from the CLI env so they do not override OAuth.
 *   CODEX_EXPLAIN_AUTH          — optional: auto (default) | api_key | chatgpt
 *   CODEX_MODEL              — optional; default gpt-5.5
 *   CODEX_WEB_SEARCH_MODE    — optional: disabled | cached | live (default live)
 *   CODEX_SANDBOX_MODE       — optional: read-only | workspace-write | danger-full-access (default danger-full-access)
 *   CODEX_APPROVAL_POLICY    — optional: never | on-request | on-failure | untrusted (default never)
 *
 * POST /explain-prompt JSON body:
 *   slug, promptId          — required
 *   provider                — optional: `claude` | `cursor` | `codex` (default: EXPLAIN_AI_PROVIDER env)
 *
 * Shared explain settings:
 *   EXPLAIN_RATE_LIMIT       — default 12
 *   EXPLAIN_RATE_WINDOW_MS   — default 900000
 *   CLAUDE_EXPLAIN_TIMEOUT_MS — default 240000 (bounds wait for all providers)
 *   CLAUDE_MODEL             — optional; overrides default claude-haiku-4-5 (Claude backend only)
 *   EXPLAIN_CACHE_DAYS       — file cache TTL days (default 7; empty env = default; 0 disables)
 *   EXPLAIN_CACHE_DIR        — optional absolute path for cache JSON (default: ./cache/explain under api/)
 *   EXPLAIN_CACHE_DISABLED   — true/1 turns off caching entirely
 *   EXPLAIN_CACHE_DEBUG      — 1 logs cache directory, HIT/MISS, write failures
 *   EXPLAIN_KV_URL           — optional Render Key Value / Redis-compatible URL for hot cache tier
 *   EXPLAIN_KV_CACHE_SECONDS — optional KV TTL seconds (default 86400; 0 disables KV tier)
 *   EXPLAIN_KV_PREFIX        — optional KV key prefix (default 100pua)
 *
 * Successful POST /explain-prompt sets X-Explain-Cache and X-Explain-Provider (CORS-exposed).
 *
 * Explain agent backends (maximal tool / permission posture for headless API):
 *   - Claude: `tools.preset === 'claude_code'`, bypassPermissions + allowDangerouslySkipPermissions, cwd tmp.
 *   - Cursor: local agent, sandbox disabled on the SDK path, default model composer-2.
 *   - Codex: default sandbox danger-full-access, web search live, approval never, default model gpt-5.5;
 *     API key or ChatGPT OAuth via CodexOptions (`apiKey` vs custom `env` + CODEX_HOME) per sdk/typescript.
 */

import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Agent, CursorAgentError } from '@cursor/sdk';
import { Codex } from '@openai/codex-sdk';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  createExplainCache,
  explainCacheActive,
  explainProviderFromEnv,
  buildExplainVariantCacheKey,
  type ExplainProviderKind,
} from './explain-cache.js';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CURSOR_MODEL,
  DEFAULT_CODEX_APPROVAL_POLICY,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_SANDBOX_MODE,
  DEFAULT_CODEX_WEB_SEARCH_MODE,
} from './explain-defaults.js';
import {
  hasCodexExplainCredential,
  resolveCodexExplainAuthMode,
} from './codex-explain-auth.js';

const PORT = Number(process.env.PORT) || 8787;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO_RAW = (process.env.GITHUB_REPO || 'keejkrej/100PUA').trim();
const ALLOWED_ORIGINS_RAW = (process.env.ALLOWED_ORIGINS ?? '*').trim();
const RATE_LIMIT = Number.isFinite(Number(process.env.SUGGEST_RATE_LIMIT))
  ? Math.max(5, Number(process.env.SUGGEST_RATE_LIMIT))
  : 20;
const RATE_WINDOW_MS = Number.isFinite(
  Number(process.env.SUGGEST_RATE_WINDOW_MS),
)
  ? Math.max(60_000, Number(process.env.SUGGEST_RATE_WINDOW_MS))
  : 15 * 60 * 1000;

const __dirnamePath = path.dirname(fileURLToPath(import.meta.url));
/** Dist lives in `./dist`; repo data/cache stay alongside the api package root. */
const API_ROOT =
  path.basename(__dirnamePath) === 'dist'
    ? path.resolve(__dirnamePath, '..')
    : __dirnamePath;

const EXPLAIN_RATE_LIMIT = Number.isFinite(Number(process.env.EXPLAIN_RATE_LIMIT))
  ? Math.max(3, Number(process.env.EXPLAIN_RATE_LIMIT))
  : 12;
const EXPLAIN_RATE_WINDOW_MS = Number.isFinite(
  Number(process.env.EXPLAIN_RATE_WINDOW_MS),
)
  ? Math.max(60_000, Number(process.env.EXPLAIN_RATE_WINDOW_MS))
  : 15 * 60 * 1000;

const explainRateBuckets = new Map<string, number[]>();

const MAX_EXPLAIN_JSON_BYTES = 16_384;
const EXPLAIN_AGENT_TIMEOUT_MS = Number.isFinite(
  Number(process.env.CLAUDE_EXPLAIN_TIMEOUT_MS),
)
  ? Math.max(45_000, Number(process.env.CLAUDE_EXPLAIN_TIMEOUT_MS))
  : 240_000;

const MAX_JSON_BYTES = 48_576;
const LEN = {
  topicTitle: 120,
  topicNotes: 4000,
  pretitle: 200,
  promptBody: 4000,
  topicTitleCtx: 500,
  topicSlug: 200,
} as const;

/** Reject one-word / toy titles that still pass maxlength checks. */
const TOPIC_TITLE_MIN = 6;
/** Short titles must carry context in notes so issues are actionable. */
const TOPIC_TITLE_DETAIL_THRESHOLD = 20;
const TOPIC_NOTES_MIN_WHEN_TITLE_SHORT = 20;

const TOPIC_TITLE_BLOCKLIST = new Set([
  'asdf',
  'bar',
  'blah',
  'demo',
  'foo',
  'hello',
  'hey',
  'hi',
  'lol',
  'lorem',
  'none',
  'ping',
  'pong',
  'qwerty',
  'temp',
  'temporary',
  'test',
  'testing',
  'tmp',
  'todo',
  'xxx',
]);

function normalizeTopicTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isWeakTopicSuggestion(title: string, notes: string): boolean {
  const tit = title.trim();
  const bod = notes.trim();
  if (tit.length < TOPIC_TITLE_MIN) return true;
  if (tit.length > LEN.topicTitle) return true;
  const key = normalizeTopicTitleKey(tit);
  if (TOPIC_TITLE_BLOCKLIST.has(key)) return true;
  if (/^(.)\1{3,}$/.test(key)) return true;
  if (tit.length < TOPIC_TITLE_DETAIL_THRESHOLD && bod.length < TOPIC_NOTES_MIN_WHEN_TITLE_SHORT)
    return true;
  return false;
}

const rateBuckets = new Map<string, number[]>();

function parseRepo(
  slug: string,
): { owner: string; repo: string } | null {
  const parts = slug.split('/').filter(Boolean);
  if (parts.length !== 2 || slug.includes('..')) return null;
  const [owner, repo] = parts;
  if (
    !/^[-\w.\u00AA-\uFFA0]+$/.test(owner) ||
    !/^[-_\w.\u00AA-\uFFA0]+$/.test(repo)
  )
    return null;
  return { owner, repo };
}

function clientIp(xForwardedFor: string | undefined): string {
  if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
    const first = xForwardedFor.split(',')[0];
    return first ? first.trim() : 'unknown';
  }
  return 'unknown';
}

function allowRate(ip: string): boolean {
  const now = Date.now();
  const prev = rateBuckets.get(ip) ?? [];
  const next = prev.filter((t) => now - t < RATE_WINDOW_MS);
  if (next.length >= RATE_LIMIT) return false;
  next.push(now);
  rateBuckets.set(ip, next);
  return true;
}

function allowExplainRate(ip: string): boolean {
  const now = Date.now();
  const prev = explainRateBuckets.get(ip) ?? [];
  const next = prev.filter((t) => now - t < EXPLAIN_RATE_WINDOW_MS);
  if (next.length >= EXPLAIN_RATE_LIMIT) return false;
  next.push(now);
  explainRateBuckets.set(ip, next);
  return true;
}

const CORS_WILDCARD =
  ALLOWED_ORIGINS_RAW === '*' || ALLOWED_ORIGINS_RAW === '';
const CORS_ALLOWED_LIST = CORS_WILDCARD
  ? []
  : ALLOWED_ORIGINS_RAW.split(',').map((s) => s.trim()).filter(Boolean);

const CURSOR_TRIGGER_COMMENT =
  '@cursoragent please investigate this issue and open a PR with a fix when appropriate.';

function originAllowed(originHeader: string | undefined): boolean {
  if (CORS_WILDCARD) return true;
  const o = originHeader || '';
  if (!o) return true;
  return CORS_ALLOWED_LIST.includes(o);
}

function hasClaudeCredential(): boolean {
  const o = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '').trim();
  const k = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  return Boolean(o || k);
}

function hasCursorApiKey(): boolean {
  return Boolean((process.env.CURSOR_API_KEY ?? '').trim());
}

function explainAgentConfigured(provider: ExplainProviderKind): boolean {
  if (provider === 'cursor') return hasCursorApiKey();
  if (provider === 'codex') {
    if (!hasCodexExplainCredential()) return false;
    const r = resolveCodexExplainAuthMode();
    return !('error' in r);
  }
  return hasClaudeCredential();
}

function explainAgentMisconfiguredMessage(provider: ExplainProviderKind): string {
  if (provider === 'cursor') {
    return 'Set CURSOR_API_KEY on the API service.';
  }
  if (provider === 'codex') {
    if (!hasCodexExplainCredential()) {
      return 'Set OPENAI_API_KEY or CODEX_API_KEY, or ChatGPT OAuth (CODEX_HOME with auth.json or CODEX_CHATGPT_AUTH_JSON); see api/.env.example.';
    }
    const r = resolveCodexExplainAuthMode();
    if ('error' in r) return r.error;
    return 'Codex auth is misconfigured.';
  }
  return 'Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY on the API service.';
}

function buildExplainPreambleLines(provider: ExplainProviderKind): string[] {
  const common = [
    `You help students digest lecture-aligned study prompts (the same text they might paste into ChatGPT).`,
    ``,
    `- Reply in Markdown. Prefer clarity over length (about 500–900 words unless the question is narrow).`,
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
      `- Use every capability the Codex agent exposes (filesystem, terminal, MCP, web search, etc.) when it helps—you are not restricted to quoting the pasted prompt alone.`,
      `- When facts need grounding, use web search and other tools proactively; cite concise sources where helpful.`,
    ];
  }
  return [
    ...common,
    `- Use everything the Cursor agent can do (browse, fetch, run commands, MCP, etc.) when it strengthens the answer; don't default to the pasted text only.`,
    `- When facts need grounding, use available tools proactively; cite concise sources where helpful.`,
  ];
}

/** `null`: omit field → caller uses env default. `false`: invalid payload. */
function coerceExplainBodyProvider(raw: unknown): ExplainProviderKind | null | false {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (s === '') return null;
  const l = s.toLowerCase();
  if (l === 'claude' || l === 'cursor' || l === 'codex') return l;
  return false;
}

type PromptRow = {
  topicTitle?: string;
  title?: string;
  chatQuery?: string;
};

type PromptIndex = Record<string, Record<string, PromptRow>>;

function loadPromptIndex(): PromptIndex | null {
  try {
    const fp = path.join(API_ROOT, 'data', 'prompt-index.json');
    const raw = fs.readFileSync(fp, 'utf8');
    const j: unknown = JSON.parse(raw);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    return j as PromptIndex;
  } catch {
    console.warn(
      '[explain-prompt] missing data/prompt-index.json — run `npm run build` in ./api',
    );
    return null;
  }
}

function mergeAbortControllers(
  ...signals: (AbortSignal | null | undefined)[]
): AbortController {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ctrl.abort();
      break;
    }
    s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl;
}

type ExplainRunOk = { ok: true; text: string };
type ExplainRunErr = { ok: false; error: string };
type ExplainRunResult = ExplainRunOk | ExplainRunErr;

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

    const msg =
      e instanceof Error ? e.message : 'cursor_sdk_error';
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

async function runCodexExplanation(
  fullPromptText: string,
  abortController: AbortController,
): Promise<ExplainRunResult> {
  const auth = resolveCodexExplainAuthMode();
  if ('error' in auth) return { ok: false, error: auth.error };

  const sessionHome = await fsp.mkdtemp(path.join(os.tmpdir(), '100pua-codex-'));
  const webSearch = codexWebSearchModeSetting();
  let oauthHomeDisposable: string | null = null;

  try {
    const codexModel =
      (process.env.CODEX_MODEL ?? '').trim() || DEFAULT_CODEX_MODEL;

    let codex: Codex;
    if (auth.mode === 'api_key') {
      codex = new Codex({ apiKey: auth.apiKey });
    } else {
      let codexHome: string;
      const inlineAuth = (process.env.CODEX_CHATGPT_AUTH_JSON ?? '').trim();
      if (inlineAuth.length > 0) {
        oauthHomeDisposable = await fsp.mkdtemp(
          path.join(os.tmpdir(), '100pua-codex-oauth-'),
        );
        codexHome = oauthHomeDisposable;
        await fsp.writeFile(
          path.join(codexHome, 'auth.json'),
          inlineAuth,
          'utf8',
        );
      } else {
        codexHome = (process.env.CODEX_HOME ?? '').trim();
        if (!codexHome) return { ok: false, error: 'missing_codex_chatgpt_auth' };
      }

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
    if (oauthHomeDisposable) {
      await fsp
        .rm(oauthHomeDisposable, { recursive: true, force: true })
        .catch(() => {});
    }
  }
}

const PROMPT_INDEX = loadPromptIndex();

type SuggestionPayload = Record<string, unknown>;

type SuggestionBuildResult =
  | { ok: true; title: string; body: string; pingCursorAgent: boolean }
  | { ok: false; error: 'invalid_payload' | 'weak_topic_suggestion' };

function validateAndBuild(payload: SuggestionPayload): SuggestionBuildResult {
  const mode = payload?.mode;
  const footerRepo = `https://github.com/${GITHUB_REPO_RAW}`;
  const footer = `\n\n---\n_Sent via [100 prompts site](${footerRepo}). Issue created automatically._`;

  if (mode === 'topic') {
    const tit = typeof payload.title === 'string' ? payload.title.trim() : '';
    const bod = typeof payload.notes === 'string' ? payload.notes.trim() : '';
    if (!tit || tit.length > LEN.topicTitle)
      return { ok: false, error: 'invalid_payload' };
    if (bod.length > LEN.topicNotes)
      return { ok: false, error: 'invalid_payload' };
    if (isWeakTopicSuggestion(tit, bod))
      return { ok: false, error: 'weak_topic_suggestion' };
    const issueTitle = `Suggestion: new topic · ${tit.slice(0, 100)}`;
    const issueBody = `### Proposed topic\n${tit}\n\n### Notes\n${bod || '_none_'}`;
    return {
      ok: true,
      title: issueTitle,
      body: issueBody + footer,
      pingCursorAgent: false,
    };
  }

  if (mode === 'prompt') {
    const topicTitle =
      typeof payload.topicTitle === 'string' ? payload.topicTitle.trim() : '';
    const topicSlug =
      typeof payload.topicSlug === 'string' ? payload.topicSlug.trim() : '';
    const pre =
      typeof payload.pretitle === 'string' ? payload.pretitle.trim() : '';
    const pb =
      typeof payload.promptBody === 'string' ? payload.promptBody.trim() : '';
    if (!topicTitle || topicTitle.length > LEN.topicTitleCtx)
      return { ok: false, error: 'invalid_payload' };
    if (
      !topicSlug ||
      topicSlug.length > LEN.topicSlug ||
      topicSlug.includes('..')
    )
      return { ok: false, error: 'invalid_payload' };
    if (pre.length > LEN.pretitle) return { ok: false, error: 'invalid_payload' };
    if (!pb || pb.length > LEN.promptBody)
      return { ok: false, error: 'invalid_payload' };
    const issueTitle = `Suggestion: new prompt · ${(pre || topicTitle).slice(0, 80)}`;
    const issueBody =
      `### Topic\n${topicTitle}\n**Slug:** \`${topicSlug}\`\n\n### Suggested row / prompt\n` +
      (pre ? `**Title:** ${pre}\n\n` : '') +
      pb;
    return {
      ok: true,
      title: issueTitle,
      body: issueBody + footer,
      pingCursorAgent: true,
    };
  }

  return { ok: false, error: 'invalid_payload' };
}

async function githubCreateIssue(
  parsed: { owner: string; repo: string },
  issueTitle: string,
  issueBody: string,
): Promise<{ html_url?: string; number?: number }> {
  const url = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': '100pua-suggest-api',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: issueTitle, body: issueBody }),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* */
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: string }).message)
        : res.statusText;
    const err = new Error(`GitHub API ${res.status}: ${msg}`) as Error & {
      detail?: string;
    };
    err.detail = msg;
    throw err;
  }
  return typeof data === 'object' && data !== null
    ? (data as { html_url?: string; number?: number })
    : {};
}

async function githubCreateIssueComment(
  parsed: { owner: string; repo: string },
  issueNumber: number,
  body: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues/${issueNumber}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': '100pua-suggest-api',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* */
    }
    const msg =
      data && typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: string }).message)
        : `GitHub API ${res.status}`;
    throw new Error(`GitHub API ${res.status}: ${msg}`);
  }
}

const githubRepoParsed = parseRepo(GITHUB_REPO_RAW);

const explainCache = createExplainCache(API_ROOT);

const inFlightExplains = new Map<string, Promise<ExplainRunResult>>();

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (CORS_WILDCARD) return '*';
      if (!origin) return '*';
      return CORS_ALLOWED_LIST.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: ['X-Explain-Cache', 'X-Explain-Provider'],
  }),
);

app.get('/health', (c) => c.json({ ok: true }));

app.post('/explain-prompt', async (c) => {
  const originHeader = c.req.header('origin');
  if (!originAllowed(originHeader)) {
    return c.json({ error: 'origin_not_allowed' }, 403);
  }

  if (!PROMPT_INDEX || Object.keys(PROMPT_INDEX).length === 0) {
    return c.json(
      {
        error: 'misconfigured_server',
        message:
          'Run `npm run build` in the api service (prompt-index.json).',
      },
      503,
    );
  }

  const rawBody = await c.req.text();
  let payload: unknown = null;
  try {
    if (rawBody.length > MAX_EXPLAIN_JSON_BYTES) {
      return c.json({ error: 'payload_too_large' }, 413);
    }
    payload = rawBody.trim() === '' ? null : JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const p = payload as {
    slug?: unknown;
    promptId?: unknown;
    provider?: unknown;
  } | null;
  const slug = typeof p?.slug === 'string' ? p.slug.trim() : '';
  const promptId =
    typeof p?.promptId === 'string' ? p.promptId.trim() : '';

  if (!slug || slug.length > LEN.topicSlug || slug.includes('..'))
    return c.json({ error: 'invalid_payload' }, 400);

  if (
    !promptId ||
    promptId.length > LEN.topicSlug ||
    promptId.includes('..')
  )
    return c.json({ error: 'invalid_payload' }, 400);

  if (!/^[-\w]+$/.test(slug) || !/^[-_\w]+$/.test(promptId)) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const coerced = coerceExplainBodyProvider(p?.provider);
  if (coerced === false) {
    return c.json(
      { error: 'invalid_payload', message: 'provider must be claude, cursor, or codex' },
      400,
    );
  }
  const explainProvider =
    coerced === null ? explainProviderFromEnv() : coerced;

  if (!explainAgentConfigured(explainProvider)) {
    return c.json(
      {
        error: 'misconfigured_server',
        message: explainAgentMisconfiguredMessage(explainProvider),
      },
      503,
    );
  }

  const variantKey = buildExplainVariantCacheKey(explainProvider);

  const row = PROMPT_INDEX[slug]?.[promptId];
  const chatQuery = row?.chatQuery;
  if (!row || typeof chatQuery !== 'string' || !chatQuery.trim()) {
    return c.json({ error: 'unknown_prompt' }, 404);
  }

  const contentKey = crypto
    .createHash('sha256')
    .update(chatQuery.trim(), 'utf8')
    .digest('hex');

  const cachedHit = await explainCache.get(slug, promptId, contentKey, variantKey);
  const providerHeaders = { 'X-Explain-Provider': explainProvider };

  if (cachedHit) {
    return c.json(
      { answer: cachedHit.answer, cached: true },
      200,
      { 'X-Explain-Cache': 'hit', ...providerHeaders },
    );
  }

  const ip = clientIp(c.req.header('x-forwarded-for'));
  if (!allowExplainRate(ip)) {
    return c.json({ error: 'rate_limit' }, 429);
  }

  const topicLine = typeof row.topicTitle === 'string' ? row.topicTitle : '';
  const rowTitle = typeof row.title === 'string' ? row.title : '';

  const preamble = buildExplainPreambleLines(explainProvider).join('\n');

  const fullPromptText =
    `${preamble}\n\n---\nTopic: ${topicLine}\nLecture row title: ${rowTitle}\n\n` +
    `--- Student-facing study prompt ---\n\n${chatQuery.trim()}`;

  const brokerKey = `${slug}:${promptId}:${contentKey}:${variantKey}`;
  let brokerPromise = inFlightExplains.get(brokerKey);

  if (!brokerPromise) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), EXPLAIN_AGENT_TIMEOUT_MS);

    brokerPromise = (async () => {
      try {
        const out =
          explainProvider === 'cursor'
            ? await runCursorExplanation(fullPromptText, abortController)
            : explainProvider === 'codex'
              ? await runCodexExplanation(fullPromptText, abortController)
              : await runClaudeExplanation(fullPromptText, abortController);
        
        if (out.ok) {
          await explainCache.set(slug, promptId, contentKey, variantKey, out.text).catch(e => console.error('[explain-cache]', e));
        }
        return out;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) } as ExplainRunResult;
      } finally {
        clearTimeout(timeoutId);
        inFlightExplains.delete(brokerKey);
      }
    })();
    inFlightExplains.set(brokerKey, brokerPromise);
  }

  try {
    const out = await brokerPromise;
    if (!out.ok) {
      const clientMsg =
        out.error === 'timeout_or_aborted'
          ? 'Timed out waiting for the model — try again.'
          : typeof out.error === 'string'
            ? out.error
            : 'generation_failed';
      return c.json({ error: 'explain_failed', message: clientMsg }, 502);
    }
    const xCache = explainCacheActive() ? 'miss' : 'disabled';
    return c.json(
      { answer: out.text, cached: false },
      200,
      { 'X-Explain-Cache': xCache, ...providerHeaders },
    );
  } catch (e) {
    console.error(
      '[explain-prompt]',
      e instanceof Error ? e.message : String(e),
    );
    return c.json(
      { error: 'explain_failed', message: 'unexpected_server_error' },
      502,
    );
  }
});

app.post('/suggestions', async (c) => {
  const originHeader = c.req.header('origin');
  if (!originAllowed(originHeader)) {
    return c.json({ error: 'origin_not_allowed' }, 403);
  }

  if (!GITHUB_TOKEN || !GITHUB_TOKEN.trim()) {
    return c.json({ error: 'misconfigured_server' }, 503);
  }

  if (!githubRepoParsed) {
    return c.json({ error: 'invalid_github_repo_setting' }, 503);
  }

  const ip = clientIp(c.req.header('x-forwarded-for'));

  if (!allowRate(ip)) {
    return c.json({ error: 'rate_limit' }, 429);
  }

  const rawBody = await c.req.text();

  let payload: unknown = null;
  try {
    if (rawBody.length > MAX_JSON_BYTES) {
      return c.json({ error: 'payload_too_large' }, 413);
    }
    payload = rawBody.trim() === '' ? null : JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const built =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? validateAndBuild(payload as SuggestionPayload)
      : { ok: false as const, error: 'invalid_payload' as const };
  if (!built.ok) {
    return c.json({ error: built.error }, 400);
  }

  try {
    const issue = await githubCreateIssue(
      githubRepoParsed,
      built.title,
      built.body,
    );
    const htmlUrl =
      typeof issue.html_url === 'string' ? issue.html_url : undefined;
    const number =
      typeof issue.number === 'number'
        ? issue.number
        : typeof issue.number === 'string'
          ? Number.parseInt(issue.number, 10)
          : undefined;

    if (
      built.pingCursorAgent &&
      typeof number === 'number' &&
      Number.isFinite(number)
    ) {
      try {
        await githubCreateIssueComment(
          githubRepoParsed,
          number,
          CURSOR_TRIGGER_COMMENT,
        );
      } catch (e) {
        console.error(
          '[suggestions] failed to post @cursoragent comment',
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    return c.json(
      {
        ok: true,
        issueUrl: htmlUrl,
        issueNumber:
          typeof number === 'number' && !Number.isNaN(number)
            ? number
            : undefined,
      },
      201,
    );
  } catch (e) {
    console.error(
      '[suggestions]',
      e instanceof Error ? e.message : String(e),
    );
    return c.json(
      { error: 'github_error', message: 'creating_issue_failed' },
      502,
    );
  }
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

explainCache.prime().catch(() => {});

serve(
  {
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0',
  },
  (info) => {
    console.log(`suggestions (hono) listening on ${info.port}`);
  },
);
