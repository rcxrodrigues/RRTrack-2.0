'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { caminhoInterno } from '@/lib/rotas';
import { criarClienteServidor } from '@/lib/supabase/server';

const emailSchema = z.email({ error: 'Digite um e-mail válido.' });

export type EstadoLogin = {
  status: 'inicial' | 'enviado' | 'erro';
  mensagem?: string;
};

/**
 * Envia o link de acesso por e-mail.
 *
 * Duas decisões de segurança aqui:
 *
 * 1. `shouldCreateUser: false` — sem isso, qualquer pessoa que digitasse um
 *    e-mail ganharia uma conta. É a trava de cadastro no código, somada à de
 *    desligar o signup no painel do Supabase. Duas portas, as duas fechadas.
 *
 * 2. A resposta é a MESMA existindo ou não o e-mail. Mensagens diferentes
 *    transformariam esta tela num verificador de "quem tem conta aqui".
 */
export async function enviarLinkDeAcesso(
  _anterior: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const email = emailSchema.safeParse(formData.get('email'));

  if (!email.success) {
    return {
      status: 'erro',
      mensagem: email.error.issues[0]?.message ?? 'E-mail inválido.',
    };
  }

  const proximo = caminhoInterno(formData.get('proximo'));

  const cabecalhos = await headers();
  const host = cabecalhos.get('host');
  const protocolo = cabecalhos.get('x-forwarded-proto') ?? 'https';
  const origem = `${protocolo}://${host}`;

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origem}/auth/callback?proximo=${encodeURIComponent(proximo)}`,
    },
  });

  // Erro de configuração merece aparecer; "esse e-mail não tem conta" não.
  if (error && error.status !== 400 && error.code !== 'otp_disabled') {
    console.error('[login] falha ao enviar link:', error.message);
    return {
      status: 'erro',
      mensagem: 'Não consegui enviar o e-mail agora. Tente de novo em instantes.',
    };
  }

  return { status: 'enviado' };
}

/** Encerra a sessão e devolve para a tela de login. */
export async function sair(): Promise<never> {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect('/login');
}
