import { Effect } from 'effect';

import { TopicNotFound } from './errors.js';

export type TopicManifestRow = {
  slug: string;
  topicTitle: string;
  courseLine: string;
  promptCount: number;
};

export type TopicPrompt = {
  id: string;
  title: string;
  query: string;
  durationTimestamp: string;
  resourceUrls?: string[];
};

export type TopicDoc = {
  slug: string;
  topicTitle: string;
  courseLine: string;
  promptCount: number;
  prompts: TopicPrompt[];
};

export type TopicLoaderData = {
  summary: TopicManifestRow;
  topic: TopicDoc;
};

export type PromptLoaderData = {
  topic: TopicDoc;
  promptRow: TopicPrompt;
  chatgptUrl: string;
  explainEnabled: boolean;
};

export const resolveTopic = (
  slug: string,
  manifest: TopicManifestRow[],
  topicBySlug: Record<string, TopicDoc>,
): Effect.Effect<TopicLoaderData, TopicNotFound> =>
  Effect.gen(function* () {
    const summary = manifest.find((t) => t.slug === slug);
    const topic = topicBySlug[slug];
    if (!summary || !topic) {
      return yield* Effect.fail(new TopicNotFound());
    }
    return { summary, topic };
  });

export const resolvePrompt = (
  slug: string,
  promptId: string,
  manifest: TopicManifestRow[],
  topicBySlug: Record<string, TopicDoc>,
  buildChatQuery: (prompt: TopicPrompt) => string,
  explainEnabled: boolean,
): Effect.Effect<PromptLoaderData, TopicNotFound> =>
  Effect.gen(function* () {
    const { topic } = yield* resolveTopic(slug, manifest, topicBySlug);
    const promptRow = topic.prompts.find((p) => p.id === promptId);
    if (!promptRow) {
      return yield* Effect.fail(new TopicNotFound());
    }
    return {
      topic,
      promptRow,
      chatgptUrl: `https://chatgpt.com/?q=${encodeURIComponent(buildChatQuery(promptRow))}`,
      explainEnabled,
    };
  });
