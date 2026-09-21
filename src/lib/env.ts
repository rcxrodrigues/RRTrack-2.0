import { z } from 'zod';

/**
 * Validação das variáveis de ambiente.
 *
 * A checagem é PREGUIÇOSA de propósito: se fosse no topo do módulo, um build
 * sem as variáveis (a primeira build na Vercel, por exemplo) falharia com um
 * erro ilegível de import. Assim, o build passa e quem realmente precisa da
 * variável recebe uma mensagem que diz o que fazer.
 */

const urlSchema = z.url({ error: 'precisa ser uma URL válida' });
const chaveSchema = z
  .string()
  .min(20, { error: 'parece curta demais para uma chave do Supabase' });

function exigir(nome: string, valor: string | undefined, schema: z.ZodType<string>): string {
  const resultado = schema.safeParse(valor);

  if (!resultado.success) {
    const motivo = valor
      ? (resultado.error.issues[0]?.message ?? 'valor inválido')
      : 'não está definida';
    throw new Error(
      `Variável de ambiente ${nome}: ${motivo}. ` +
        'Copie o .env.example para .env.local e preencha com os dados do seu ' +
        'projeto Supabase (Project Settings → API Keys). Na Vercel, cadastre ' +
        'em Settings → Environment Variables.',
    );
  }

  return resultado.data;
}

/**
 * URL e chave pública do Supabase. Vão para o navegador — é por isso que toda
 * tabela tem RLS.
 *
 * As referências a `process.env.NEXT_PUBLIC_*` precisam ser literais: é assim
 * que o Next as substitui no bundle do cliente durante o build.
 */
export function envPublico(): { url: string; anonKey: string } {
  return {
    url: exigir('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL, urlSchema),
    anonKey: exigir(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      chaveSchema,
    ),
  };
}

/**
 * A chave que ignora RLS por completo.
 *
 * Só pode ser lida no servidor. Se este caminho for alcançado a partir do
 * navegador, é bug de segurança — e a função avisa em alto e bom som.
 */
export function envServiceRole(): string {
  if (typeof window !== 'undefined') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY foi acessada no navegador. Essa chave ignora ' +
        'RLS e nunca pode sair do servidor — mova a chamada para uma Server ' +
        'Action ou Route Handler.',
    );
  }

  return exigir('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY, chaveSchema);
}
