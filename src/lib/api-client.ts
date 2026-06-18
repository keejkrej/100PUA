import { AtomHttpApi } from "@effect-atom/atom-react";
import { FetchHttpClient } from "@effect/platform";

import { Api } from "@100pua/api/api";

function apiBaseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export class AppApiClient extends AtomHttpApi.Tag<AppApiClient>()("AppApiClient", {
  api: Api,
  httpClient: FetchHttpClient.layer,
  baseUrl: apiBaseUrl(),
}) {}

export const explainPromptMutation = AppApiClient.mutation("routes", "explainPrompt");

export const submitSuggestionMutation = AppApiClient.mutation("routes", "suggestions");
