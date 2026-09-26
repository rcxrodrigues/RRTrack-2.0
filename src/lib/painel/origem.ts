/**
 * De onde a pessoa veio — respondido em cascata, e dizendo qual nível
 * respondeu.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ A UTM DO EVENTO É A EXCEÇÃO, NÃO A REGRA.                                │
 * │                                                                          │
 * │ As UTMs são lidas da URL de CADA evento. A pessoa cai em                 │
 * │ `/?utm_campaign=X`, e esse PageView carrega a campanha. No clique        │
 * │ seguinte ela está em `/products/camiseta` — sem query string — e o       │
 * │ AddToCart, o InitiateCheckout e o Purchase nascem SEM UTM nenhuma.       │
 * │                                                                          │
 * │ Ou seja: a maioria das linhas da tabela sempre teve "sem campanha na     │
 * │ UTM", e isso lia como falha de marcação quando era o comportamento       │
 * │ normal da navegação. O dado existe — está no VISITANTE, gravado no       │
 * │ `/api/identify` da primeira visita.                                      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * A cascata, e por que nesta ordem:
 *
 * | nível        | o que é                                                    |
 * |--------------|------------------------------------------------------------|
 * | `evento`     | a UTM na URL deste evento — o mais preciso que existe      |
 * | `visitante`  | a UTM da primeira visita desta pessoa                      |
 * | `referrer`   | o site de onde ela veio, quando não houve UTM nenhuma      |
 * | `direto`     | digitou o endereço, veio de app ou o referrer foi cortado  |
 *
 * O nível volta junto porque a diferença importa: "esta compra carregava a
 * campanha" e "esta compra é de alguém que um dia chegou pela campanha" são
 * afirmações diferentes, e a segunda é mais fraca. Mostrar as duas iguais
 * faria a tela prometer uma precisão que ela não tem.
 */

export type NivelDaOrigem = 'evento' | 'visitante' | 'referrer' | 'direto';

export type Origem = {
  nivel: NivelDaOrigem;
  /** `utm_campaign › utm_term › utm_content`, ou o domínio do referrer. */
  rotulo: string;
  /** `utm_source · utm_medium`, quando há. Vazio no referrer. */
  fonte: string | null;
};

/** As cinco UTMs de uma linha, todas opcionais. */
export type Utms = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
};

function vazio(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '';
}

/** Há alguma UTM preenchida? `utm_source` sozinha já conta. */
export function temUtm(u: Utms | null | undefined): boolean {
  if (!u) return false;
  return [u.utmSource, u.utmMedium, u.utmCampaign, u.utmTerm, u.utmContent].some(
    (v) => !vazio(v),
  );
}

/**
 * `campanha › conjunto › anúncio`, pela convenção das macros do anúncio.
 *
 * O separador `›` e não `·`: os três são uma hierarquia, e `·` os faria ler
 * como três coisas soltas. Sem campanha, cai para a origem/meio, que é o
 * que sobra quando só `utm_source` veio.
 */
function trilha(u: Utms): string {
  const caminho = [u.utmCampaign, u.utmTerm, u.utmContent].filter(
    (v) => !vazio(v),
  );
  if (caminho.length > 0) return caminho.join(' › ');

  const solto = [u.utmSource, u.utmMedium].filter((v) => !vazio(v));
  return solto.join(' · ');
}

function fonteDe(u: Utms): string | null {
  const partes = [u.utmSource, u.utmMedium].filter((v) => !vazio(v));
  return partes.length > 0 ? partes.join(' · ') : null;
}

/**
 * O domínio de um referrer, sem `www.` e sem o caminho.
 *
 * `https://www.google.com/search?q=x` vira `google.com`. O caminho não é
 * jogado fora por estética: uma URL de busca leva o TERMO que a pessoa
 * digitou, e isso é dado dela que não tem por que ficar numa tabela do
 * painel. O domínio responde a pergunta inteira.
 *
 * Referrer que não parseia volta cru e cortado — melhor um texto estranho
 * que um "direto" que mente.
 */
export function dominioDoReferrer(bruto: string): string {
  try {
    const host = new URL(bruto).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return bruto.slice(0, 60);
  }
}

export function resolverOrigem({
  doEvento,
  doVisitante,
  referrer,
}: {
  doEvento?: Utms | null;
  doVisitante?: Utms | null;
  referrer?: string | null;
}): Origem {
  if (doEvento && temUtm(doEvento)) {
    return { nivel: 'evento', rotulo: trilha(doEvento), fonte: fonteDe(doEvento) };
  }

  if (doVisitante && temUtm(doVisitante)) {
    return {
      nivel: 'visitante',
      rotulo: trilha(doVisitante),
      fonte: fonteDe(doVisitante),
    };
  }

  if (!vazio(referrer)) {
    return {
      nivel: 'referrer',
      // `referrer` é string aqui: `vazio()` já descartou null e undefined.
      rotulo: dominioDoReferrer(referrer ?? ''),
      fonte: null,
    };
  }

  return { nivel: 'direto', rotulo: 'direto', fonte: null };
}
