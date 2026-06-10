import { Link, createFileRoute, redirect } from '@tanstack/react-router';
import { Effect } from 'effect';
import { useEffect, useState } from 'react';

import {
  resolveTopic,
  type TopicDoc,
  type TopicManifestRow,
} from '@100pua/domain/topics';

import { SuggestFAB } from '~/components/SuggestFAB';
import manifest from '~/data/topics.manifest.json';
import {
  clearPromptProgress,
  readPromptProgress,
  recordPromptOpened,
} from '~/lib/prompt-progress';
import { topicBySlug } from '~/lib/topic-registry';

export const Route = createFileRoute('/topic/$slug')({
  loader: ({ params }) => {
    const result = Effect.runSync(
      resolveTopic(
        params.slug,
        manifest as TopicManifestRow[],
        topicBySlug as Record<string, TopicDoc>,
      ).pipe(Effect.either),
    );
    if (result._tag === 'Left') throw redirect({ to: '/' });
    return result.right;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.topic.topicTitle ?? 'Topic'} · prompts`,
      },
      { name: 'description', content: loaderData?.topic.courseLine ?? '' },
    ],
  }),
  component: TopicPage,
});

function TopicPage() {
  const { topic } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const map = readPromptProgress()[slug] ?? {};
    setOpened(
      Object.fromEntries(
        topic.prompts.map((p) => [p.id, Boolean(map[p.id])]),
      ),
    );
  }, [slug, topic.prompts]);

  function onPromptClick(promptId: string) {
    recordPromptOpened(slug, promptId);
    setOpened((prev) => ({ ...prev, [promptId]: true }));
  }

  function onReset() {
    clearPromptProgress();
    setOpened({});
  }

  return (
    <main className="flex flex-col text-text">
      <div className="relative flex min-h-screen flex-col items-center px-6 py-16">
        <div
          className="pointer-events-none absolute top-1/4 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-[0.03]"
          style={{
            background:
              'radial-gradient(circle, #22d3ee 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10 w-full max-w-3xl">
          <Link
            to="/"
            className="group animate-fade-in-up mb-12 inline-flex items-center gap-2 text-sm opacity-0"
            style={{ animationDelay: '0s' }}
          >
            <span className="text-muted transition-colors duration-200 group-hover:text-text">
              ← all topics
            </span>
          </Link>

          <header
            className="animate-fade-in-up mb-14 opacity-0"
            style={{ animationDelay: '0.03s' }}
          >
            <h1 className="text-text text-xl tracking-tight">
              {topic.topicTitle}
            </h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {topic.courseLine}
            </p>
            <p className="text-muted mt-2 text-[11px] tracking-wide">
              {topic.promptCount} prompts · opened rows show in accent color
            </p>
          </header>

          <div
            className="animate-fade-in-up mb-6 flex items-center justify-between gap-4 opacity-0"
            style={{ animationDelay: '0.055s' }}
          >
            <SuggestFAB
              mode="prompt"
              topicSlug={slug}
              topicTitle={topic.topicTitle}
            />
            <button
              type="button"
              className="text-muted cursor-pointer text-[11px] tracking-wide underline decoration-transparent underline-offset-2 transition-colors hover:text-accent hover:decoration-accent/60"
              aria-label="Clear saved opens for every topic"
              onClick={onReset}
            >
              reset
            </button>
          </div>

          <nav className="flex flex-col gap-0">
            {topic.prompts.map((p, i) => (
              <Link
                key={p.id}
                to="/topic/$slug/prompt/$promptId"
                params={{ slug, promptId: p.id }}
                onClick={() => onPromptClick(p.id)}
                className="group animate-fade-in-up relative flex items-start gap-4 py-3 opacity-0"
                style={{
                  animationDelay: `${Math.min(0.06 + i * 0.012, 0.55)}s`,
                }}
              >
                <span
                  className={`prompt-title min-w-0 flex-1 text-left text-sm transition-colors duration-200 leading-relaxed ${opened[p.id] ? 'text-accent' : 'text-subtle group-hover:text-text'}`}
                >
                  {p.title}
                </span>
                <span className="text-muted w-12 shrink-0 pt-0.5 text-right text-[11px] tabular-nums">
                  {p.durationTimestamp}
                </span>
                <span className="text-muted shrink-0 pt-0.5 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3.5 w-3.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                  </svg>
                </span>
                <span className="bg-accent/40 absolute bottom-2 left-0 h-px w-0 transition-all duration-300 ease-out group-hover:w-full" />
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </main>
  );
}
