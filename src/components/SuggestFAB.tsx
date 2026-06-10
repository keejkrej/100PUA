import { useState } from 'react';

import { submitSuggestionRequest } from '~/lib/api-client';
import type { SuggestionRequest } from '@100pua/domain/schemas';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogCloseButton,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';

type Mode = 'topic' | 'prompt';

type Props = {
  mode: Mode;
  topicSlug?: string;
  topicTitle?: string;
};

const GITHUB_REPO =
  (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() ||
  'keejkrej/100PUA';

const URL_MAX = 7800;

function escapeAttrHref(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function buildGithubDraftUrl(title: string, body: string): string {
  let t = title;
  let b = body;
  let u =
    'https://github.com/' +
    GITHUB_REPO +
    '/issues/new?title=' +
    encodeURIComponent(t) +
    '&body=' +
    encodeURIComponent(b);
  while (u.length > URL_MAX && b.length > 80) {
    b =
      b.slice(0, b.length - 120) +
      '\n\n_(trimmed for URL length — add more on GitHub if needed)_';
    u =
      'https://github.com/' +
      GITHUB_REPO +
      '/issues/new?title=' +
      encodeURIComponent(t) +
      '&body=' +
      encodeURIComponent(b);
  }
  return u;
}

export function SuggestFAB({
  mode,
  topicSlug = '',
  topicTitle = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackOk, setFeedbackOk] = useState(true);
  const [showFields, setShowFields] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const heading =
    mode === 'topic'
      ? 'Suggest a topic'
      : `Suggest a prompt · ${topicTitle.slice(0, 48)}${topicTitle.length > 48 ? '…' : ''}`;

  function resetDialog() {
    setFeedback('');
    setFeedbackOk(true);
    setShowFields(true);
    setSubmitting(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) resetDialog();
  }

  function openDialog() {
    resetDialog();
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
  }

  function openGithubDraft(form: HTMLFormElement) {
    const fd = new FormData(form);
    const footerDraft =
      '\n\n---\n_Sent via [100 prompts site](https://github.com/' +
      GITHUB_REPO +
      '). Not created until you submit on GitHub._';

    let title: string;
    let body: string;
    if (mode === 'topic') {
      const tit = String(fd.get('title') ?? '').trim();
      const bod = String(fd.get('body') ?? '').trim();
      if (!tit) return;
      title = 'Suggestion: new topic · ' + tit.slice(0, 100);
      body =
        '### Proposed topic\n' +
        tit +
        '\n\n### Notes\n' +
        (bod || '_none_') +
        footerDraft;
    } else {
      const pre = String(fd.get('pretitle') ?? '').trim();
      const pb = String(fd.get('body') ?? '').trim();
      if (!pb) return;
      title = 'Suggestion: new prompt · ' + (pre || topicTitle).slice(0, 80);
      body =
        '### Topic\n' +
        topicTitle +
        '\n**Slug:** `' +
        topicSlug +
        '`\n\n### Suggested row / prompt\n' +
        (pre ? '**Title:** ' + pre + '\n\n' : '') +
        pb +
        footerDraft;
    }
    window.open(buildGithubDraftUrl(title, body), '_blank', 'noopener,noreferrer');
    closeDialog();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const apiPayload =
      mode === 'topic'
        ? {
            mode: 'topic' as const,
            title: String(fd.get('title') ?? '').trim(),
            notes: String(fd.get('body') ?? '').trim(),
          }
        : {
            mode: 'prompt' as const,
            topicTitle,
            topicSlug,
            pretitle: String(fd.get('pretitle') ?? '').trim(),
            promptBody: String(fd.get('body') ?? '').trim(),
          };

    if (mode === 'topic' && !apiPayload.title) return;
    if (mode === 'prompt' && !('promptBody' in apiPayload && apiPayload.promptBody))
      return;

    setSubmitting(true);
    setFeedback('');

    try {
      const result = await submitSuggestionRequest(
        apiPayload as SuggestionRequest,
      );

      if (result._tag === 'Left') {
        const cause = result.left as { error?: string; message?: string };
        if (
          cause &&
          typeof cause === 'object' &&
          cause.error === 'misconfigured_server'
        ) {
          openGithubDraft(form);
          return;
        }
        const msg =
          cause?.error === 'rate_limit'
            ? 'Too many attempts — try again later.'
            : cause?.error === 'invalid_payload'
              ? 'Invalid input.'
              : 'Could not create issue.';
        setFeedbackOk(false);
        setFeedback(msg);
        setSubmitting(false);
        return;
      }

      const success = result.right;
      const json = Array.isArray(success) ? success[0] : success;
      if (json.issueUrl) {
        setFeedbackOk(true);
        setFeedback(
          `Created. <a class="underline decoration-accent/50 hover:text-accent" href="${escapeAttrHref(json.issueUrl)}" target="_blank" rel="noopener noreferrer">View issue</a>`,
        );
        setShowFields(false);
      } else {
        setFeedbackOk(false);
        setFeedback('Could not create issue.');
        setSubmitting(false);
      }
    } catch {
      openGithubDraft(form);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="link"
        aria-haspopup="dialog"
        aria-controls="suggest-dialog"
        aria-label={
          mode === 'topic' ? 'Suggest a new topic' : 'Suggest a new prompt'
        }
        onClick={openDialog}
      >
        add
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogPopup id="suggest-dialog">
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{heading}</DialogTitle>
              <DialogCloseButton />
            </DialogHeader>
            {showFields ? (
              <DialogDescription>
                Your suggestion is turned into a GitHub issue when the API is
                configured; otherwise this opens a GitHub draft.
              </DialogDescription>
            ) : null}
            {feedback ? (
              <p
                role="status"
                className={`text-[11px] leading-relaxed ${feedbackOk ? 'text-muted' : 'text-accent'}`}
                dangerouslySetInnerHTML={{ __html: feedback }}
              />
            ) : null}

            {showFields ? (
              <div className="flex flex-col gap-4">
                {mode === 'topic' ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="suggest-topic-title" className="text-[11px] text-muted">
                        Title (short)
                      </label>
                      <Input
                        id="suggest-topic-title"
                        name="title"
                        required
                        maxLength={120}
                        autoComplete="off"
                        placeholder="e.g. MIT 8.04 Quantum Physics playlist"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="suggest-topic-body" className="text-[11px] text-muted">
                        Notes (links, why it fits, CSV source…)
                      </label>
                      <Textarea
                        id="suggest-topic-body"
                        name="body"
                        rows={5}
                        maxLength={4000}
                        placeholder="Optional details"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="suggest-prompt-title" className="text-[11px] text-muted">
                        Suggested title (optional)
                      </label>
                      <Input
                        id="suggest-prompt-title"
                        name="pretitle"
                        maxLength={200}
                        autoComplete="off"
                        placeholder="Short label or section title"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="suggest-prompt-body" className="text-[11px] text-muted">
                        Prompt text or source (YouTube URL, chapter, etc.)
                      </label>
                      <Textarea
                        id="suggest-prompt-body"
                        name="body"
                        required
                        rows={5}
                        maxLength={4000}
                        placeholder="What should the new row say or link to?"
                      />
                    </div>
                  </>
                )}

                <Button type="submit" disabled={submitting} className="py-2.5">
                  {submitting ? 'Submitting…' : 'Submit suggestion'}
                </Button>
              </div>
            ) : null}
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
