/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_REPO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "katex/contrib/auto-render" {
  import type { KatexOptions } from "katex";

  export default function renderMathInElement(
    element: HTMLElement,
    options?: KatexOptions & {
      delimiters?: Array<{
        left: string;
        right: string;
        display: boolean;
      }>;
      ignoredClasses?: string[];
    },
  ): void;
}
