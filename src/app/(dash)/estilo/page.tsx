import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MetricCard } from '@/components/dash/metric-card';
import {
  PaletaGraficos,
  PaletaSuperficies,
  PaletaTexto,
  TokenPrimaria,
} from './_paleta';

export const metadata: Metadata = { title: 'Estilo' };

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">{titulo}</h3>
          {descricao && (
            <p className="text-muted-foreground text-sm">{descricao}</p>
          )}
        </div>
        {children}
      </div>
    </Card>
  );
}

export default function EstiloPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight md:hidden">Estilo</h2>
        <p className="text-muted-foreground text-sm">
          Os tokens de verdade, lidos do CSS aplicado e medidos agora. Troque o
          tema no canto superior para comparar — os números mudam junto.
        </p>
      </div>

      <Secao
        titulo="A cor da marca"
        descricao="Azul extraído do logo: hsl(226 100% 50%), o tom dominante do arquivo."
      >
        <TokenPrimaria />
      </Secao>

      <Secao
        titulo="Cores de texto"
        descricao="Contraste contra o fundo da página. Texto normal precisa de 4.5:1."
      >
        <PaletaTexto />
      </Secao>

      <Secao
        titulo="Superfícies"
        descricao="Contraste entre a superfície e o texto que fica em cima dela."
      >
        <PaletaSuperficies />
      </Secao>

      <Secao
        titulo="Séries de gráfico"
        descricao="Validadas por ΔE em OKLab, não por contraste: azul e âmbar têm luminância parecida e mesmo assim ninguém os confunde."
      >
        <PaletaGraficos />
      </Secao>

      <Secao titulo="Métricas">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Com dado" value="1.284" />
          <MetricCard label="Ciano" value="R$ 41,90" accent="cyan" />
          <MetricCard label="Âmbar" value="3,42×" accent="amber" />
          <MetricCard label="Sem dado" value={null} />
        </div>
        <p className="text-muted-foreground text-xs">
          Números em Inter com numerais tabulares: a largura não muda quando o
          valor atualiza. Sem dado mostra um travessão, nunca zero.
        </p>
      </Secao>

      <Secao titulo="Botões">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primário</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="outline">Contorno</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button variant="destructive">Destrutivo</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Desativado</Button>
        </div>
      </Secao>

      <Secao titulo="Etiquetas e controles">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>padrão</Badge>
          <Badge variant="muted">neutra</Badge>
          <Badge variant="success">sucesso</Badge>
          <Badge variant="warning">atenção</Badge>
          <Badge variant="destructive">erro</Badge>
          <Switch defaultChecked aria-label="Exemplo ligado" />
          <Switch aria-label="Exemplo desligado" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="exemplo">Campo normal</Label>
            <Input id="exemplo" placeholder="voce@exemplo.com" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="exemplo-erro">Campo com erro</Label>
            <Input id="exemplo-erro" defaultValue="valor inválido" aria-invalid />
            <p className="text-destructive-vivid text-sm">Mensagem de erro.</p>
          </div>
        </div>
      </Secao>

      <Secao titulo="Tipografia">
        <div className="flex flex-col gap-3">
          <p className="text-2xl font-semibold tracking-tight">
            Inter — títulos e texto
          </p>
          <p className="text-sm">
            O corpo do texto fica na Inter, desenhada para tela e legível em
            tamanho pequeno.
          </p>
          <p className="tabular text-sm">
            Números tabulares: 1.284 · 4.902 · R$ 197,00 · 3,42×
          </p>
          <p className="font-mono text-sm">
            JetBrains Mono: id, token e JSON — 8f2a-41c9 · G-XXXXXXX
          </p>
          <p className="text-muted-foreground text-xs">
            Texto auxiliar, no menor tamanho que usamos.
          </p>
        </div>
      </Secao>
    </div>
  );
}
