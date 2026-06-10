import { createServerFn } from '@tanstack/react-start';

import { explainAgentConfigured } from './explain-runner';

export const getExplainEnabled = createServerFn({ method: 'GET' }).handler(
  () => explainAgentConfigured(),
);
