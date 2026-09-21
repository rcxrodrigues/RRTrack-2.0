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

  if (!error) return { status: 'enviado' };

  // "Esse e-mail não tem conta" NÃO vira mensagem: é o que impede a tela de
  // virar um verificador de quem tem acesso. Já problema de infraestrutura
  // precisa aparecer, e dizendo o que fazer.
  const ehUsuarioInexistente =
    error.status === 400 || error.code === 'otp_disabled';

  if (ehUsuarioInexistente) return { status: 'enviado' };

  console.error(
    `[login] envio falhou — code=${error.code ?? '?'} status=${error.status ?? '?'}: ${error.message}`,
  );

  // O SMTP embutido do Supabase é para desenvolvimento e tem um limite
  // baixíssimo por hora. Vale dizer isso em vez de um "tente de novo" vago
  // que manda a pessoa bater na mesma porta.
  if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
    return {
      status: 'erro',
      mensagem:
        'Limite de e-mails do Supabase atingido. Espere alguns minutos — ' +
        'ou configure um SMTP próprio para deixar de depender do limite dele.',
    };
  }

  if (error.code === 'email_provider_disabled') {
    return {
      status: 'erro',
      mensagem:
        'O envio de e-mail está desligado no Supabase (Authentication → Sign In / Providers → Email).',
    };
  }

  if (error.code === 'validation_failed' || error.status === 422) {
    return {
      status: 'erro',
      mensagem:
        'O Supabase recusou o endereço de retorno. Confira se a URL está em ' +
        'Authentication → URL Configuration → Redirect URLs.',
    };
  }

  return {
    status: 'erro',
    mensagem: `Falha no envio (${error.code ?? error.status ?? 'erro'}). Veja os logs da Vercel para o detalhe.`,
  };
}

/** Encerra a sessão e devolve para a tela de login. */
export async function sair(): Promise<never> {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect('/login');
}
