'use client';

import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { salvarTestEventCode } from '../actions';

/**
 * O código de teste da Meta — junto dos pixels, porque é deles que ele fala.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O AVISO NÃO É DECORAÇÃO.                                                 │
 * │                                                                          │
 * │ Esquecido preenchido em produção, este código manda TODA conversão para  │
 * │ Test Events, onde ela não conta. O otimizador da Meta para de aprender e │
 * │ a campanha morre sem ninguém entender por quê — e nada na tela da Meta   │
 * │ grita, porque do ponto de vista dela está tudo funcionando.              │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function CodigoDeTeste({ atual }: { atual: string | null }) {
  const [enviando, iniciar] = React.useTransition();

  function enviar(formData: FormData) {
    iniciar(async () => {
      const r = await salvarTestEventCode(formData);
      if (r.ok) toast.success(r.mensagem);
      else toast.error(r.mensagem);
    });
  }

  return (
    <form
      action={enviar}
      className="border-border/60 flex flex-col gap-2 border-t px-4 py-4 sm:px-5"
    >
      <Label htmlFor="test_event_code">Código de teste da Meta</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="test_event_code"
          name="test_event_code"
          defaultValue={atual ?? ''}
          placeholder="TEST12345"
          className="max-w-56 font-mono"
        />
        <Button type="submit" variant="secondary" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
      {atual ? (
        <p className="text-warning text-xs">
          <strong>Está ligado.</strong> Enquanto este código estiver
          preenchido, TODA conversão vai para Test Events e{' '}
          <strong>não conta</strong> — o otimizador da Meta não aprende com
          elas. Apague quando terminar de validar.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Só enquanto estiver validando: os eventos aparecem em Test Events e
          não contam como conversão. Vazio é o certo em produção.
        </p>
      )}
    </form>
  );
}
