import { Schema } from 'effect';

export class InvalidPayload extends Schema.TaggedError<InvalidPayload>()(
  'InvalidPayload',
  { error: Schema.Literal('invalid_payload') },
) {}

export class InvalidJson extends Schema.TaggedError<InvalidJson>()(
  'InvalidJson',
  { error: Schema.Literal('invalid_json') },
) {}

export class PayloadTooLarge extends Schema.TaggedError<PayloadTooLarge>()(
  'PayloadTooLarge',
  { error: Schema.Literal('payload_too_large') },
) {}

export class RateLimitExceeded extends Schema.TaggedError<RateLimitExceeded>()(
  'RateLimitExceeded',
  { error: Schema.Literal('rate_limit') },
) {}

export class MisconfiguredServer extends Schema.TaggedError<MisconfiguredServer>()(
  'MisconfiguredServer',
  {
    error: Schema.Literal('misconfigured_server'),
    message: Schema.String,
  },
) {}

export class UnknownPrompt extends Schema.TaggedError<UnknownPrompt>()(
  'UnknownPrompt',
  { error: Schema.Literal('unknown_prompt') },
) {}

export class ExplainFailed extends Schema.TaggedError<ExplainFailed>()(
  'ExplainFailed',
  {
    error: Schema.Literal('explain_failed'),
    message: Schema.String,
  },
) {}

export class GithubError extends Schema.TaggedError<GithubError>()(
  'GithubError',
  {
    error: Schema.Literal('github_error'),
    message: Schema.String,
  },
) {}

export class TopicNotFound extends Schema.TaggedError<TopicNotFound>()(
  'TopicNotFound',
  {},
) {}
