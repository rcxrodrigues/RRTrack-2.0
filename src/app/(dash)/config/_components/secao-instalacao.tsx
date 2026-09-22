import { AlertTriangle, Check, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { CampoCopiavel } from './campo-copiavel';

export type EstadoInstalacao = {
  origensPermitidas: string[];
  cookieDomain: string | null;
  dominiosCheckout: string[];
  quantidadePixels: number;
  quantidadeGa4: number;
};

/**
 * Um item da lista de pré-requisitos.
 *
 * O snippet só funciona se a configuração estiver completa, e cada peça que
 * falta falha de um jeito diferente e silencioso: sem origem, a chamada toma
 * CORS; sem domínio de cookie, o visitante não é reconhecido entre a LP e o
 * painel. Melhor dizer o que falta do que deixar descobrir pelo console.
 */
function Requisito({
  pronto,
  titulo,
  faltando,
}: {
  pronto: boolean;
  titulo: string;
  faltando: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      {pronto ? (
        <Check className="text-primary-vivid mt-0.5 size-4 shrink-0" />
      ) : (
        <X className="text-destructive-vivid mt-0.5 size-4 shrink-0" />
      )}
      <span className="text-sm">
        {titulo}
        {!pronto && (
          <span className="text-muted-foreground block text-xs">{faltando}</span>
        )}
      </span>
    </li>
  );
}

export function SecaoInstalacao({
  base,
  estado,
}: {
  base: string;
  estado: EstadoInstalacao;
}) {
  const tag = `<script src="${base}/t.js" async></script>`;

  const temOrigem = estado.origensPermitidas.length > 0;
  const temCookie = estado.cookieDomain !== null;
  const temDestino = estado.quantidadePixels + estado.quantidadeGa4 > 0;
  const temCheckout = estado.dominiosCheckout.length > 0;
  const tudoPronto = temOrigem && temCookie && temDestino && temCheckout;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight">
                O código do site
              </h3>
              {tudoPronto ? (
                <Badge variant="success">pronto para instalar</Badge>
              ) : (
                <Badge variant="warning">falta configurar</Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Cole antes do <code>&lt;/head&gt;</code> da landing page. Ele já
              sai com os seus pixels e propriedades embutidos — cadastrar um
              novo aqui chega ao site sozinho, sem mexer no código de novo.
            </p>
          </div>

          <CampoCopiavel valor={tag} rotulo="tag do snippet" multilinha />

          <ul className="flex flex-col gap-2.5">
            <Requisito
              pronto={temOrigem}
              titulo="Origem autorizada cadastrada"
              faltando="Sem isso a landing page toma CORS e nada é gravado. Aba Geral → Origens autorizadas."
            />
            <Requisito
              pronto={temCookie}
              titulo="Domínio do cookie definido"
              faltando="Sem isso o visitante não é reconhecido entre a landing page e o painel. Aba Geral → Domínio do cookie."
            />
            <Requisito
              pronto={temCheckout}
              titulo="Domínio do checkout cadastrado"
              faltando="Sem isso o identificador não atravessa para o checkout e a venda chega órfã. Aba Geral → Domínios do checkout."
            />
            <Requisito
              pronto={temDestino}
              titulo="Ao menos um destino ativo"
              faltando="Os eventos são gravados, mas não vão para lugar nenhum. Cadastre um pixel ou uma propriedade do GA4."
            />
          </ul>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight">
              A ponte para o checkout
            </h3>
            <p className="text-muted-foreground text-sm">
              O checkout é outro site, então o cookie não chega lá. O
              identificador viaja na <strong>URL</strong> — é isso que faz a
              venda voltar casada com quem a originou.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Automático</Label>
            <p className="text-muted-foreground text-sm">
              O snippet varre a página e marca sozinho todo link que aponte
              para um dos domínios cadastrados em <strong>Geral → Domínios do
              checkout</strong>, e também os de WhatsApp. Nos links de WhatsApp
              o identificador entra no <em>texto</em> da mensagem, que é o que
              chega para quem atende.
            </p>
            {temCheckout ? (
              <ul className="flex flex-col gap-1">
                {estado.dominiosCheckout.map((entrada) => {
                  const [dominio = '', parametro = ''] = entrada.split('|');
                  return (
                    <li key={entrada} className="font-mono text-xs">
                      <span className="text-muted-foreground">{dominio}</span>
                      <span className="text-muted-foreground"> → </span>
                      {/* O nome do parâmetro é o que decide se a ponte
                          funciona: mandar o errado não dá erro, o checkout
                          só ignora. Por isso ele aparece, não fica
                          escondido no cadastro. */}
                      <span>?{parametro || 'trck_user_id'}=</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-destructive-vivid text-xs">
                Nenhum domínio cadastrado — nenhum link está sendo marcado.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Se o link for montado por JavaScript</Label>
            <p className="text-muted-foreground text-sm">
              Um botão que monta a URL na hora do clique aparece depois da
              varredura. Nesse caso, pegue o identificador e pendure você
              mesmo, ou mande varrer de novo:
            </p>
            <CampoCopiavel
              valor={
                "rrtrack.marcarLinks();            // varre a página de novo\n" +
                "var id = rrtrack.id();            // o identificador da visita"
              }
              rotulo="exemplo de marcação manual"
              multilinha
            />
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold tracking-tight">
              Disparar eventos
            </h3>
            <p className="text-muted-foreground text-sm">
              O <code>PageView</code> sai sozinho. Os outros você dispara onde
              fizer sentido — o mesmo <code>event_id</code> vai para o Pixel no
              navegador e para a Conversions API no servidor, e é isso que
              impede a conversão de contar em dobro.
            </p>
          </div>

          <CampoCopiavel
            valor={
              "rrtrack.track('InitiateCheckout', { value: 197, currency: 'BRL' });\n" +
              "rrtrack.track('Lead');\n\n" +
              "// Quando o site souber quem é a pessoa (formulário, área logada):\n" +
              "rrtrack.identify({ email: 'pessoa@exemplo.com', phone: '11988887777' });"
            }
            rotulo="exemplos de eventos"
            multilinha
          />

          <div className="border-warning/30 bg-warning/5 flex items-start gap-2.5 rounded-md border p-3">
            <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
            <p className="text-muted-foreground text-xs">
              Se a landing page já tiver o Pixel ou a gtag instalados por fora,
              tire-os. O snippet carrega os dois com os ids cadastrados aqui, e
              duas instalações do mesmo pixel contam cada evento duas vezes.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
