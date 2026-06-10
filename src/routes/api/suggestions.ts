import { createFileRoute } from '@tanstack/react-router';

import { allowSuggestRate, clientIp } from '~/server/rate-limit';
import { handleSuggestionRequest } from '~/server/suggestions';

export const Route = createFileRoute('/api/suggestions')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request.headers.get('x-forwarded-for'));
        if (!allowSuggestRate(ip)) {
          return Response.json({ error: 'rate_limit' }, { status: 429 });
        }
        const rawBody = await request.text();
        return handleSuggestionRequest(rawBody);
      },
    },
  },
});
