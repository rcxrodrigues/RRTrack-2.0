'use client';

import * as React from 'react';

/**
 * Um instante, em UTC no servidor e no fuso de quem olha no cliente.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ `toLocaleString` direto num componente que passa por SSR é armadilha: o  │
 * │ servidor roda em UTC (a Vercel roda) e o navegador no fuso de quem olha, │
 * │ então os dois produzem textos diferentes para a mesma linha e a          │
 * │ hidratação quebra.                                                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * `useSyncExternalStore` existe exatamente para isto: aceita um retrato do
 * SERVIDOR e outro do CLIENTE. O servidor entrega UTC, a hidratação casa, e o
 * cliente passa a mostrar o fuso local — sem `setState` em efeito, que
 * dispara render em cascata e o lint recusa.
 */

/** Determinístico: derivado do texto ISO, sem passar por `Date`. */
function emUtc(iso: string): string {
  const [data = '', resto = ''] = iso.split('T');
  const [, mes = '', dia = ''] = data.split('-');
  return `${dia}/${mes}, ${resto.slice(0, 8)} UTC`;
}

function formatarLocal(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function Quando({ iso }: { iso: string }) {
  const texto = React.useSyncExternalStore(
    // Nunca muda depois de montado: não há a que assinar.
    () => () => {},
    () => formatarLocal(iso),
    () => emUtc(iso),
  );

  return <>{texto}</>;
}
