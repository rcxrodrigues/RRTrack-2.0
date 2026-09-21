import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-primary/12 text-primary ring-primary/20 ring-1',
        muted: 'bg-muted text-muted-foreground ring-border ring-1',
        success: 'bg-success/12 text-success ring-success/20 ring-1',
        warning: 'bg-warning/12 text-warning ring-warning/25 ring-1',
        destructive: 'bg-destructive/12 text-destructive ring-destructive/25 ring-1',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
