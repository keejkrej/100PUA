import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type * as React from "react";

import { cn } from "~/lib/utils";

export function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive>): React.ReactElement {
  return (
    <ToggleGroupPrimitive
      className={cn(
        "inline-flex items-center rounded-lg border border-muted/40 bg-void/50 p-0.5 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Toggle({
  className,
  ...props
}: React.ComponentProps<typeof TogglePrimitive>): React.ReactElement {
  return (
    <TogglePrimitive
      className={cn(
        "rounded-md px-3 py-1 text-[11px] tracking-wide transition-colors outline-none data-pressed:bg-accent/15 data-pressed:font-medium data-pressed:text-accent text-muted hover:bg-muted/15 hover:text-text",
        className,
      )}
      {...props}
    />
  );
}
