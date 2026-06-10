import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '~/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-9 px-3',
        icon: 'size-10',
        sm: 'h-8 px-2.5 text-[11px]',
        xs: 'h-7 px-2 text-[11px]',
      },
      variant: {
        default:
          'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20',
        ghost:
          'border-transparent bg-transparent text-muted hover:bg-muted/15 hover:text-text',
        link: 'border-transparent bg-transparent text-muted underline decoration-transparent underline-offset-2 hover:text-accent hover:decoration-accent/60',
        outline:
          'border-muted/40 bg-surface/90 text-muted hover:border-accent/50 hover:text-accent',
        subtle:
          'border-muted/40 bg-void text-text hover:border-accent/50 hover:text-accent',
      },
    },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    render?: useRender.RenderProp;
  };

export function Button({
  className,
  variant,
  size,
  render,
  type = 'button',
  ...props
}: ButtonProps): React.ReactElement {
  return useRender({
    defaultTagName: 'button',
    props: {
      className: cn(buttonVariants({ className, size, variant })),
      type,
      ...props,
    },
    render,
  });
}
