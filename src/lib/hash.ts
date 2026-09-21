import { createHash } from 'node:crypto';

/**
 * Normalização e hash dos dados pessoais para a Conversions API.
 *
 * A Meta compara o hash que enviamos com o hash que ela calcula sobre os
 * dados dela. Se normalizarmos diferente, os hashes não batem e o evento
 * chega sem identificação — sem erro, sem aviso, só com um match pior. É a
 * falha mais silenciosa de toda a integração.
 *
 * Regras: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 *
 * O que NÃO é hasheado: fbp, fbc, client_ip_address e client_user_agent.
 * Esses vão em claro — hashear tornaria cada um inútil.
 */

function sha256(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

/** Hash só se houver conteúdo; string vazia vira ausência, não hash do vazio. */
function hashSeTiver(normalizado: string): string | null {
  return normalizado.length > 0 ? sha256(normalizado) : null;
}

/**
 * O que a Meta remove de cidade e estado: dígitos, espaços, pontos, hífens e
 * parênteses. Acento e apóstrofo NÃO estão na lista — ver `normalize.py` do
 * SDK oficial, que é a implementação de referência.
 */
const PONTUACAO_META = /[0-9.\s\-()]/g;

/** Minúsculas e sem espaço nas pontas — a base de quase toda regra da Meta. */
function basico(valor: string | null | undefined): string {
  return (valor ?? '').trim().toLowerCase();
}

/** E-mail: minúsculas, sem espaços. */
export function hashEmail(email: string | null | undefined): string | null {
  const normalizado = basico(email);
  // Sem arroba não é e-mail: hashear geraria um valor que nunca casa.
  if (!normalizado.includes('@')) return null;
  return hashSeTiver(normalizado);
}

/**
 * Telefone: só dígitos, com código do país, sem `+` nem zeros à esquerda.
 *
 * O número brasileiro escrito como `(11) 99999-8888` precisa virar
 * `5511999998888`. Sem o 55 na frente, a Meta não reconhece.
 */
export function hashTelefone(
  telefone: string | null | undefined,
  ddiPadrao = '55',
): string | null {
  let digitos = (telefone ?? '').replaceAll(/\D/g, '');
  if (digitos.length === 0) return null;

  // Zeros de discagem internacional ("0055…", "055…") não fazem parte do número.
  digitos = digitos.replace(/^0+/, '');

  // 10 ou 11 dígitos é número nacional sem DDI: 11 dígitos = celular com
  // DDD, 10 = fixo com DDD.
  if (digitos.length >= 10 && digitos.length <= 11) {
    digitos = `${ddiPadrao}${digitos}`;
  }

  // Curto demais para ser telefone de verdade.
  if (digitos.length < 10) return null;

  return hashSeTiver(digitos);
}

/**
 * Nome: só minúsculas e sem espaço nas pontas.
 *
 * Nada de tirar pontuação: `normalize.py` da Meta não tem ramo para `fn`/`ln`,
 * então do lado dela `O'Brien` vira `o'brien`. Se aqui virasse `obrien`, os
 * dois hashes nunca bateriam — e a Meta não avisa, só casa menos.
 */
export function hashNome(nome: string | null | undefined): string | null {
  return hashSeTiver(basico(nome));
}

/**
 * Cidade: minúsculas, sem dígitos, espaços, pontos, hífens nem parênteses.
 *
 * É exatamente o conjunto que a Meta remove — `São Paulo` vira `sãopaulo`
 * (o acento FICA) e `Coeur d'Alene` vira `coeurd'alene` (o apóstrofo FICA).
 */
export function hashCidade(cidade: string | null | undefined): string | null {
  return hashSeTiver(basico(cidade).replaceAll(PONTUACAO_META, ''));
}

/**
 * Estado: mesma regra da cidade, depois de tirar o prefixo do país.
 *
 * O `BR-SP` do ISO 3166-2 precisa virar `sp` ANTES da limpeza: aplicando só a
 * regra da Meta, o hífen sairia e sobraria `brsp`, que não casa com nada.
 */
export function hashEstado(estado: string | null | undefined): string | null {
  const semPais = basico(estado).replace(/^[a-z]{2}-/, '');
  return hashSeTiver(semPais.replaceAll(PONTUACAO_META, ''));
}

/** País: ISO-3166 alpha-2 em minúsculas. */
export function hashPais(pais: string | null | undefined): string | null {
  const normalizado = basico(pais).replaceAll(/[^a-z]/g, '');
  if (normalizado.length !== 2) return null;
  return hashSeTiver(normalizado);
}

/**
 * `external_id`: o nosso `trck_user_id`.
 *
 * A Meta aceita em claro ou hasheado, mas manda hashear tudo que identifique
 * pessoa — e o custo é zero.
 */
export function hashExternalId(id: string | null | undefined): string | null {
  const normalizado = (id ?? '').trim();
  return hashSeTiver(normalizado);
}

/**
 * CEP / postcode: sem espaços, cortado no primeiro hífen.
 *
 * Só dígitos NÃO serve. O projeto trabalha com libra e euro, e um postcode
 * britânico (`SW1A 1AA`) é letra e número — tirar as letras o destruiria.
 * A Meta corta no hífen porque o ZIP+4 americano (`94025-1234`) casa pelos
 * cinco primeiros; a mesma regra vale para o CEP de oito (`01310-100`).
 */
export function hashCep(cep: string | null | undefined): string | null {
  const [base = ''] = basico(cep).replaceAll(/\s/g, '').split('-');
  return hashSeTiver(base);
}
