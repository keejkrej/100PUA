import { Effect } from 'effect';

import { AppConfig } from './config.js';
import {
  GithubError,
  InvalidPayload,
  MisconfiguredServer,
} from './errors.js';
import { GithubIssuesService, repoConfigured } from './github.js';
import type { SuggestionRequest, SuggestionSuccess } from './schemas.js';

export const submitSuggestion = (
  payload: SuggestionRequest,
): Effect.Effect<
  SuggestionSuccess,
  MisconfiguredServer | InvalidPayload | GithubError,
  AppConfig | GithubIssuesService
> =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const github = yield* GithubIssuesService;

    if (!repoConfigured(config)) {
      return yield* Effect.fail(
        new MisconfiguredServer({
          error: 'misconfigured_server',
          message: '',
        }),
      );
    }

    const issueResult = yield* github.createSuggestionIssue(payload).pipe(
      Effect.either,
    );

    if (issueResult._tag === 'Left') {
      const e = issueResult.left;
      if (e instanceof Error && e.message === 'invalid_payload') {
        return yield* Effect.fail(
          new InvalidPayload({ error: 'invalid_payload' }),
        );
      }
      console.error(
        '[suggestions]',
        e instanceof Error ? e.message : String(e),
      );
      return yield* Effect.fail(
        new GithubError({
          error: 'github_error',
          message: 'creating_issue_failed',
        }),
      );
    }

    const issue = issueResult.right;
    return {
      ok: true as const,
      issueUrl: issue.issueUrl,
      issueNumber: issue.issueNumber,
    };
  });
