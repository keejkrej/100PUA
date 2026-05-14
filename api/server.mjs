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
 *   CLAUDE_CODE_OAUTH_TOKEN  — from `claude setup-token` (subscription OAuth); or
 *   ANTHROPIC_API_KEY        — Console API key
 *   EXPLAIN_RATE_LIMIT       — default 12
 *   EXPLAIN_RATE_WINDOW_MS   — default 900000
 *   CLAUDE_EXPLAIN_TIMEOUT_MS — default 240000
 *   CLAUDE_MODEL             — optional model id
 *   EXPLAIN_CACHE_DAYS       — file cache TTL in days for /explain-prompt (default 7; 0 disables writes)
 *   EXPLAIN_CACHE_DIR        — optional absolute path for cache JSON (default: ./cache/explain under api/)
 *   EXPLAIN_CACHE_DISABLED   — true/1 turns off caching entirely
 */

import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { query } from '@anthropic-ai/claude-agent-sdk';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createExplainCache } from './explain-cache.mjs';

const PORT = Number(process.env.PORT) || 8787;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO_RAW = (process.env.GITHUB_REPO || 'keejkrej/100PUA').trim();
const ALLOWED_ORIGINS_RAW = (process.env.ALLOWED_ORIGINS ?? '*').trim();
const RATE_LIMIT = Number.isFinite(Number(process.env.SUGGEST_RATE_LIMIT))
  ? Math.max(5, Number(process.env.SUGGEST_RATE_LIMIT))
  : 20;
const RATE_WINDOW_MS = Number.isFinite(Number(process.env.SUGGEST_RATE_WINDOW_MS))
  ? Math.max(60_000, Number(process.env.SUGGEST_RATE_WINDOW_MS))
  : 15 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXPLAIN_RATE_LIMIT = Number.isFinite(Number(process.env.EXPLAIN_RATE_LIMIT))
  ? Math.max(3, Number(process.env.EXPLAIN_RATE_LIMIT))
  : 12;
const EXPLAIN_RATE_WINDOW_MS = Number.isFinite(Number(process.env.EXPLAIN_RATE_WINDOW_MS))
  ? Math.max(60_000, Number(process.env.EXPLAIN_RATE_WINDOW_MS))
  : 15 * 60 * 1000;

const explainRateBuckets = new Map();

const MAX_EXPLAIN_JSON_BYTES = 16_384;
const CLAUDE_TIMEOUT_MS = Number.isFinite(Number(process.env.CLAUDE_EXPLAIN_TIMEOUT_MS))
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
};

const rateBuckets = new Map();

function parseRepo(slug) {
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

function clientIp(xForwardedFor) {
  if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
    const first = xForwardedFor.split(',')[0];
    return first ? first.trim() : 'unknown';
  }
  return 'unknown';
}

function allowRate(ip) {
  const now = Date.now();
  const prev = rateBuckets.get(ip) || [];
  const next = prev.filter((t) => now - t < RATE_WINDOW_MS);
  if (next.length >= RATE_LIMIT) return false;
  next.push(now);
  rateBuckets.set(ip, next);
  return true;
}

function allowExplainRate(ip) {
  const now = Date.now();
  const prev = explainRateBuckets.get(ip) || [];
  const next = prev.filter((t) => now - t < EXPLAIN_RATE_WINDOW_MS);
  if (next.length >= EXPLAIN_RATE_LIMIT) return false;
  next.push(now);
  explainRateBuckets.set(ip, next);
  return true;
}

const CORS_WILDCARD = ALLOWED_ORIGINS_RAW === '*' || ALLOWED_ORIGINS_RAW === '';
const CORS_ALLOWED_LIST = CORS_WILDCARD
  ? []
  : ALLOWED_ORIGINS_RAW.split(',').map((s) => s.trim()).filter(Boolean);

/** @returns {boolean} */
function originAllowed(originHeader) {
  if (CORS_WILDCARD) return true;
  const o = originHeader || '';
  if (!o) return true;
  return CORS_ALLOWED_LIST.includes(o);
}

/** @returns {boolean} */
function hasClaudeCredential() {
  const o = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '').trim();
  const k = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  return Boolean(o || k);
}

function loadPromptIndex() {
  try {
    const fp = path.join(__dirname, 'data', 'prompt-index.json');
    const raw = fs.readFileSync(fp, 'utf8');
    /** @type {unknown} */
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    /** @type {Record<string, Record<string, { topicTitle?: string; title?: string; chatQuery?: string }>>} */
    return /** @type {any} */ (j);
  } catch {
    console.warn('[explain-prompt] missing data/prompt-index.json — run `npm run build` in ./api');
    return null;
  }
}

/** @returns {AbortController} */
function mergeAbortControllers(...signals) {
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

/**
 * @param {string} fullPromptText
 * @param {AbortController} abortController
 */
async function runClaudeExplanation(fullPromptText, abortController) {
  const sessionHome = await fsp.mkdtemp(path.join(os.tmpdir(), '100pua-cc-'));
  /** @type {import('@anthropic-ai/claude-agent-sdk').Query | null} */
  let q_iter = null;
  try {
    q_iter = query({
      prompt: fullPromptText,
      options: {
        cwd: sessionHome,
        env: {
          ...process.env,
          HOME: sessionHome,
          CLAUDE_AGENT_SDK_CLIENT_APP: '100pua-api/1.0',
        },
        abortController,
        tools: [],
        maxTurns: 2,
        permissionMode: 'dontAsk',
        settingSources: [],
        ...(process.env.CLAUDE_MODEL?.trim()
          ? { model: process.env.CLAUDE_MODEL.trim() }
          : {}),
      },
    });

    /** @type {string | undefined} */
    let finalText;
    /** @type {string[]} */
    const errLines = [];
    try {
      for await (const msg of q_iter) {
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
      if (q_iter) q_iter.close();
    }

    if (finalText) return { ok: true, text: finalText };
    return {
      ok: false,
      error:
        errLines.length > 0 ? errLines.join('; ') : 'agent_finished_without_result',
    };
  } catch (e) {
    const name = e && typeof e === 'object' && 'name' in e ? String(/** @type {Error} */ (e).name) : '';
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

const PROMPT_INDEX = loadPromptIndex();

/** @returns {{ title: string, body: string } | null} */
function validateAndBuild(payload) {
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
    const pre = typeof payload.pretitle === 'string' ? payload.pretitle.trim() : '';
    const pb = typeof payload.promptBody === 'string' ? payload.promptBody.trim() : '';
    if (!topicTitle || topicTitle.length > LEN.topicTitleCtx) return null;
    if (!topicSlug || topicSlug.length > LEN.topicSlug || topicSlug.includes('..'))
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

async function githubCreateIssue({ owner, repo }, issueTitle, issueBody) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
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
  /** @type {unknown} */
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /**/
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'message' in data
        ? String(/** @type {{ message?: string }} */ (data).message)
        : res.statusText;
    const err = new Error(`GitHub API ${res.status}: ${msg}`);
    /** @type {typeof err & { detail?: string }} */
    const e = err;
    e.detail = msg;
    throw e;
  }
  return /** @type {{ html_url?: string; number?: number }} */ (
    typeof data === 'object' && data !== null ? data : {}
  );
}

const githubRepoParsed = parseRepo(GITHUB_REPO_RAW);

const explainCache = createExplainCache(__dirname);

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
  })
);

app.get('/health', (c) => c.json({ ok: true }));

app.post('/explain-prompt', async (c) => {
  const originHeader = c.req.header('origin');
  if (!originAllowed(originHeader)) {
    return c.json({ error: 'origin_not_allowed' }, 403);
  }

  if (!hasClaudeCredential()) {
    return c.json(
      {
        error: 'misconfigured_server',
        message:
          'Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY on the API service.',
      },
      503
    );
  }

  if (!PROMPT_INDEX || Object.keys(PROMPT_INDEX).length === 0) {
    return c.json(
      {
        error: 'misconfigured_server',
        message: 'Run `npm run build` in the api service (prompt-index.json).',
      },
      503
    );
  }

  const rawBody = await c.req.text();
  let payload = null;
  try {
    if (rawBody.length > MAX_EXPLAIN_JSON_BYTES) {
      return c.json({ error: 'payload_too_large' }, 413);
    }
    payload = rawBody.trim() === '' ? null : JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const slug = typeof payload?.slug === 'string' ? payload.slug.trim() : '';
  const promptId =
    typeof payload?.promptId === 'string' ? payload.promptId.trim() : '';

  if (!slug || slug.length > LEN.topicSlug || slug.includes('..'))
    return c.json({ error: 'invalid_payload' }, 400);

  if (
    !promptId ||
    promptId.length > LEN.topicSlug ||
    promptId.includes('..')
  )
    return c.json({ error: 'invalid_payload' }, 400);

  if (
    !/^[-\w]+$/.test(slug) ||
    !/^[-_\w]+$/.test(promptId)
  ) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  const row = PROMPT_INDEX[slug]?.[promptId];
  const chatQuery = row?.chatQuery;
  if (!row || typeof chatQuery !== 'string' || !chatQuery.trim()) {
    return c.json({ error: 'unknown_prompt' }, 404);
  }

  const contentKey = crypto
    .createHash('sha256')
    .update(chatQuery.trim(), 'utf8')
    .digest('hex');

  const cachedHit = await explainCache.get(slug, promptId, contentKey);
  if (cachedHit)
    return c.json({ answer: cachedHit.answer, cached: true }, 200);

  const ip = clientIp(c.req.header('x-forwarded-for'));
  if (!allowExplainRate(ip)) {
    return c.json({ error: 'rate_limit' }, 429);
  }

  const topicLine = typeof row.topicTitle === 'string' ? row.topicTitle : '';
  const rowTitle = typeof row.title === 'string' ? row.title : '';

  const preamble = [
    `You help students digest lecture-aligned study prompts (the same text they might paste into ChatGPT).`,
    ``,
    `- Reply in Markdown. Prefer clarity over length (about 500–900 words unless the question is narrow).`,
    `- Use short sections, bullets, and concrete examples when helpful.`,
    `- Do not claim you watched the video; infer from the pasted prompt and URLs only.`,
  ].join('\n');

  const fullPromptText =
    `${preamble}\n\n---\nTopic: ${topicLine}\nLecture row title: ${rowTitle}\n\n` +
    `--- Student-facing study prompt ---\n\n${chatQuery.trim()}`;

  const clientSig = c.req.raw.signal;
  const merged = mergeAbortControllers(AbortSignal.timeout(CLAUDE_TIMEOUT_MS), clientSig);
  const abortController = merged;

  try {
    const out = await runClaudeExplanation(fullPromptText, abortController);
    if (out.ok && out.text) {
      explainCache.set(slug, promptId, contentKey, out.text).catch(() => {});
      return c.json({ answer: out.text, cached: false }, 200);
    }
    const clientMsg =
      out.error === 'timeout_or_aborted'
        ? 'Timed out waiting for Claude — try again.'
        : typeof out.error === 'string'
          ? out.error
          : 'generation_failed';
    return c.json({ error: 'explain_failed', message: clientMsg }, 502);
  } catch (e) {
    console.error('[explain-prompt]', /** @type {Error} */ (e).message);
    return c.json({ error: 'explain_failed', message: 'unexpected_server_error' }, 502);
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

  let payload = null;
  try {
    if (rawBody.length > MAX_JSON_BYTES) {
      return c.json({ error: 'payload_too_large' }, 413);
    }
    payload = rawBody.trim() === '' ? null : JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const built = payload && validateAndBuild(payload);
  if (!built) {
    return c.json({ error: 'invalid_payload' }, 400);
  }

  try {
    const issue = await githubCreateIssue(githubRepoParsed, built.title, built.body);
    const htmlUrl =
      typeof issue.html_url === 'string' ? issue.html_url : undefined;
    const number =
      typeof issue.number === 'number'
        ? issue.number
        : typeof issue.number === 'string'
          ? Number.parseInt(issue.number, 10)
          : undefined;

    return c.json(
      {
        ok: true,
        issueUrl: htmlUrl,
        issueNumber:
          typeof number === 'number' && !Number.isNaN(number)
            ? number
            : undefined,
      },
      201
    );
  } catch (e) {
    console.error('[suggestions]', /** @type {Error} */ (e).message);
    return c.json(
      { error: 'github_error', message: 'creating_issue_failed' },
      502
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
  }
);
