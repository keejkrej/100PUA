/**
 * Suggestion API for 100PUA · Render Web Service (Hono)
 *
 * Env:
 *   GITHUB_TOKEN            — PAT or fine-grained token with issues write (required)
 *   GITHUB_REPO             — owner/repo (default: keejkrej/100PUA)
 *   PORT                    — injected by Render
 *   ALLOWED_ORIGINS         — comma-separated origins or "*" (default "*")
 *   SUGGEST_RATE_LIMIT       — max requests per IP per window (default 20)
 *   SUGGEST_RATE_WINDOW_MS   — window ms (default 900000)
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

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
