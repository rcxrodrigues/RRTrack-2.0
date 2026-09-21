'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MOEDAS } from '@/lib/moedas';
import { CampoCopiavel } from './campo-copiavel';
import { gerarWebhookToken, salvarSettings } from '../actions';

export type Settings = {
  currency: string;
  test_event_code: string | null;
  cookie_domain: string | null;
  allowed_origins: string[];
  checkout_domains: string[];
  webhook_token_last4: string | null;
};

export function SecaoGeral({
  settings,
  urlDoWebhook,
}: {
  settings: Settings;
  urlDoWebhook: string;
}) {
  const [pendente, iniciar] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [tokenNovo, setTokenNovo] = React.useState<string | null>(null);

  function enviar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = await salvarSettings(formData);
      if (r.ok) toast.success(r.mensagem);
      else setErro(r.mensagem ?? 'Não consegui salvar.');
    });
  }

  function gerarToken() {
    const jaExiste = settings.webhook_token_last4 !== null;
    if (
      jaExiste &&
      !window.confirm(
        'Gerar um token novo invalida o atual. A plataforma de venda vai ' +
          'parar de entregar as compras até você atualizar a URL lá. Continuar?',
      )
    ) {
      return;
    }

    iniciar(async () => {
      const r = await gerarWebhookToken();
      if (r.ok && r.token) {
        setTokenNovo(r.token);
        toast.success(r.mensagem, { description: r.detalhe });
      } else {
        toast.error(r.mensagem ?? 'Não consegui gerar o token.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form action={enviar} className="flex flex-col gap-5 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight">Geral</h3>
            <p className="text-muted-foreground text-sm">
              Valem para todos os destinos configurados.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="currency">Moeda</Label>
              <Select name="currency" defaultValue={settings.currency}>
                <SelectTrigger id="currency">
                  <SelectValue placeholder="Escolha a moeda" />
                </SelectTrigger>
                <SelectContent>
                  {MOEDAS.map((moeda) => (
                    <SelectItem key={moeda.codigo} value={moeda.codigo}>
                      <span className="flex items-center gap-2">
                        <code className="font-mono text-xs">{moeda.codigo}</code>
                        <span className="text-muted-foreground">
                          {moeda.simbolo} · {moeda.nome}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Vai em toda conversão enviada à Meta e ao GA4.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="test_event_code">Código de teste da Meta</Label>
              <Input
                id="test_event_code"
                name="test_event_code"
                defaultValue={settings.test_event_code ?? ''}
                placeholder="TEST12345"
                className="font-mono"
              />
              <p className="text-muted-foreground text-xs">
                Só enquanto estiver validando: os eventos aparecem em Test
                Events e <strong>não</strong> contam como conversão.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cookie_domain">Domínio do cookie</Label>
            <Input
              id="cookie_domain"
              name="cookie_domain"
              defaultValue={settings.cookie_domain ?? ''}
              placeholder=".transforlar.com"
              className="font-mono"
            />
            <p className="text-muted-foreground text-xs">
              Com o ponto na frente, o mesmo cookie vale na landing page e
              aqui. É o que torna o visitante reconhecível entre os dois — e é
              cookie de primeira parte, que o Safari não descarta.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="allowed_origins">Origens autorizadas</Label>
            <Textarea
              id="allowed_origins"
              name="allowed_origins"
              defaultValue={settings.allowed_origins.join('\n')}
              placeholder={'https://transforlar.com\nhttps://www.transforlar.com'}
              className="font-mono text-xs"
              rows={4}
            />
            <p className="text-muted-foreground text-xs">
              Uma por linha. Só estes sites podem enviar eventos. Deixar vazio
              não libera geral — bloqueia todos.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="checkout_domains">Domínios do checkout</Label>
            <Textarea
              id="checkout_domains"
              name="checkout_domains"
              defaultValue={settings.checkout_domains.join('\n')}
              placeholder={'seguro.minhaloja.com\ncheckout.minhaloja.com'}
              className="font-mono text-xs"
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              Um por linha. O snippet pendura o identificador do visitante em
              todo link que aponte para estes domínios — é a ponte para o
              checkout, que é outro site e não recebe o cookie. Sem isso, a
              venda chega órfã e só casa por e-mail. Pode colar a URL inteira:
              eu fico com o domínio.
            </p>
          </div>

          {erro && (
            <p role="alert" className="text-destructive-vivid text-sm">
              {erro}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={pendente}>
              {pendente ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight">
              Webhook de compra
            </h3>
            <p className="text-muted-foreground text-sm">
              O endereço que você cadastra na Hotmart, Kiwify ou Eduzz. O token
              na URL é o que separa uma venda de verdade de um POST qualquer.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Status do token</Label>
            <div className="flex items-center gap-3">
              {settings.webhook_token_last4 ? (
                <span className="text-muted-foreground font-mono text-xs">
                  ••••••••{settings.webhook_token_last4}
                </span>
              ) : (
                <Badge variant="warning">ainda não gerado</Badge>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={gerarToken}
                disabled={pendente}
              >
                <RefreshCw className="size-4" />
                {settings.webhook_token_last4 ? 'Gerar novo' : 'Gerar token'}
              </Button>
            </div>
          </div>

          {tokenNovo && (
            <div className="border-warning/30 bg-warning/5 flex flex-col gap-2 rounded-md border p-3">
              <Label className="text-warning">
                Copie agora — não mostro de novo
              </Label>
              <CampoCopiavel
                valor={`${urlDoWebhook}?token=${tokenNovo}`}
                rotulo="URL do webhook"
              />
              <p className="text-muted-foreground text-xs">
                Cole esta URL inteira no painel da plataforma de venda.
              </p>
            </div>
          )}

          {!tokenNovo && settings.webhook_token_last4 && (
            <div className="flex flex-col gap-2">
              <Label>Endereço do webhook</Label>
              <CampoCopiavel valor={urlDoWebhook} rotulo="endereço do webhook" />
              <p className="text-muted-foreground text-xs">
                O token vai na URL, depois de <code>?token=</code>. Se você o
                perdeu, gere um novo — não há como recuperá-lo.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
