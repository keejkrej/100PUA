import DOMPurify from 'dompurify';
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import { marked } from 'marked';
import { useEffect, useRef, useState } from 'react';

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

type Props = {
  slug: string;
  promptId: string;
  explainEnabled: boolean;
};

export function ExplainPrompt({ slug, promptId, explainEnabled }: Props) {
  const [status, setStatus] = useState('Generating answer…');
  const [statusClass, setStatusClass] = useState('text-muted');
  const [view, setView] = useState<View>('rendered');
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderedRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!explainEnabled) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('Generating answer…');
    setStatusClass('text-muted');
    setMarkdown(null);
    setError(null);
    setView('rendered');

    fetch('/api/explain-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, promptId }),
      signal: controller.signal,
    })
      .then((r) =>
        r.text().then((t) => {
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(t) as Record<string, unknown>;
          } catch {
            json = {};
          }
          return { ok: r.ok, json };
        }),
      )
      .then((resp) => {
        if (abortRef.current !== controller) return;
        const j = resp.json;
        if (resp.ok && typeof j.answer === 'string') {
          setMarkdown(j.answer);
          setStatus('Answer');
          setStatusClass('text-accent/90');
        } else {
          const msg =
            j.error === 'rate_limit'
              ? 'Too many attempts — try again later.'
              : typeof j.message === 'string'
                ? j.message
                : 'Service error.';
          setError(msg);
          setStatus('Could not load answer');
          setStatusClass('text-accent');
        }
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (abortRef.current !== controller) return;
        setError('Network error.');
        setStatus('Could not load answer');
        setStatusClass('text-accent');
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
      });

    return () => controller.abort();
  }, [slug, promptId, explainEnabled]);

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
      <p className={`mb-5 text-[11px] tracking-wide ${statusClass}`}>{status}</p>
      {showToolbar ? (
        <div className="mb-4 flex w-full min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <div
            className="inline-flex shrink-0 items-center"
            role="radiogroup"
            aria-label="Answer format"
          >
            <div className="border-muted/40 bg-void/50 inline-flex items-center rounded-lg border p-0.5 shadow-sm">
              <button
                type="button"
                className={`explain-toggle rounded-md px-3 py-1 text-[11px] tracking-wide transition-colors outline-none ${view === 'rendered' ? 'explain-toggle--on' : 'explain-toggle--off'}`}
                role="radio"
                aria-checked={view === 'rendered'}
                onClick={() => setView('rendered')}
              >
                Rendered
              </button>
              <button
                type="button"
                className={`explain-toggle rounded-md px-3 py-1 text-[11px] tracking-wide transition-colors outline-none ${view === 'raw' ? 'explain-toggle--on' : 'explain-toggle--off'}`}
                role="radio"
                aria-checked={view === 'raw'}
                onClick={() => setView('raw')}
              >
                Raw
              </button>
            </div>
          </div>
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
