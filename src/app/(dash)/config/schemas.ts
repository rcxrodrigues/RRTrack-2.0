import { z } from 'zod';

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

export const settingsSchema = z.object({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, { error: 'Use o código ISO de 3 letras, como BRL.' }),
  test_event_code: z.string().trim().max(60).optional(),
  cookie_domain: z
    .string()
    .trim()
    .max(253)
    .optional()
    .refine((v) => !v || /^\.?([a-z0-9-]+\.)+[a-z]{2,}$/i.test(v), {
      error: 'Use um domínio como .transforlar.com',
    }),
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
