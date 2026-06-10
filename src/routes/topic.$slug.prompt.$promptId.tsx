import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { useEffect } from "react";

import { resolvePrompt, type TopicDoc, type TopicManifestRow } from "@100pua/domain/topics";

import { ExplainPrompt } from "~/components/ExplainPrompt";
import manifest from "~/data/topics.manifest.json";
import { buildChatQuery } from "~/lib/chat-query";
import { recordPromptOpened } from "~/lib/prompt-progress";
import { topicBySlug } from "~/lib/topic-registry";

const getExplainEnabled = createServerFn({ method: "GET" }).handler(() =>
  Boolean((process.env.CURSOR_API_KEY ?? "").trim()),
);

export const Route = createFileRoute("/topic/$slug/prompt/$promptId")({
  loader: async ({ params }) => {
    const explainEnabled = await getExplainEnabled();
    const result = Effect.runSync(
      resolvePrompt(
        params.slug,
        params.promptId,
        manifest as TopicManifestRow[],
        topicBySlug as Record<string, TopicDoc>,
        buildChatQuery,
        explainEnabled,
      ).pipe(Effect.either),
    );
    if (result._tag === "Left") throw redirect({ to: "/" });
    return result.right;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.promptRow.title ?? "Prompt" },
      { name: "description", content: loaderData?.topic.topicTitle ?? "" },
    ],
  }),
  component: PromptPage,
});

function PromptPage() {
  const { topic, promptRow, chatgptUrl, explainEnabled } = Route.useLoaderData();
  const { slug, promptId } = Route.useParams();

  useEffect(() => {
    recordPromptOpened(slug, promptId);
  }, [slug, promptId]);

  return (
    <main className="flex flex-col text-text">
      <div className="relative flex min-h-screen flex-col items-center px-6 py-16">
        <div className="relative z-10 w-full max-w-3xl">
          <div className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link
              to="/topic/$slug"
              params={{ slug }}
              className="group text-muted inline-flex transition-colors duration-200 hover:text-text"
            >
              ← back to prompts
            </Link>
            <Link
              to="/"
              className="group text-muted inline-flex transition-colors duration-200 hover:text-text"
            >
              ← all topics
            </Link>
          </div>

          <header className="mb-10">
            <h1 className="text-text text-xl font-normal tracking-tight">
              <a
                href={chatgptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="prompt-page-title hover:text-accent text-text decoration-muted/60 underline underline-offset-[5px] transition-colors hover:decoration-accent/80"
              >
                {promptRow.title}
              </a>
            </h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">{topic.topicTitle}</p>
            <p className="text-muted mt-1 text-[11px] tracking-wide tabular-nums">
              {promptRow.durationTimestamp}
            </p>
            <p className="text-muted mt-3 max-w-xl text-[11px] leading-relaxed opacity-90">
              Use the title above to open the same study prompt in ChatGPT.
            </p>
          </header>

          <section
            className="border-muted/35 bg-surface/40 rounded-xl border px-5 py-6"
            aria-live="polite"
          >
            <ExplainPrompt slug={slug} promptId={promptId} explainEnabled={explainEnabled} />
          </section>
        </div>
      </div>
    </main>
  );
}
