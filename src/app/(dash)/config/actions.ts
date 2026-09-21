'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes } from 'node:crypto';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { usuarioAtual } from '@/lib/supabase/server';
import { testarContaDeAnuncio, testarPixel, type ResultadoTeste } from '@/lib/meta/testar';
import { testarGa4 } from '@/lib/ga4/testar';
import {
  adAccountSchema,
  ga4Schema,
  pixelSchema,
  settingsSchema,
} from './schemas';

export type Resultado = {
  ok: boolean;
  mensagem?: string;
  detalhe?: string;
};

/**
 * Toda action começa por aqui.
 *
 * Server Action é um endpoint HTTP como outro qualquer: o fato de só existir
 * um botão para ela na tela protegida não impede ninguém de chamá-la direto.
 * Quem autoriza é esta função, em toda chamada, sem exceção.
 */
async function exigirSessao(): Promise<{ id: string } | null> {
  return usuarioAtual();
}

function falha(mensagem: string, detalhe?: string): Resultado {
  return { ok: false, mensagem, detalhe };
}

function erroDeFormulario(erro: unknown): Resultado {
  if (erro instanceof Error) {
    // Erro de banco pode conter nome de coluna e constraint — informação
    // interna que não ajuda quem está preenchendo o formulário.
    console.error('[config] falha:', erro.message);
  }
  return falha('Não consegui salvar. Tente de novo.');
}

/** As três tabelas de conta compartilham a mesma forma. */
const TABELAS = {
  ga4: { tabela: 'ga4_accounts', rpc: 'set_ga4_secret' },
  pixel: { tabela: 'meta_pixels', rpc: 'set_meta_pixel_secret' },
  ads: { tabela: 'meta_ad_accounts', rpc: 'set_meta_ad_account_secret' },
} as const;

type TipoConta = keyof typeof TABELAS;

// ---------------------------------------------------------------------------
// Contas: criar, atualizar, ativar/desativar, remover
// ---------------------------------------------------------------------------

export async function salvarConta(
  tipo: TipoConta,
  id: string | null,
  formData: FormData,
): Promise<Resultado> {
  if (!(await exigirSessao())) return falha('Sessão expirada. Entre de novo.');

  const bruto = {
    label: formData.get('label'),
    measurement_id: formData.get('measurement_id'),
    pixel_id: formData.get('pixel_id'),
    ad_account_id: formData.get('ad_account_id'),
    segredo: formData.get('segredo'),
  };

  const schema =
    tipo === 'ga4' ? ga4Schema : tipo === 'pixel' ? pixelSchema : adAccountSchema;
  const analise = schema.safeParse(bruto);

  if (!analise.success) {
    return falha(analise.error.issues[0]?.message ?? 'Dados inválidos.');
  }

  const dados = analise.data;
  // `tabela` como string simples: o cliente é destipado (não geramos os
  // tipos do banco), e um union de literais faz a inferência do
  // supabase-js assumir uma forma que não corresponde a nenhuma das três.
  const tabela: string = TABELAS[tipo].tabela;
  const rpc: string = TABELAS[tipo].rpc;
  const supabase = criarClienteAdmin();

  // O segredo NUNCA vai junto no insert/update: ele entra pela função do
  // banco, que o guarda no cofre e devolve só o ponteiro.
  //
  // Os campos são montados um a um em vez de espalhados: cada tabela tem a
  // sua coluna de identificador, e o compilador não teria como saber qual
  // delas vale para o `tipo` recebido em tempo de execução.
  const segredo = dados.segredo;
  const campos: Record<string, string> = { label: dados.label };
  if ('measurement_id' in dados) campos.measurement_id = dados.measurement_id;
  if ('pixel_id' in dados) campos.pixel_id = dados.pixel_id;
  if ('ad_account_id' in dados) campos.ad_account_id = dados.ad_account_id;

  try {
    let contaId = id;

    if (contaId) {
      const { error } = await supabase.from(tabela).update(campos).eq('id', contaId);
      if (error) throw new Error(error.message);
    } else {
      if (!segredo) {
        return falha('Informe o token para cadastrar a conta.');
      }
      const { data, error } = await supabase
        .from(tabela)
        .insert(campos)
        .select('id')
        .single();
      if (error) throw new Error(error.message);

      // O cliente é destipado, então `id` chega como `unknown`: conferimos
      // em vez de afirmar.
      if (typeof data.id !== 'string') {
        throw new Error('o banco não devolveu o id da conta criada');
      }
      contaId = data.id;
    }

    if (segredo) {
      const { error } = await supabase.rpc(rpc, { p_id: contaId, p_secret: segredo });
      if (error) throw new Error(error.message);
    }

    revalidatePath('/config');
    return { ok: true, mensagem: id ? 'Conta atualizada' : 'Conta cadastrada' };
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : '';
    // Erro de unicidade tem mensagem própria: é o caso mais comum e o
    // usuário precisa saber o que fazer.
    if (msg.includes('duplicate key') || msg.includes('already exists')) {
      return falha('Já existe uma conta cadastrada com esse ID.');
    }
    return erroDeFormulario(erro);
  }
}

export async function alternarConta(
  tipo: TipoConta,
  id: string,
  ativo: boolean,
): Promise<Resultado> {
  if (!(await exigirSessao())) return falha('Sessão expirada. Entre de novo.');

  try {
    const { error } = await criarClienteAdmin()
      .from(TABELAS[tipo].tabela)
      .update({ is_active: ativo })
      .eq('id', id);
    if (error) throw new Error(error.message);

    revalidatePath('/config');
    return { ok: true, mensagem: ativo ? 'Conta ativada' : 'Conta desativada' };
  } catch (erro) {
    return erroDeFormulario(erro);
  }
}

export async function removerConta(tipo: TipoConta, id: string): Promise<Resultado> {
  if (!(await exigirSessao())) return falha('Sessão expirada. Entre de novo.');

  try {
    // O trigger no banco tira o segredo do cofre junto — não fica token
    // órfão para trás.
    const { error } = await criarClienteAdmin()
      .from(TABELAS[tipo].tabela)
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);

    revalidatePath('/config');
    return { ok: true, mensagem: 'Conta removida' };
  } catch (erro) {
    return erroDeFormulario(erro);
  }
}

// ---------------------------------------------------------------------------
// Testar conexão — bate na API de verdade
// ---------------------------------------------------------------------------

export async function testarConta(tipo: TipoConta, id: string): Promise<ResultadoTeste> {
  if (!(await exigirSessao())) {
    return { ok: false, mensagem: 'Sessão expirada. Entre de novo.' };
  }

  const supabase = criarClienteAdmin();

  // Rate limit mesmo com sessão: cada clique vira uma chamada à API externa,
  // e a Meta pune rajada com throttling da conta inteira.
  const { data: podeSeguir } = await supabase.rpc('check_rate_limit', {
    p_bucket: `testar:${tipo}:${id}`,
    p_limit: 10,
    p_window_seconds: 60,
  });

  if (podeSeguir === false) {
    return {
      ok: false,
      mensagem: 'Muitos testes seguidos',
      detalhe: 'Espere um minuto antes de testar de novo.',
    };
  }

  const { tabela } = TABELAS[tipo];
  const campoId =
    tipo === 'ga4' ? 'measurement_id' : tipo === 'pixel' ? 'pixel_id' : 'ad_account_id';

  const { data: conta, error } = await supabase
    .from(tabela)
    .select(campoId)
    .eq('id', id)
    // O nome da coluna só é conhecido em tempo de execução, então o
    // compilador não tem como estreitar o retorno sozinho.
    .returns<Record<string, unknown>[]>()
    .single();

  if (error || !conta) {
    return { ok: false, mensagem: 'Conta não encontrada' };
  }

  const rpcSegredo =
    tipo === 'ga4'
      ? 'get_ga4_secret'
      : tipo === 'pixel'
        ? 'get_meta_pixel_secret'
        : 'get_meta_ad_account_secret';

  const { data: segredo } = await supabase.rpc(rpcSegredo, { p_id: id });

  if (typeof segredo !== 'string' || segredo.length === 0) {
    return {
      ok: false,
      mensagem: 'Esta conta ainda não tem token',
      detalhe: 'Edite a conta e informe o token.',
    };
  }

  const valorDoCampo = conta[campoId];
  if (typeof valorDoCampo !== 'string' || valorDoCampo.length === 0) {
    return { ok: false, mensagem: 'A conta está sem identificador' };
  }
  const identificador = valorDoCampo;

  if (tipo === 'ga4') return testarGa4(identificador, segredo);
  if (tipo === 'pixel') return testarPixel(identificador, segredo);
  return testarContaDeAnuncio(identificador, segredo);
}

// ---------------------------------------------------------------------------
// Configurações gerais
// ---------------------------------------------------------------------------

export async function salvarSettings(formData: FormData): Promise<Resultado> {
  if (!(await exigirSessao())) return falha('Sessão expirada. Entre de novo.');

  const analise = settingsSchema.safeParse({
    currency: formData.get('currency'),
    test_event_code: formData.get('test_event_code'),
    cookie_domain: formData.get('cookie_domain'),
    allowed_origins: formData.get('allowed_origins'),
    checkout_domains: formData.get('checkout_domains'),
  });

  if (!analise.success) {
    return falha(analise.error.issues[0]?.message ?? 'Dados inválidos.');
  }

  try {
    const { error } = await criarClienteAdmin()
      .from('settings')
      .update({
        currency: analise.data.currency,
        test_event_code: analise.data.test_event_code || null,
        cookie_domain: analise.data.cookie_domain || null,
        allowed_origins: analise.data.allowed_origins,
        checkout_domains: analise.data.checkout_domains,
      })
      .eq('id', true);
    if (error) throw new Error(error.message);

    revalidatePath('/config');
    return { ok: true, mensagem: 'Configurações salvas' };
  } catch (erro) {
    return erroDeFormulario(erro);
  }
}

/**
 * Gera o token do webhook.
 *
 * Quem gera é o servidor, com `randomBytes`: um token digitado à mão tende a
 * ser curto e previsível, e este é o que separa uma venda de verdade de um
 * POST que qualquer um pode fazer na URL.
 *
 * Devolve o valor UMA vez, para ser copiado — depois só os últimos 4.
 */
export async function gerarWebhookToken(): Promise<Resultado & { token?: string }> {
  if (!(await exigirSessao())) return falha('Sessão expirada. Entre de novo.');

  const token = randomBytes(32).toString('base64url');

  try {
    const { error } = await criarClienteAdmin().rpc('set_webhook_token', {
      p_secret: token,
    });
    if (error) throw new Error(error.message);

    revalidatePath('/config');
    return {
      ok: true,
      mensagem: 'Token gerado',
      detalhe: 'Copie agora: ele não será mostrado de novo.',
      token,
    };
  } catch (erro) {
    return erroDeFormulario(erro);
  }
}
