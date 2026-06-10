import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform';
import { Context, Effect, Layer, Option } from 'effect';

import { AppConfig } from './config.js';
import { CURSOR_TRIGGER_COMMENT } from './constants.js';
import type { SuggestionRequest } from './schemas.js';

const LEN = {
  topicTitle: 120,
  topicNotes: 4000,
  pretitle: 200,
  promptBody: 4000,
  topicTitleCtx: 500,
  topicSlug: 200,
} as const;

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

export function validateAndBuildIssue(
  payload: SuggestionRequest,
  githubRepo: string,
): { title: string; body: string } | null {
  const footerRepo = `https://github.com/${githubRepo}`;
  const footer = `\n\n---\n_Sent via [100 prompts site](${footerRepo}). Issue created automatically._`;

  if (payload.mode === 'topic') {
    const tit = payload.title.trim();
    const bod = (payload.notes ?? '').trim();
    if (!tit || tit.length > LEN.topicTitle) return null;
    if (bod.length > LEN.topicNotes) return null;
    const issueTitle = `Suggestion: new topic · ${tit.slice(0, 100)}`;
    const issueBody = `### Proposed topic\n${tit}\n\n### Notes\n${bod || '_none_'}`;
    return { title: issueTitle, body: issueBody + footer };
  }

  const topicTitle = payload.topicTitle.trim();
  const topicSlug = payload.topicSlug.trim();
  const pre = (payload.pretitle ?? '').trim();
  const pb = payload.promptBody.trim();
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

export class GithubIssuesService extends Context.Tag(
  '@100pua/GithubIssuesService',
)<
  GithubIssuesService,
  {
    createSuggestionIssue: (payload: SuggestionRequest) => Effect.Effect<{
      issueUrl?: string;
      issueNumber?: number;
    }, Error>;
  }
>() {
  static readonly Live = Layer.effect(
    GithubIssuesService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const client = yield* HttpClient.HttpClient;

      return {
        createSuggestionIssue: (payload) =>
          Effect.gen(function* () {
            const built = validateAndBuildIssue(payload, config.githubRepo);
            if (!built) return yield* Effect.fail(new Error('invalid_payload'));
            const parsed = parseRepo(config.githubRepo);
            if (!parsed) return yield* Effect.fail(new Error('invalid_repo'));

            const issueUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues`;
            const issueResponse = yield* client.execute(
              HttpClientRequest.post(issueUrl).pipe(
                HttpClientRequest.setHeaders({
                  Accept: 'application/vnd.github+json',
                  Authorization: `Bearer ${config.githubToken}`,
                  'X-GitHub-Api-Version': '2022-11-28',
                  'User-Agent': '100pua-suggest-api',
                  'Content-Type': 'application/json',
                }),
                HttpClientRequest.bodyUnsafeJson({
                  title: built.title,
                  body: built.body,
                }),
              ),
            );
            const issueText = yield* issueResponse.text;
            let issueData: unknown = null;
            try {
              issueData = JSON.parse(issueText);
            } catch {
              /* */
            }
            if (issueResponse.status < 200 || issueResponse.status >= 300) {
              const msg =
                issueData &&
                typeof issueData === 'object' &&
                issueData !== null &&
                'message' in issueData
                  ? String((issueData as { message?: string }).message)
                  : String(issueResponse.status);
              return yield* Effect.fail(
                new Error(`GitHub API ${issueResponse.status}: ${msg}`),
              );
            }

            const htmlUrl =
              issueData &&
              typeof issueData === 'object' &&
              issueData !== null &&
              typeof (issueData as { html_url?: unknown }).html_url === 'string'
                ? (issueData as { html_url: string }).html_url
                : undefined;
            const numberRaw = (
              issueData as { number?: number | string } | null
            )?.number;
            const number =
              typeof numberRaw === 'number'
                ? numberRaw
                : typeof numberRaw === 'string'
                  ? Number.parseInt(numberRaw, 10)
                  : undefined;

            if (typeof number === 'number' && Number.isFinite(number)) {
              const commentUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/issues/${number}/comments`;
              yield* client
                .execute(
                  HttpClientRequest.post(commentUrl).pipe(
                    HttpClientRequest.setHeaders({
                      Accept: 'application/vnd.github+json',
                      Authorization: `Bearer ${config.githubToken}`,
                      'X-GitHub-Api-Version': '2022-11-28',
                      'User-Agent': '100pua-suggest-api',
                      'Content-Type': 'application/json',
                    }),
                    HttpClientRequest.bodyUnsafeJson({
                      body: CURSOR_TRIGGER_COMMENT,
                    }),
                  ),
                )
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.sync(() => {
                      console.error(
                        '[suggestions] failed to post @cursoragent comment',
                        e instanceof Error ? e.message : String(e),
                      );
                    }),
                  ),
                );
            }

            return {
              issueUrl: htmlUrl,
              issueNumber:
                typeof number === 'number' && !Number.isNaN(number)
                  ? number
                  : undefined,
            };
          }),
      };
    }),
  );
}

export const parseGithubRepo = parseRepo;

export function repoConfigured(
  config: Context.Tag.Service<typeof AppConfig>,
): boolean {
  return Boolean(config.githubToken) && parseRepo(config.githubRepo) !== null;
}

export const GithubHttpClientLive = FetchHttpClient.layer;
