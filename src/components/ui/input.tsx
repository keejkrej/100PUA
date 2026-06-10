import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "~/lib/utils";

export type InputProps = React.ComponentProps<typeof InputPrimitive>;

export function Input({ className, ...props }: InputProps): React.ReactElement {
  return (
    <InputPrimitive
      className={cn(
        "h-9 w-full rounded-lg border border-muted/40 bg-void px-3 text-sm text-text outline-none transition-shadow placeholder:text-muted focus:border-accent/50 focus:ring-2 focus:ring-accent/30",
        className,
      )}
      {...props}
    />
  );
}
