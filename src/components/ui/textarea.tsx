import type * as React from 'react';

import { cn } from '~/lib/utils';

export type TextareaProps = React.ComponentProps<'textarea'>;

export function Textarea({
  className,
  ...props
}: TextareaProps): React.ReactElement {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full resize-y rounded-lg border border-muted/40 bg-void px-3 py-2 text-sm text-text outline-none transition-shadow placeholder:text-muted focus:border-accent/50 focus:ring-2 focus:ring-accent/30',
        className,
      )}
      {...props}
    />
  );
}
