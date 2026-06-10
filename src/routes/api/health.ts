import { createFileRoute } from '@tanstack/react-router';

import { runHttpApiRequest } from '@100pua/api';

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async ({ request }) => runHttpApiRequest(request),
    },
  },
});
