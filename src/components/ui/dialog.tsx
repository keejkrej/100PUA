import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type * as React from 'react';

import { buttonVariants } from '~/components/ui/button';
import { cn } from '~/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogBackdrop({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Backdrop>): React.ReactElement {
  return (
    <DialogPrimitive.Backdrop
      className={cn('fixed inset-0 z-[100] bg-black/50 backdrop-blur-[1px]', className)}
      {...props}
    />
  );
}

export function DialogPopup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>): React.ReactElement {
  return (
    <DialogPrimitive.Portal>
      <DialogBackdrop />
      <DialogPrimitive.Popup
        className={cn(
          'fixed top-1/2 left-1/2 z-[101] flex max-h-[calc(100vh-2rem)] w-[min(100%,28rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-muted/40 bg-surface p-6 text-text shadow-xl outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.ReactElement {
  return (
    <div
      className={cn('mb-4 flex items-start justify-between gap-3', className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>): React.ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn('text-sm font-medium leading-snug tracking-tight text-text', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<'p'>): React.ReactElement {
  return (
    <p className={cn('text-[11px] leading-relaxed text-muted', className)} {...props} />
  );
}

export function DialogCloseButton({
  className,
  ...props
}: React.ComponentProps<typeof DialogClose>): React.ReactElement {
  return (
    <DialogClose
      type="button"
      aria-label="Close"
      className={cn(
        buttonVariants({ className, size: 'xs', variant: 'ghost' }),
        '-mr-1 -mt-1 text-lg leading-none',
      )}
      {...props}
    >
      ×
    </DialogClose>
  );
}
