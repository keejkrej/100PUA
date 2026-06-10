import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirnamePath = path.dirname(fileURLToPath(import.meta.url));

/** Repo root when running from source or Nitro `.output`. */
export function projectRoot(): string {
  const base = path.basename(__dirnamePath);
  if (base === 'dist' || base === 'server') {
    return path.resolve(__dirnamePath, '..', '..');
  }
  return path.resolve(__dirnamePath, '..', '..');
}
