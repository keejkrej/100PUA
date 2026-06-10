import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from '@effect/platform';
import {
  ExplainPromptRequest,
  ExplainPromptSuccess,
  HealthResponse,
  SuggestionRequest,
  SuggestionSuccess,
} from '@100pua/domain/schemas';
import {
  ExplainFailed,
  GithubError,
  InvalidJson,
  InvalidPayload,
  MisconfiguredServer,
  PayloadTooLarge,
  RateLimitExceeded,
  UnknownPrompt,
} from '@100pua/domain/errors';

export class Api extends HttpApi.make('100pua').add(
  HttpApiGroup.make('routes', { topLevel: true })
    .add(
      HttpApiEndpoint.get('health', '/api/health').addSuccess(HealthResponse),
    )
    .add(
      HttpApiEndpoint.post('explainPrompt', '/api/explain-prompt')
        .setPayload(ExplainPromptRequest)
        .addSuccess(ExplainPromptSuccess)
        .addError(MisconfiguredServer, { status: 503 })
        .addError(UnknownPrompt, { status: 404 })
        .addError(RateLimitExceeded, { status: 429 })
        .addError(ExplainFailed, { status: 502 })
        .addError(InvalidPayload, { status: 400 })
        .addError(InvalidJson, { status: 400 })
        .addError(PayloadTooLarge, { status: 413 }),
    )
    .add(
      HttpApiEndpoint.post('suggestions', '/api/suggestions')
        .setPayload(SuggestionRequest)
        .addSuccess(SuggestionSuccess, { status: 201 })
        .addError(MisconfiguredServer, { status: 503 })
        .addError(InvalidPayload, { status: 400 })
        .addError(InvalidJson, { status: 400 })
        .addError(PayloadTooLarge, { status: 413 })
        .addError(GithubError, { status: 502 })
        .addError(RateLimitExceeded, { status: 429 }),
    ),
) {}
