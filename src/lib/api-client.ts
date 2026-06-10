import { AtomHttpApi } from '@effect-atom/atom-react';
import { FetchHttpClient } from '@effect/platform';
import { Effect } from 'effect';

import { Api } from '@100pua/api/api';
import type { SuggestionRequest } from '@100pua/domain/schemas';

function apiBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.VITE_SITE_URL ?? 'http://localhost:3000';
}

export class AppApiClient extends AtomHttpApi.Tag<AppApiClient>()('AppApiClient', {
  api: Api,
  httpClient: FetchHttpClient.layer,
  baseUrl: apiBaseUrl(),
}) {}

export const explainPromptMutation = AppApiClient.mutation(
  'routes',
  'explainPrompt',
);

export const submitSuggestionMutation = AppApiClient.mutation(
  'routes',
  'suggestions',
);

export function submitSuggestionRequest(payload: SuggestionRequest) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* AppApiClient;
      return yield* client.suggestions({ payload } as never);
    }).pipe(Effect.provide(AppApiClient.layer), Effect.either),
  );
}
