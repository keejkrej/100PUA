/**
 * API for 100PUA · Render Web Service (Hono)
 *
 * Env:
 *   GITHUB_TOKEN             — PAT / fine-grained with issues write (required for POST /suggestions)
 *   GITHUB_REPO              — owner/repo (default: keejkrej/100PUA)
 *   PORT                     — injected by Render
 *   ALLOWED_ORIGINS          — comma-separated origins or "*" (default "*")
 *   SUGGEST_RATE_LIMIT       — max /suggestions per IP per window (default 20)
 *   SUGGEST_RATE_WINDOW_MS   — window ms (default 900000)
 *
 * POST /explain-prompt (after `npm run build` → data/prompt-index.json):
 *   CURSOR_API_KEY           — Cursor API key (dashboard or service account)
 *   CURSOR_MODEL             — optional; default composer-2
 *
 * POST /explain-prompt JSON body:
 *   slug, promptId          — required
 *
 * Shared explain settings:
 *   EXPLAIN_RATE_LIMIT       — default 12
 *   EXPLAIN_RATE_WINDOW_MS   — default 900000
 *   EXPLAIN_TIMEOUT_MS       — default 240000 (max wait for explain generation)
 *   EXPLAIN_CACHE_DAYS       — file cache TTL days (default 7; empty env = default; 0 disables)
 *   EXPLAIN_CACHE_DIR        — optional absolute path for cache JSON (default: ./cache/explain under api/)
 *   EXPLAIN_CACHE_DISABLED   — true/1 turns off caching entirely
 *   EXPLAIN_CACHE_DEBUG      — 1 logs cache directory, HIT/MISS, write failures
 *   EXPLAIN_KV_URL           — optional Render Key Value / Redis-compatible URL for hot cache tier
 *   EXPLAIN_KV_CACHE_SECONDS — optional KV TTL seconds (default 86400; 0 disables KV tier)
 *   EXPLAIN_KV_PREFIX        — optional KV key prefix (default 100pua)
 *
 * Successful POST /explain-prompt sets X-Explain-Cache (CORS-exposed).
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  createExplainCache,
  explainCacheActive,
  buildExplainVariantCacheKey,
} from './explain-cache.js';
import {
  buildFullExplainPrompt,
  explainAgentConfigured,
  explainAgentMisconfiguredMessage,
  explainAgentTimeoutMs,
  explainContentKey,
  loadPromptIndex,
  runExplanation,
  type ExplainRunResult,
} from './explain-runner.js';

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

const MAX_JSON_BYTES = 48_576;
const LEN = {
  topicTitle: 120,
  topicNotes: 4000,
  pretitle: 200,
  promptBody: 4000,
  topicTitleCtx: 500,
  topicSlug: 200,
} as const;

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

const PROMPT_INDEX = loadPromptIndex(API_ROOT);

type SuggestionPayload = Record<string, unknown>;

function validateAndBuild(
  payload: SuggestionPayload,
): { title: string; body: string } | null {
  const mode = payload?.mode;
  const footerRepo = `https://github.com/${GITHUB_REPO_RAW}`;
  const footer = `\n\n---\n_Sent via [100 prompts site](${footerRepo}). Issue created automatically._`;

  if (mode === 'topic') {
    const tit = typeof payload.title === 'string' ? payload.title.trim() : '';
    const bod = typeof payload.notes === 'string' ? payload.notes.trim() : '';
    if (!tit || tit.length > LEN.topicTitle) return null;
    if (bod.length > LEN.topicNotes) return null;
    const issueTitle = `Suggestion: new topic · ${tit.slice(0, 100)}`;
    const issueBody = `### Proposed topic\n${tit}\n\n### Notes\n${bod || '_none_'}`;
    return { title: issueTitle, body: issueBody + footer };
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
    if (!topicTitle || topicTitle.length > LEN.topicTitleCtx) return null;
    if (
      !topicSlug ||
      topicSlug.length > LEN.topicSlug ||
      topicSlug.includes('..')
    )
      return null;
    if (pre.length > LEN.pretitle) return null;
    if (!pb || pb.length > LEN.promptBody) return null;
    const issueTitle = `Suggestion: new prompt · ${(pre || topicTitle).slice(0, 80)}`;
    const issueBody =
      `### Topic\n${topicTitle}\n**Slug:** \`${topicSlug}\`\n\n### Suggested row / prompt\n` +
      (pre ? `**Title:** ${pre}\n\n` : '') +
      pb;
    return { title: issueTitle, body: issueBody + footer };
  }

  return null;
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
    exposeHeaders: ['X-Explain-Cache'],
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

  if (!explainAgentConfigured()) {
    return c.json(
      {
        error: 'misconfigured_server',
        message: explainAgentMisconfiguredMessage(),
      },
      503,
    );
  }

  const variantKey = buildExplainVariantCacheKey();

  const row = PROMPT_INDEX[slug]?.[promptId];
  const chatQuery = row?.chatQuery;
  if (!row || typeof chatQuery !== 'string' || !chatQuery.trim()) {
    return c.json({ error: 'unknown_prompt' }, 404);
  }

  const contentKey = explainContentKey(chatQuery);

  const cachedHit = await explainCache.get(slug, promptId, contentKey, variantKey);

  if (cachedHit) {
    return c.json(
      { answer: cachedHit.answer, cached: true },
      200,
      { 'X-Explain-Cache': 'hit' },
    );
  }

  const ip = clientIp(c.req.header('x-forwarded-for'));
  if (!allowExplainRate(ip)) {
    return c.json({ error: 'rate_limit' }, 429);
  }

  const fullPromptText = buildFullExplainPrompt(row);

  const brokerKey = `${slug}:${promptId}:${contentKey}:${variantKey}`;
  let brokerPromise = inFlightExplains.get(brokerKey);

  if (!brokerPromise) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), explainAgentTimeoutMs());

    brokerPromise = (async () => {
      try {
        const out = await runExplanation(
          fullPromptText,
          abortController,
        );
        
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
      { 'X-Explain-Cache': xCache },
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
      : null;
  if (!built) {
    return c.json({ error: 'invalid_payload' }, 400);
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

    if (typeof number === 'number' && Number.isFinite(number)) {
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
