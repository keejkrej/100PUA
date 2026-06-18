import path from "node:path";
import { fileURLToPath } from "node:url";

import { Context, Effect, Layer } from "effect";

const __dirnamePath = path.dirname(fileURLToPath(import.meta.url));

/** Repo root when running from source, Nitro `.output`, or Next.js with external packages. */
export function resolveProjectRoot(fromDir: string): string {
  const base = path.basename(fromDir);
  if (base === "dist" || base === "server") {
    return path.resolve(fromDir, "..", "..");
  }
  return path.resolve(fromDir, "..", "..");
}

export class ProjectRoot extends Context.Tag("@100pua/ProjectRoot")<ProjectRoot, string>() {}

export const ProjectRootLive = Layer.sync(ProjectRoot, () => resolveProjectRoot(__dirnamePath));

export const projectRootEffect = Effect.map(ProjectRoot, (root) => root);
