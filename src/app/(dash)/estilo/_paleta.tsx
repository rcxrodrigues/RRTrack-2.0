'use client';

import * as React from 'react';

import {
  contraste,
  deltaE,
  lerHsl,
  nivelWcag,
  paraHex,
  type HSL,
} from '@/lib/contraste';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Lê os tokens REAIS aplicados no documento e mede o contraste na hora.
 *
 * Não há valor copiado aqui: se alguém mudar uma cor no globals.css, esta
 * tela mostra o novo número no próximo carregamento. Uma tabela escrita à
 * mão envelheceria em silêncio — e foi exatamente assim que um contraste
 * abaixo do mínimo passou despercebido uma vez.
 */
function useToken(nome: string): HSL | null {
  const [cor, setCor] = React.useState<HSL | null>(null);

  React.useEffect(() => {
    const ler = () => {
      const bruto = getComputedStyle(document.documentElement)
        .getPropertyValue(`--${nome}`)
        .trim();
      setCor(lerHsl(bruto));
    };
    ler();

    // O tema troca a classe do <html>; relemos quando isso acontece.
    const observador = new MutationObserver(ler);
    observador.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => { observador.disconnect(); };
  }, [nome]);

  return cor;
}

function useTokens(nomes: string[]): Map<string, HSL> {
  const [mapa, setMapa] = React.useState<Map<string, HSL>>(new Map());
  const chave = nomes.join(',');

  React.useEffect(() => {
    const ler = () => {
      const estilo = getComputedStyle(document.documentElement);
      const novo = new Map<string, HSL>();
      for (const nome of chave.split(',')) {
        const cor = lerHsl(estilo.getPropertyValue(`--${nome}`).trim());
        if (cor) novo.set(nome, cor);
      }
      setMapa(novo);
    };
    ler();
    const observador = new MutationObserver(ler);
    observador.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => { observador.disconnect(); };
  }, [chave]);

  return mapa;
}

function Amostra({
  nome,
  cor,
  fundo,
  papel,
}: {
  nome: string;
  cor: HSL;
  fundo: HSL | null;
  papel: 'texto' | 'superficie';
}) {
  const razao = fundo ? contraste(cor, fundo) : null;
  const nivel = razao !== null ? nivelWcag(razao) : null;

  return (
    <div className="border-border/60 flex items-center gap-3 border-t py-2.5 first:border-t-0">
      <span
        className="ring-border size-9 shrink-0 rounded-md ring-1"
        style={{ backgroundColor: `hsl(${cor.h} ${cor.s}% ${cor.l}%)` }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <code className="truncate text-xs font-medium">--{nome}</code>
        <code className="text-muted-foreground font-mono text-[11px]">
          {cor.h} {cor.s}% {cor.l}% · {paraHex(cor)}
        </code>
      </div>

      {razao !== null && nivel && (
        <div className="flex shrink-0 items-center gap-2">
          <code className="tabular font-mono text-xs">{razao.toFixed(2)}:1</code>
          <Badge variant={nivel.variante}>{nivel.rotulo}</Badge>
        </div>
      )}

      <span className="text-muted-foreground hidden w-20 shrink-0 text-right text-[11px] sm:inline">
        {papel === 'texto' ? 'vs fundo' : 'vs texto'}
      </span>
    </div>
  );
}

const CORES_DE_TEXTO = [
  'foreground',
  'muted-foreground',
  'primary-vivid',
  'destructive-vivid',
  'cyan',
  'amber',
  'success',
  'warning',
];

const SUPERFICIES: [string, string][] = [
  ['primary', 'primary-foreground'],
  ['destructive', 'destructive-foreground'],
  ['cyan', 'cyan-foreground'],
  ['amber', 'amber-foreground'],
  ['secondary', 'secondary-foreground'],
  ['card', 'card-foreground'],
];

export function PaletaTexto() {
  const tokens = useTokens([...CORES_DE_TEXTO, 'background']);
  const fundo = tokens.get('background') ?? null;

  return (
    <div className="flex flex-col">
      {CORES_DE_TEXTO.map((nome) => {
        const cor = tokens.get(nome);
        return cor ? (
          <Amostra key={nome} nome={nome} cor={cor} fundo={fundo} papel="texto" />
        ) : null;
      })}
    </div>
  );
}

export function PaletaSuperficies() {
  const tokens = useTokens(SUPERFICIES.flat());

  return (
    <div className="flex flex-col">
      {SUPERFICIES.map(([superficie, texto]) => {
        const s = tokens.get(superficie);
        const t = tokens.get(texto);
        if (!s || !t) return null;
        return (
          <Amostra
            key={superficie}
            nome={superficie}
            cor={s}
            fundo={t}
            papel="superficie"
          />
        );
      })}
    </div>
  );
}

const CHART = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'];

export function PaletaGraficos() {
  const tokens = useTokens([...CHART, 'background']);
  const cores = CHART.map((n) => tokens.get(n)).filter((c): c is HSL => c !== undefined);
  const fundo = tokens.get('background') ?? null;

  if (cores.length !== CHART.length) return null;

  // O par mais parecido é o que decide se a paleta serve.
  let pior = { i: 0, j: 1, d: Infinity };
  for (let i = 0; i < cores.length; i += 1) {
    for (let j = i + 1; j < cores.length; j += 1) {
      const d = deltaE(cores[i]!, cores[j]!);
      if (d < pior.d) pior = { i, j, d };
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {cores.map((cor, i) => (
          <div key={CHART[i]} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              className="ring-border h-12 rounded-md ring-1"
              style={{ backgroundColor: `hsl(${cor.h} ${cor.s}% ${cor.l}%)` }}
            />
            <code className="text-muted-foreground truncate font-mono text-[10px]">
              {paraHex(cor)}
            </code>
            {fundo && (
              <code className="text-muted-foreground tabular font-mono text-[10px]">
                {contraste(cor, fundo).toFixed(1)}:1
              </code>
            )}
          </div>
        ))}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <span>Par mais parecido:</span>
        <code className="font-mono">
          {CHART[pior.i]} ↔ {CHART[pior.j]}
        </code>
        <Badge variant={pior.d >= 15 ? 'success' : 'destructive'}>
          ΔE {pior.d.toFixed(1)}
        </Badge>
        <span className={cn(pior.d >= 15 ? 'text-muted-foreground' : 'text-destructive-vivid')}>
          {pior.d >= 15
            ? 'acima do piso de 15 para visão normal'
            : 'ABAIXO do piso de 15 — as séries se confundem'}
        </span>
      </div>
    </div>
  );
}

export function TokenPrimaria() {
  const primary = useToken('primary');
  const vivid = useToken('primary-vivid');
  const fundo = useToken('background');
  const branco = useToken('primary-foreground');

  if (!primary || !vivid || !fundo || !branco) return null;

  const superficieComTexto = contraste(primary, branco);
  const vividNoFundo = contraste(vivid, fundo);
  const superficieNoFundo = contraste(primary, fundo);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        A cor da marca tem dois papéis com exigências opostas, e nenhum tom
        único atende aos dois. Por isso são dois tokens:
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="ring-border flex flex-col gap-2 rounded-lg p-3 ring-1">
          <code className="text-xs font-medium">--primary</code>
          <button
            type="button"
            className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-sm font-medium"
          >
            Fundo de botão
          </button>
          <span className="text-muted-foreground text-xs">
            com o texto em cima:{' '}
            <code className="tabular font-mono">{superficieComTexto.toFixed(2)}:1</code>
          </span>
          <span className="text-muted-foreground text-xs">
            como texto no fundo:{' '}
            <code className="tabular text-destructive-vivid font-mono">
              {superficieNoFundo.toFixed(2)}:1
            </code>{' '}
            — abaixo de 4.5
          </span>
        </div>

        <div className="ring-border flex flex-col gap-2 rounded-lg p-3 ring-1">
          <code className="text-xs font-medium">--primary-vivid</code>
          <span className="text-primary-vivid px-3 py-2 text-sm font-medium">
            Texto e ícone
          </span>
          <span className="text-muted-foreground text-xs">
            no fundo da página:{' '}
            <code className="tabular font-mono">{vividNoFundo.toFixed(2)}:1</code>
          </span>
          <span className="text-muted-foreground text-xs">
            usado em link, item ativo e métrica
          </span>
        </div>
      </div>
    </div>
  );
}
