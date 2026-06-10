import { Link, createFileRoute } from '@tanstack/react-router';

import { SuggestFAB } from '~/components/SuggestFAB';
import topics from '~/data/topics.manifest.json';

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [{ title: '100 prompts to understand anything' }],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <main className="flex flex-col text-text">
      <div className="relative flex min-h-screen flex-col items-center px-6 py-16">
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.03]"
          style={{
            background:
              'radial-gradient(circle, #22d3ee 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10 w-full max-w-3xl">
          <header
            className="animate-fade-in-up mb-16 opacity-0"
            style={{ animationDelay: '0s' }}
          >
            <h1 className="text-text text-xl tracking-tight">
              100 prompts to understand anything
            </h1>
            <p className="text-muted mt-1 text-sm">
              Choose a topic, then paste each prompt title into ChatGPT as a
              prompt.
            </p>
          </header>

          <div
            className="animate-fade-in-up mb-6 flex justify-start opacity-0"
            style={{ animationDelay: '0.048s' }}
          >
            <SuggestFAB mode="topic" />
          </div>

          <nav className="flex flex-col gap-0">
            {topics.map((t, idx) => (
              <Link
                key={t.slug}
                to="/topic/$slug"
                params={{ slug: t.slug }}
                className="group animate-fade-in-up relative flex items-center justify-between py-3 opacity-0"
                style={{ animationDelay: `${0.05 + idx * 0.05}s` }}
              >
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="text-subtle group-hover:text-text transition-colors duration-200">
                    {t.topicTitle}
                  </span>
                  <span className="text-muted mt-1 text-[11px] tracking-wide">
                    {t.courseLine}
                  </span>
                </span>
                <span className="text-muted ml-4 shrink-0 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3.5 w-3.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                      clipRule="evenodd"
                    />
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
