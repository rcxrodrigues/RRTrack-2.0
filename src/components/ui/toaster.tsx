'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      position="bottom-center"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'flutuante !rounded-lg',
          title: '!text-sm !font-medium',
          description: '!text-muted-foreground !text-xs',
        },
      }}
    />
  );
}
