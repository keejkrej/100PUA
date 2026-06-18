import { Effect } from "effect";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveTopic, type TopicDoc, type TopicManifestRow } from "@100pua/domain/topics";

import { TopicPageClient } from "~/app/topic/[slug]/TopicPageClient";
import manifest from "~/data/topics.manifest.json";
import { topicBySlug } from "~/lib/topic-registry";

type PageProps = {
  params: Promise<{ slug: string }>;
};

function loadTopic(slug: string) {
  return Effect.runSync(
    resolveTopic(
      slug,
      manifest as TopicManifestRow[],
      topicBySlug as Record<string, TopicDoc>,
    ).pipe(Effect.either),
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = loadTopic(slug);
  if (result._tag === "Left") {
    return { title: "Topic" };
  }
  return {
    title: `${result.right.topic.topicTitle} · prompts`,
    description: result.right.topic.courseLine,
  };
}

export default async function TopicPage({ params }: PageProps) {
  const { slug } = await params;
  const result = loadTopic(slug);
  if (result._tag === "Left") redirect("/");

  return <TopicPageClient slug={slug} topic={result.right.topic} />;
}
