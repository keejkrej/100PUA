import { createFileRoute } from "@tanstack/react-router";

import { runHttpApiRequest } from "@100pua/api";

export const Route = createFileRoute("/api/suggestions")({
  server: {
    handlers: {
      POST: async ({ request }) => runHttpApiRequest(request),
    },
  },
});
