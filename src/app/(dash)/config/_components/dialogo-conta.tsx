'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { salvarConta } from '../actions';
import type { Conta, ConfigSecao } from './secao-contas';

export type TipoConta = 'ga4' | 'pixel' | 'ads';

export function DialogoConta({
  config,
  conta,
  aberto,
  onAbertoChange,
}: {
  config: ConfigSecao;
  conta: Conta | null;
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
}) {
  const [pendente, iniciar] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const editando = conta !== null;

  function enviar(formData: FormData) {
    setErro(null);
    iniciar(async () => {
      const r = await salvarConta(config.tipo, conta?.id ?? null, formData);
      if (r.ok) {
        toast.success(r.mensagem);
        onAbertoChange(false);
      } else {
        setErro(r.mensagem ?? 'Não consegui salvar.');
      }
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={onAbertoChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editando ? `Editar ${conta.label}` : `Adicionar em ${config.titulo}`}
          </DialogTitle>
          <DialogDescription>
            {editando
              ? 'O token só é substituído se você digitar um novo.'
              : 'O token é guardado cifrado e nunca mais aparece na tela.'}
          </DialogDescription>
        </DialogHeader>

        <form action={enviar} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${config.tipo}-label`}>Nome</Label>
            <Input
              id={`${config.tipo}-label`}
              name="label"
              defaultValue={conta?.label ?? ''}
              placeholder="Como você reconhece esta conta"
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${config.tipo}-id`}>{config.rotuloCampo}</Label>
            <Input
              id={`${config.tipo}-id`}
              name={config.campo}
              defaultValue={conta?.identificador ?? ''}
              placeholder={config.placeholderCampo}
              className="font-mono"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${config.tipo}-segredo`}>
              {config.rotuloSegredo}
              {editando && (
                <span className="text-muted-foreground ml-1 font-normal">
                  (deixe vazio para manter)
                </span>
              )}
            </Label>
            <Input
              id={`${config.tipo}-segredo`}
              name="segredo"
              type="password"
              autoComplete="off"
              placeholder={editando ? '••••••••' : 'Cole o token aqui'}
              className="font-mono"
              required={!editando}
            />
            <p className="text-muted-foreground text-xs">{config.ajudaSegredo}</p>
          </div>

          {erro && (
            <p role="alert" className="text-destructive-vivid text-sm">
              {erro}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { onAbertoChange(false); }}
              disabled={pendente}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? 'Salvando…' : editando ? 'Salvar' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
