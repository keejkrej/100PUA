"use client";

import { Atom } from "@effect-atom/atom-react";
import type { ReactNode } from "react";

import { AppApiClient } from "~/lib/api-client";

let layerRegistered = false;

function ensureApiLayer() {
  if (layerRegistered) return;
  Atom.runtime.addGlobalLayer(AppApiClient.layer);
  layerRegistered = true;
}

ensureApiLayer();

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
