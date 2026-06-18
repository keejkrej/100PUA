"use client";

import Link from "next/link";
import { useEffect } from "react";

import type { TopicDoc } from "@100pua/domain/topics";

import { ExplainPrompt } from "~/components/ExplainPrompt";
import { recordPromptOpened } from "~/lib/prompt-progress";

type PromptRow = TopicDoc["prompts"][number];

type Props = {
  slug: string;
  promptId: string;
  topic: TopicDoc;
  promptRow: PromptRow;
  chatgptUrl: string;
  explainEnabled: boolean;
};

export function PromptPageClient({
  slug,
  promptId,
  topic,
  promptRow,
  chatgptUrl,
  explainEnabled,
}: Props) {
  useEffect(() => {
    recordPromptOpened(slug, promptId);
  }, [slug, promptId]);

  return (
    <main className="flex flex-col text-text">
      <div className="relative flex min-h-screen flex-col items-center px-6 py-16">
        <div className="relative z-10 w-full max-w-3xl">
          <div className="mb-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link
              href={`/topic/${slug}`}
              className="group text-muted inline-flex transition-colors duration-200 hover:text-text"
            >
              ← back to prompts
            </Link>
            <Link
              href="/"
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
