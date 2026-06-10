import { createFileRoute } from '@tanstack/react-router';

import { handleExplainPromptRequest } from '~/server/explain-api';

export const Route = createFileRoute('/api/explain-prompt')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        return handleExplainPromptRequest(
          rawBody,
          request.headers.get('x-forwarded-for'),
        );
      },
    },
  },
});
