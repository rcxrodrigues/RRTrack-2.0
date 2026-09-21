import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { criarClienteServidor } from '@/lib/supabase/server';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SecaoContas, type Conta, type ConfigSecao } from './_components/secao-contas';
import { SecaoGeral, type Settings } from './_components/secao-geral';

export const metadata: Metadata = { title: 'Configuração' };

/** O formato que o PostgREST devolve para as três tabelas de conta. */
type LinhaConta = {
  id: string;
  label: string;
  secret_last4: string | null;
  is_active: boolean;
} & Record<string, unknown>;

/** Converte a linha do banco no formato que a tela usa. */
function paraContas(linhas: LinhaConta[] | null, campo: string): Conta[] {
  return (linhas ?? []).map((l) => ({
    id: l.id,
    label: l.label,
    identificador: typeof l[campo] === 'string' ? l[campo] : '',
    secret_last4: l.secret_last4,
    is_active: l.is_active,
  }));
}

const SETTINGS_PADRAO: Settings = {
  currency: 'BRL',
  test_event_code: null,
  cookie_domain: null,
  allowed_origins: [],
  webhook_token_last4: null,
};

/**
 * A leitura usa o cliente do USUÁRIO, não o service_role: as colunas de
 * segredo foram revogadas para `authenticated` no banco, então mesmo um bug
 * aqui não conseguiria trazer um token para a tela. A escrita é que passa
 * pelo service_role, nas Server Actions.
 */
async function carregar() {
  const supabase = await criarClienteServidor();

  const [settings, ga4, pixels, ads] = await Promise.all([
    supabase
      .from('settings')
      .select('currency, test_event_code, cookie_domain, allowed_origins, webhook_token_last4')
      .eq('id', true)
      .returns<Settings[]>()
      .single(),
    supabase
      .from('ga4_accounts')
      .select('id, label, measurement_id, secret_last4, is_active')
      .order('created_at', { ascending: true })
      .returns<LinhaConta[]>(),
    supabase
      .from('meta_pixels')
      .select('id, label, pixel_id, secret_last4, is_active')
      .order('created_at', { ascending: true })
      .returns<LinhaConta[]>(),
    supabase
      .from('meta_ad_accounts')
      .select('id, label, ad_account_id, secret_last4, is_active')
      .order('created_at', { ascending: true })
      .returns<LinhaConta[]>(),
  ]);

  return {
    settings: settings.data ?? SETTINGS_PADRAO,
    ga4: paraContas(ga4.data, 'measurement_id'),
    pixels: paraContas(pixels.data, 'pixel_id'),
    ads: paraContas(ads.data, 'ad_account_id'),
  };
}

const SECAO_PIXELS: ConfigSecao = {
  tipo: 'pixel',
  titulo: 'Pixels da Meta',
  descricao:
    'Cada evento é enviado para TODOS os pixels ativos, pela Conversions API.',
  campo: 'pixel_id',
  rotuloCampo: 'ID do Pixel',
  placeholderCampo: '1234567890123456',
  rotuloSegredo: 'Token da Conversions API',
  ajudaSegredo:
    'Events Manager → seu pixel → Configurações → Conversions API → Gerar token de acesso.',
  vazio: 'Nenhum pixel cadastrado. Sem pixel, nada é enviado para a Meta.',
};

const SECAO_GA4: ConfigSecao = {
  tipo: 'ga4',
  titulo: 'Propriedades do GA4',
  descricao:
    'A gtag.js é carregada no site com estes IDs. A compra do webhook vai pelo Measurement Protocol.',
  campo: 'measurement_id',
  rotuloCampo: 'Measurement ID',
  placeholderCampo: 'G-XXXXXXXXXX',
  rotuloSegredo: 'API Secret',
  ajudaSegredo:
    'GA4 → Admin → Fluxos de dados → seu fluxo → Segredos da API do Measurement Protocol.',
  vazio: 'Nenhuma propriedade cadastrada.',
};

const SECAO_ADS: ConfigSecao = {
  tipo: 'ads',
  titulo: 'Contas de anúncio',
  descricao:
    'De onde vem o gasto de mídia que a tela de Campanhas cruza com a receita.',
  campo: 'ad_account_id',
  rotuloCampo: 'ID da conta',
  placeholderCampo: '1234567890 (com ou sem act_)',
  rotuloSegredo: 'Token de acesso do Ads',
  ajudaSegredo:
    'Precisa da permissão ads_read. Gerado no Business Manager ou no Graph API Explorer.',
  vazio: 'Nenhuma conta cadastrada. Sem ela, não há ROAS.',
};

export default async function ConfigPage() {
  const { settings, ga4, pixels, ads } = await carregar();

  // O endereço do webhook é este site — montado a partir do host da
  // requisição, para acertar tanto em localhost quanto em produção.
  const cabecalhos = await headers();
  const host = cabecalhos.get('x-forwarded-host') ?? cabecalhos.get('host') ?? '';
  const protocolo = host.startsWith('localhost') ? 'http' : 'https';
  const urlDoWebhook = `${protocolo}://${host}/api/webhook/compra`;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <h2 className="text-lg font-semibold tracking-tight md:hidden">Configuração</h2>

      <Tabs defaultValue="geral" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="meta">
            Meta
            {pixels.length > 0 && (
              <span className="text-muted-foreground font-mono text-xs">
                {pixels.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="ga4">
            GA4
            {ga4.length > 0 && (
              <span className="text-muted-foreground font-mono text-xs">
                {ga4.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="ads">
            Anúncios
            {ads.length > 0 && (
              <span className="text-muted-foreground font-mono text-xs">
                {ads.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="geral">
          <SecaoGeral settings={settings} urlDoWebhook={urlDoWebhook} />
        </TabsContent>

        <TabsContent value="meta">
          <SecaoContas config={SECAO_PIXELS} contas={pixels} />
        </TabsContent>

        <TabsContent value="ga4">
          <SecaoContas config={SECAO_GA4} contas={ga4} />
        </TabsContent>

        <TabsContent value="ads">
          <SecaoContas config={SECAO_ADS} contas={ads} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
