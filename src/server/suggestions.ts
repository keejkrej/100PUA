const GITHUB_REPO_RAW = (process.env.GITHUB_REPO || 'keejkrej/100PUA').trim();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const MAX_JSON_BYTES = 48_576;
const LEN = {
  topicTitle: 120,
  topicNotes: 4000,
  pretitle: 200,
  promptBody: 4000,
  topicTitleCtx: 500,
  topicSlug: 200,
} as const;

const CURSOR_TRIGGER_COMMENT =
  '@cursoragent please investigate this issue and open a PR with a fix when appropriate.';

type SuggestionPayload = Record<string, unknown>;

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

export function validateAndBuild(
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
    throw new Error(`GitHub API ${res.status}: ${msg}`);
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

export function suggestionsConfigured(): boolean {
  return Boolean(GITHUB_TOKEN.trim()) && parseRepo(GITHUB_REPO_RAW) !== null;
}

export async function handleSuggestionRequest(
  rawBody: string,
): Promise<Response> {
  if (!suggestionsConfigured()) {
    return Response.json({ error: 'misconfigured_server' }, { status: 503 });
  }

  let payload: unknown = null;
  try {
    if (rawBody.length > MAX_JSON_BYTES) {
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    }
    payload = rawBody.trim() === '' ? null : JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const built =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? validateAndBuild(payload as SuggestionPayload)
      : null;
  if (!built) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const parsed = parseRepo(GITHUB_REPO_RAW)!;

  try {
    const issue = await githubCreateIssue(parsed, built.title, built.body);
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
          parsed,
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

    return Response.json(
      {
        ok: true,
        issueUrl: htmlUrl,
        issueNumber:
          typeof number === 'number' && !Number.isNaN(number)
            ? number
            : undefined,
      },
      { status: 201 },
    );
  } catch (e) {
    console.error(
      '[suggestions]',
      e instanceof Error ? e.message : String(e),
    );
    return Response.json(
      { error: 'github_error', message: 'creating_issue_failed' },
      { status: 502 },
    );
  }
}
