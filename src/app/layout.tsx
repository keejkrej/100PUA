import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "~/components/Providers";
import { ThemeToggle } from "~/components/ThemeToggle";
import "~/styles/global.css";

const themeScript = `(function(){try{var k='100pua-theme';var stored=localStorage.getItem(k);var t=stored==='light'||stored==='dark'?stored:typeof matchMedia!=='undefined'&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',t);}catch(_){document.documentElement.setAttribute('data-theme','dark');}})();`;

export const metadata: Metadata = {
  title: {
    default: "100 prompts to understand anything",
    template: "%s · 100PUA",
  },
  description: "Structured prompts across topics — open ChatGPT with one click.",
  icons: { icon: "/favicon.svg" },
  other: { "color-scheme": "dark light" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full bg-void" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#050505" id="theme-color-meta" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-void font-mono text-text selection:bg-accent/20">
        <Providers>
          <ThemeToggle />
          {children}
        </Providers>
      </body>
    </html>
  );
}
