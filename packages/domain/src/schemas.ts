import { Schema } from 'effect';

const slugPattern = /^[-\w]+$/;
const promptIdPattern = /^[-_\w]+$/;

export const ExplainPromptRequest = Schema.Struct({
  slug: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(200),
    Schema.filter((s) => !s.includes('..') && slugPattern.test(s), {
      message: () => 'invalid slug',
    }),
  ),
  promptId: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(200),
    Schema.filter((s) => !s.includes('..') && promptIdPattern.test(s), {
      message: () => 'invalid promptId',
    }),
  ),
});
export type ExplainPromptRequest = Schema.Schema.Type<typeof ExplainPromptRequest>;

export const ExplainPromptSuccess = Schema.Struct({
  answer: Schema.String,
  cached: Schema.Boolean,
});
export type ExplainPromptSuccess = Schema.Schema.Type<typeof ExplainPromptSuccess>;

export const SuggestionTopicRequest = Schema.Struct({
  mode: Schema.Literal('topic'),
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  notes: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(4000)), {
    default: () => '',
  }),
});
export type SuggestionTopicRequest = Schema.Schema.Type<
  typeof SuggestionTopicRequest
>;

export const SuggestionPromptRequest = Schema.Struct({
  mode: Schema.Literal('prompt'),
  topicTitle: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
  topicSlug: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(200),
    Schema.filter((s) => !s.includes('..'), {
      message: () => 'invalid topicSlug',
    }),
  ),
  pretitle: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(200)), {
    default: () => '',
  }),
  promptBody: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4000)),
});
export type SuggestionPromptRequest = Schema.Schema.Type<
  typeof SuggestionPromptRequest
>;

export const SuggestionRequest = Schema.Union(
  SuggestionTopicRequest,
  SuggestionPromptRequest,
);
export type SuggestionRequest = Schema.Schema.Type<typeof SuggestionRequest>;

export const SuggestionSuccess = Schema.Struct({
  ok: Schema.Literal(true),
  issueUrl: Schema.optional(Schema.String),
  issueNumber: Schema.optional(Schema.Number),
});
export type SuggestionSuccess = Schema.Schema.Type<typeof SuggestionSuccess>;

export const HealthResponse = Schema.Struct({
  ok: Schema.Boolean,
});
export type HealthResponse = Schema.Schema.Type<typeof HealthResponse>;

export const ApiErrorBody = Schema.Struct({
  error: Schema.String,
  message: Schema.optional(Schema.String),
});
export type ApiErrorBody = Schema.Schema.Type<typeof ApiErrorBody>;
