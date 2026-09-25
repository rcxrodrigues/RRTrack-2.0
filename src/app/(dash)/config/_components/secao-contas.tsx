'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { KeyRound, Pencil, Plug, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { alternarConta, removerConta, testarConta } from '../actions';
import { DialogoConta, type TipoConta } from './dialogo-conta';

export type Conta = {
  id: string;
  label: string;
  identificador: string;
  secret_last4: string | null;
  is_active: boolean;
};

export type ConfigSecao = {
  tipo: TipoConta;
  titulo: string;
  descricao: string;
  campo: string;
  rotuloCampo: string;
  placeholderCampo: string;
  rotuloSegredo: string;
  ajudaSegredo: string;
  vazio: string;
  /**
   * O token de cor da seção — `chart-1`, `chart-2`…
   *
   * Aqui a cor É informação: as três seções guardam credenciais de serviços
   * diferentes, e colar um token do GA4 no campo do pixel é um erro que não
   * dá mensagem nenhuma — o "Testar conexão" falha com um texto do lado de
   * lá, e o caminho até entender é longo. A faixa de cor responde antes de
   * a pessoa colar.
   *
   * Vêm dos `--chart-*` já validados, e não de matizes novos.
   */
  cor: string;
};

function Mascarado({ last4 }: { last4: string | null }) {
  if (!last4) {
    return (
      <Badge variant="warning">
        <KeyRound className="size-3" />
        sem token
      </Badge>
    );
  }
  return (
    <span className="text-muted-foreground font-mono text-xs">
      ••••••••{last4}
    </span>
  );
}

function LinhaConta({ conta, config }: { conta: Conta; config: ConfigSecao }) {
  const [pendente, iniciar] = React.useTransition();
  const [editando, setEditando] = React.useState(false);

  function testar() {
    iniciar(async () => {
      const r = await testarConta(config.tipo, conta.id);
      if (r.ok) toast.success(r.mensagem, { description: r.detalhe });
      else toast.error(r.mensagem, { description: r.detalhe });
    });
  }

  function alternar(ativo: boolean) {
    iniciar(async () => {
      const r = await alternarConta(config.tipo, conta.id, ativo);
      if (!r.ok) toast.error(r.mensagem);
    });
  }

  function remover() {
    // Remoção leva o token embora junto; melhor perguntar.
    if (!window.confirm(`Remover "${conta.label}"? O token também será apagado.`)) {
      return;
    }
    iniciar(async () => {
      const r = await removerConta(config.tipo, conta.id);
      if (r.ok) toast.success(r.mensagem);
      else toast.error(r.mensagem);
    });
  }

  return (
    <div
      data-pendente={pendente || undefined}
      className="border-border/60 flex flex-col gap-3 border-t px-4 py-3 transition-opacity data-[pendente]:opacity-50 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{conta.label}</span>
          {!conta.is_active && <Badge variant="muted">inativa</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground font-mono text-xs">
            {conta.identificador}
          </span>
          <Mascarado last4={conta.secret_last4} />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Switch
          checked={conta.is_active}
          onCheckedChange={alternar}
          disabled={pendente}
          aria-label={`${conta.is_active ? 'Desativar' : 'Ativar'} ${conta.label}`}
        />

        <Button
          variant="ghost"
          size="icon"
          onClick={testar}
          disabled={pendente}
          aria-label={`Testar conexão de ${conta.label}`}
          title="Testar conexão"
        >
          <Plug className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => { setEditando(true); }}
          disabled={pendente}
          aria-label={`Editar ${conta.label}`}
          title="Editar"
        >
          <Pencil className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={remover}
          disabled={pendente}
          aria-label={`Remover ${conta.label}`}
          title="Remover"
          className="hover:text-destructive-vivid"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <DialogoConta
        config={config}
        conta={conta}
        aberto={editando}
        onAbertoChange={setEditando}
      />
    </div>
  );
}

export function SecaoContas({
  config,
  contas,
  extra,
}: {
  config: ConfigSecao;
  contas: Conta[];
  /** Conteúdo extra no rodapé da seção — o código de teste, nos pixels. */
  extra?: React.ReactNode;
}) {
  const [criando, setCriando] = React.useState(false);

  return (
    <Card className="overflow-hidden">
      {/*
        A faixa de cor no topo, e não um badge colorido perdido no meio: ela
        marca a seção inteira, que é o que precisa ser distinguido. Colar um
        `api_secret` do GA4 no campo do token do pixel não dá mensagem
        nenhuma — o "Testar conexão" falha com um texto do lado de lá, e o
        caminho até entender é longo. A cor responde antes de a pessoa colar.
      */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: `hsl(var(--${config.cor}))` }}
        aria-hidden
      />
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-sm font-semibold tracking-tight">{config.titulo}</h3>
          <p className="text-muted-foreground text-sm">{config.descricao}</p>
        </div>

        <Button size="sm" onClick={() => { setCriando(true); }}>
          <Plus className="size-4" />
          Adicionar
        </Button>
      </div>

      {contas.length === 0 ? (
        <p className="text-muted-foreground border-border/60 border-t px-4 py-8 text-center text-sm sm:px-5">
          {config.vazio}
        </p>
      ) : (
        contas.map((conta) => (
          <LinhaConta key={conta.id} conta={conta} config={config} />
        ))
      )}

      <DialogoConta
        config={config}
        conta={null}
        aberto={criando}
        onAbertoChange={setCriando}
      />
      {extra}
    </Card>
  );
}
