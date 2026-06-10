import { createFileRoute } from '@tanstack/react-router';

import { runHttpApiRequest } from '@100pua/api';

export const Route = createFileRoute('/api/explain-prompt')({
  server: {
    handlers: {
      POST: async ({ request }) => runHttpApiRequest(request),
    },
  },
});
