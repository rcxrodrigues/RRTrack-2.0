import { describe, expect, it } from 'vitest';

import { adAccountSchema, ga4Schema, pixelSchema, settingsSchema } from './schemas';

describe('ga4Schema', () => {
  it('aceita um Measurement ID no formato do GA4', () => {
    const r = ga4Schema.safeParse({
      label: 'Principal',
      measurement_id: 'G-ABC123XYZ',
      segredo: 'api-secret',
    });
    expect(r.success).toBe(true);
  });

  it('recusa o que parece com Measurement ID mas não é', () => {
    for (const id of ['UA-12345-1', 'G-', 'ABC123', 'g-abc123', '']) {
      expect(ga4Schema.safeParse({ label: 'x', measurement_id: id }).success).toBe(false);
    }
  });

  it('trata segredo vazio como ausente — para não apagar o token existente', () => {
    const r = ga4Schema.safeParse({
      label: 'x',
      measurement_id: 'G-ABC123',
      segredo: '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.segredo).toBeUndefined();
  });
});

describe('pixelSchema', () => {
  it('aceita id numérico do pixel', () => {
    expect(pixelSchema.safeParse({ label: 'x', pixel_id: '123456789012345' }).success).toBe(
      true,
    );
  });

  it('recusa id com letras ou curto demais', () => {
    for (const id of ['abc', '123', 'px_123456', '']) {
      expect(pixelSchema.safeParse({ label: 'x', pixel_id: id }).success).toBe(false);
    }
  });
});

describe('adAccountSchema', () => {
  // A Meta mostra o id com act_ no painel, mas a API monta a URL com o
  // prefixo. Guardar os dois formatos criaria uma conta duplicada.
  it('tira o prefixo act_ e guarda só os dígitos', () => {
    const comPrefixo = adAccountSchema.safeParse({ label: 'x', ad_account_id: 'act_123456' });
    const semPrefixo = adAccountSchema.safeParse({ label: 'x', ad_account_id: '123456' });

    expect(comPrefixo.success).toBe(true);
    expect(semPrefixo.success).toBe(true);
    if (comPrefixo.success && semPrefixo.success) {
      expect(comPrefixo.data.ad_account_id).toBe('123456');
      expect(comPrefixo.data.ad_account_id).toBe(semPrefixo.data.ad_account_id);
    }
  });

  it('recusa id que não é numérico depois do prefixo', () => {
    expect(adAccountSchema.safeParse({ label: 'x', ad_account_id: 'act_abc' }).success).toBe(
      false,
    );
  });
});

describe('settingsSchema', () => {
  it('normaliza a moeda para maiúsculas', () => {
    const r = settingsSchema.safeParse({ currency: 'brl', allowed_origins: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe('BRL');
  });

  it('recusa moeda fora da lista suportada', () => {
    // 'XYZ' tem o formato de um código ISO e mesmo assim não serve: a Meta
    // recusaria a conversão lá na frente.
    for (const c of ['REAL', 'R$', 'BR', '', 'XYZ', 'JPY']) {
      expect(
        settingsSchema.safeParse({ currency: c, allowed_origins: '' }).success,
        `moeda "${c}" deveria ser recusada`,
      ).toBe(false);
    }
  });

  it('aceita as quatro moedas de trabalho', () => {
    for (const c of ['BRL', 'USD', 'EUR', 'GBP']) {
      expect(
        settingsSchema.safeParse({ currency: c, allowed_origins: '' }).success,
        `moeda "${c}" deveria ser aceita`,
      ).toBe(true);
    }
  });

  it('quebra as origens por linha, ignorando linhas vazias', () => {
    const r = settingsSchema.safeParse({
      currency: 'BRL',
      allowed_origins: 'https://transforlar.com\n\n  https://www.transforlar.com  \n',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.allowed_origins).toEqual([
        'https://transforlar.com',
        'https://www.transforlar.com',
      ]);
    }
  });

  it('recusa origem que não é URL — senão o CORS nunca casaria', () => {
    const r = settingsSchema.safeParse({
      currency: 'BRL',
      allowed_origins: 'transforlar.com',
    });
    expect(r.success).toBe(false);
  });

  it('aceita domínio de cookie com ponto na frente', () => {
    const r = settingsSchema.safeParse({
      currency: 'BRL',
      cookie_domain: '.transforlar.com',
      allowed_origins: '',
    });
    expect(r.success).toBe(true);
  });

  it('recusa domínio de cookie que é uma URL', () => {
    const r = settingsSchema.safeParse({
      currency: 'BRL',
      cookie_domain: 'https://transforlar.com',
      allowed_origins: '',
    });
    expect(r.success).toBe(false);
  });
});
