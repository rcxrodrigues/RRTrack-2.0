'use client';

import { createBrowserClient } from '@supabase/ssr';

import { envPublico } from '@/lib/env';

/**
 * Cliente do navegador. Usa a chave anônima — é a RLS que protege os dados,
 * não o segredo da chave.
 */
export function criarClienteNavegador() {
  const { url, anonKey } = envPublico();
  return createBrowserClient(url, anonKey);
}
