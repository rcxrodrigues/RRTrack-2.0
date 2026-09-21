import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('resolve conflitos do Tailwind mantendo a última classe', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('descarta valores condicionais falsos', () => {
    const escondido = false as boolean;
    expect(cn('flex', escondido && 'hidden', undefined, 'gap-2')).toBe(
      'flex gap-2',
    );
  });
});
