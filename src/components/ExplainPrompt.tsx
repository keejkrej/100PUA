import DOMPurify from 'dompurify';
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import { marked } from 'marked';
import { Result, useAtomSet, useAtomValue } from '@effect-atom/atom-react';
import { useEffect, useRef, useState } from 'react';

import { Toggle, ToggleGroup } from '~/components/ui/toggle-group';
import { explainPromptMutation } from '~/lib/api-client';

marked.use({ gfm: true, breaks: true });

type View = 'rendered' | 'raw';

function renderDisplayMathDollars(html: string): string {
  return html.replace(
    /<pre\b[\s\S]*?<\/pre>|\$\$([\s\S]*?)\$\$/gi,
    (fragment, latexBlock: string | undefined) => {
      if (latexBlock === undefined) return fragment;

      const latex = latexBlock
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim();
      if (!latex) return fragment;

      try {
        return katex.renderToString(latex, {
          displayMode: true,
          throwOnError: false,
          strict: 'ignore',
        });
      } catch {
        return fragment;
      }
    },
  );
}

function normalizeMarkdownMath(markdown: string): string {
  let md = markdown;

  md = md.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => {
    const t = inner.trim();
    return t ? `\n\n$$\n${t}\n$$\n\n` : '';
  });

  md = md.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => {
    const t = inner.trim();
    return t ? `$${t}$` : '';
  });

  return md;
}

function errorMessage(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    const c = cause as { error?: string; message?: string };
    if (c.error === 'rate_limit') {
      return 'Too many attempts — try again later.';
    }
    if (typeof c.message === 'string' && c.message.length > 0) {
      return c.message;
    }
  }
  return 'Service error.';
}

type Props = {
  slug: string;
  promptId: string;
  explainEnabled: boolean;
};

export function ExplainPrompt({ slug, promptId, explainEnabled }: Props) {
  const runExplain = useAtomSet(explainPromptMutation);
  const explainResult = useAtomValue(explainPromptMutation);
  const [view, setView] = useState<View>('rendered');
  const renderedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!explainEnabled) return;
    runExplain({ payload: { slug, promptId } });
  }, [slug, promptId, explainEnabled, runExplain]);

  const status =
    Result.builder(explainResult)
      .onInitialOrWaiting(() => ({
        text: 'Generating answer…',
        className: 'text-muted',
      }))
      .onSuccess(() => ({ text: 'Answer', className: 'text-accent/90' }))
      .onError(() => ({
        text: 'Could not load answer',
        className: 'text-accent',
      }))
      .render() ?? { text: 'Generating answer…', className: 'text-muted' };

  const markdown = Result.match(explainResult, {
    onInitial: () => null,
    onFailure: () => null,
    onSuccess: (success) => success.value.answer,
  });

  const error = Result.matchWithError(explainResult, {
    onInitial: () => null,
    onError: (cause) => errorMessage(cause),
    onDefect: () => 'Service error.',
    onSuccess: () => null,
  });

  useEffect(() => {
    if (!markdown || !renderedRef.current) return;
    const htmlRaw = marked.parse(normalizeMarkdownMath(markdown)) as string;
    const safe = DOMPurify.sanitize(htmlRaw, {
      USE_PROFILES: { html: true },
    });
    renderedRef.current.innerHTML = renderDisplayMathDollars(safe);
    try {
      renderMathInElement(renderedRef.current, {
        delimiters: [
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
        ignoredClasses: ['katex', 'katex-display', 'katex-html'],
        throwOnError: false,
        strict: 'ignore',
      });
    } catch {
      //
    }
  }, [markdown, view]);

  if (!explainEnabled) {
    return (
      <p className="text-muted text-sm leading-relaxed">
        Set <code className="text-accent/90">CURSOR_API_KEY</code> on the server
        so this page can call <code className="text-accent/90">/api/explain-prompt</code>.
      </p>
    );
  }

  const showToolbar = markdown !== null;

  return (
    <>
      <p className={`mb-5 text-[11px] tracking-wide ${status.className}`}>
        {status.text}
      </p>
      {showToolbar ? (
        <div className="mb-4 flex w-full min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <ToggleGroup
            className="shrink-0"
            aria-label="Answer format"
            value={[view]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === 'rendered' || next === 'raw') setView(next);
            }}
          >
            <Toggle value="rendered">Rendered</Toggle>
            <Toggle value="raw">Raw</Toggle>
          </ToggleGroup>
        </div>
      ) : null}
      <div className="min-h-[6rem]">
        {error ? (
          <p className="block text-sm leading-relaxed text-muted whitespace-pre-wrap">
            {error}
          </p>
        ) : (
          <>
            <div
              ref={renderedRef}
              className="explain-md block"
              hidden={view !== 'rendered' || !markdown}
            />
            <pre
              className="font-mono text-subtle max-h-[min(70vh,48rem)] overflow-auto whitespace-pre-wrap text-[0.8125rem] leading-relaxed"
              hidden={view !== 'raw' || !markdown}
            >
              {markdown ?? ''}
            </pre>
          </>
        )}
      </div>
    </>
  );
}
