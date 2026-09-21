import { z } from 'zod';

import { CODIGOS_MOEDA } from '@/lib/moedas';

/**
 * Validação dos formulários de configuração.
 *
 * Fica num arquivo próprio para ser importada tanto pelo cliente (feedback
 * imediato) quanto pelo servidor (a validação que realmente vale).
 */

const rotulo = z
  .string()
  .trim()
  .min(1, { error: 'Dê um nome para reconhecer esta conta.' })
  .max(60, { error: 'No máximo 60 caracteres.' });

const segredoOpcional = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

export const ga4Schema = z.object({
  label: rotulo,
  measurement_id: z
    .string()
    .trim()
    .regex(/^G-[A-Z0-9]{4,}$/, {
      error: 'O Measurement ID tem o formato G-XXXXXXX.',
    }),
  segredo: segredoOpcional,
});

export const pixelSchema = z.object({
  label: rotulo,
  pixel_id: z
    .string()
    .trim()
    .regex(/^[0-9]{5,}$/, { error: 'O ID do pixel é só números.' }),
  segredo: segredoOpcional,
});

export const adAccountSchema = z.object({
  label: rotulo,
  // Aceita com ou sem act_ e guarda sem — quem monta a URL é o código.
  ad_account_id: z
    .string()
    .trim()
    .transform((v) => v.replace(/^act_/, ''))
    .pipe(
      z.string().regex(/^[0-9]{5,}$/, {
        error: 'O ID da conta de anúncio é só números (com ou sem act_).',
      }),
    ),
  segredo: segredoOpcional,
});

/** Reduz o que a pessoa colou ao host: aceita URL inteira ou domínio puro. */
function soHost(linha: string): string {
  const limpo = linha.trim().replace(/^\.+/, '');
  if (limpo.length === 0) return '';
  try {
    return new URL(limpo.includes('://') ? limpo : `https://${limpo}`).hostname.toLowerCase();
  } catch {
    return limpo.toLowerCase();
  }
}

export const settingsSchema = z.object({
  // Lista fechada, não regex: "XYZ" passaria no formato e seria recusado
  // pela Meta na hora de enviar a conversão.
  //
  // O toUpperCase antes do enum é tolerância de entrada: pelo seletor o
  // valor sempre chega certo, mas a action também pode ser chamada
  // diretamente, e recusar "brl" seria rigor sem propósito.
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(CODIGOS_MOEDA, { error: 'Escolha uma das moedas disponíveis.' })),
  test_event_code: z.string().trim().max(60).optional(),
  cookie_domain: z
    .string()
    .trim()
    .max(253)
    .optional()
    .refine((v) => !v || /^\.?([a-z0-9-]+\.)+[a-z]{2,}$/i.test(v), {
      error: 'Use um domínio como .transforlar.com',
    }),
  // Uma por linha no formulário. Aceita domínio puro ou URL colada inteira:
  // quem copia o endereço do checkout traz "https://seguro.loja.com/abc", e
  // recusar isso seria rigor sem propósito — o que importa é o host.
  checkout_domains: z
    .string()
    .trim()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split('\n')
        .map((linha) => soHost(linha))
        .filter((linha) => linha.length > 0),
    )
    .pipe(
      z.array(
        z
          .string()
          .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, {
            error: 'Use um domínio como seguro.minhaloja.com',
          }),
      ),
    ),
  // Uma origem por linha no formulário.
  allowed_origins: z
    .string()
    .trim()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0),
    )
    .pipe(
      z.array(
        z.url({ error: 'Cada origem precisa ser uma URL, como https://transforlar.com' }),
      ),
    ),
});

export type DadosGa4 = z.infer<typeof ga4Schema>;
export type DadosPixel = z.infer<typeof pixelSchema>;
export type DadosAdAccount = z.infer<typeof adAccountSchema>;
export type DadosSettings = z.infer<typeof settingsSchema>;
