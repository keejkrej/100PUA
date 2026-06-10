import { StartClient } from '@tanstack/react-start/client';
import { Atom } from '@effect-atom/atom-react';
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { AppApiClient } from '~/lib/api-client';

Atom.runtime.addGlobalLayer(AppApiClient.layer);

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>,
);
