import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ThemeToggle } from "~/components/ThemeToggle";
import globalCss from "~/styles/global.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width" },
      { name: "color-scheme", content: "dark light" },
      { name: "theme-color", content: "#050505", id: "theme-color-meta" },
      {
        name: "description",
        content: "Structured prompts across topics — open ChatGPT with one click.",
      },
      { title: "100 prompts to understand anything" },
    ],
    links: [
      { rel: "stylesheet", href: globalCss },
      { rel: "icon", href: "/favicon.svg" },
    ],
    scripts: [
      {
        children: `(function(){try{var k='100pua-theme';var stored=localStorage.getItem(k);var t=stored==='light'||stored==='dark'?stored:typeof matchMedia!=='undefined'&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',t);}catch(_){document.documentElement.setAttribute('data-theme','dark');}})();`,
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full bg-void" data-theme="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-full bg-void font-mono text-text selection:bg-accent/20">
        <ThemeToggle />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
