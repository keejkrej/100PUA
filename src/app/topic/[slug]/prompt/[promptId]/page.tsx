import { Effect } from "effect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolvePrompt, type TopicDoc, type TopicManifestRow } from "@100pua/domain/topics";

import { PromptPageClient } from "~/app/topic/[slug]/prompt/[promptId]/PromptPageClient";
import manifest from "~/data/topics.manifest.json";
import { buildChatQuery } from "~/lib/chat-query";
import { topicBySlug } from "~/lib/topic-registry";

type PageProps = {
  params: Promise<{ slug: string; promptId: string }>;
};

function explainEnabled(): boolean {
  return Boolean((process.env.CURSOR_API_KEY ?? "").trim());
}

function loadPrompt(slug: string, promptId: string) {
  return Effect.runSync(
    resolvePrompt(
      slug,
      promptId,
      manifest as TopicManifestRow[],
      topicBySlug as Record<string, TopicDoc>,
      buildChatQuery,
      explainEnabled(),
    ).pipe(Effect.either),
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, promptId } = await params;
  const result = loadPrompt(slug, promptId);
  if (result._tag === "Left") {
    return { title: "Prompt" };
  }
  return {
    title: result.right.promptRow.title,
    description: result.right.topic.topicTitle,
  };
}

export default async function PromptPage({ params }: PageProps) {
  const { slug, promptId } = await params;
  const result = loadPrompt(slug, promptId);
  if (result._tag === "Left") redirect("/");

  const { topic, promptRow, chatgptUrl } = result.right;

  return (
    <PromptPageClient
      slug={slug}
      promptId={promptId}
      topic={topic}
      promptRow={promptRow}
      chatgptUrl={chatgptUrl}
      explainEnabled={explainEnabled()}
    />
  );
}
