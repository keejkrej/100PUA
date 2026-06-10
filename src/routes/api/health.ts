import { createFileRoute } from '@tanstack/react-router';

import { primeExplainCache } from '~/server/explain-api';

primeExplainCache();

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true }),
    },
  },
});
