import { ESTADOS_BRASIL, ufDaRegiao } from './mapa-brasil';

/**
 * Nome de lugar para a tela — `BR-SP` vira `São Paulo`, `BR` vira `Brasil`.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ FOI A FOTO DO MAPA QUE PEGOU ISTO.                                       │
 * │                                                                          │
 * │ A árvore sempre mostrou o que vinha do cabeçalho — `BR-SP`, `BR-MG` —, e │
 * │ passava porque não havia com o que comparar. Com o mapa AO LADO dizendo  │
 * │ "São Paulo", a mesma linha virou código de máquina no painel de uma      │
 * │ pessoa. O par tornou visível um defeito que já estava lá.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ POR QUE NÃO `Intl.DisplayNames`, QUE EXISTE PARA ISTO.                   │
 * │                                                                          │
 * │ Mesma armadilha do `Intl.NumberFormat` que o `formato.ts` já desvia, por │
 * │ outra porta: ele depende do ICU, e o ICU do Node **não é** o do          │
 * │ navegador. A árvore é renderizada no servidor e hidratada no cliente; se │
 * │ os dois escreverem o nome do país diferente — e escrevem, as versões de  │
 * │ ICU discordam em acento, em "Estados Unidos" vs "EUA", em ordem de       │
 * │ palavra —, o React vê textos diferentes e a hidratação quebra.           │
 * │                                                                          │
 * │ Tabela à mão, como a moeda. Determinística nos dois lados.               │
 * └───────────────────────────────────────────────────────────────────────────┘
 */

/** Os estados vêm da mesma lista do mapa — um lugar só para os 27 nomes. */
const NOMES_DE_ESTADO = new Map(ESTADOS_BRASIL.map((e) => [e.uf, e.nome]));

/**
 * Os 249 códigos do ISO 3166-1 alpha-2, em português.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ ERA PARCIAL, E A TELA REAL MOSTROU POR QUE ISSO NÃO SERVE.               │
 * │                                                                          │
 * │ A primeira versão tinha os ~25 países que eu achei que apareceriam num    │
 * │ funil brasileiro, e o resto caía no código. A justificativa — "tabela     │
 * │ incompleta nunca mostra nome errado" — continua verdadeira e continua     │
 * │ irrelevante: na conta de verdade a árvore saiu com "Estados Unidos",      │
 * │ "Brasil", "Alemanha"… e `CN` e `FI` no meio. Mistura de nome e código na  │
 * │ mesma lista não lê como "este eu não conheço", lê como DEFEITO.           │
 * │                                                                          │
 * │ E o tráfego de uma loja na internet aberta não é o que a oferta mira:     │
 * │ rastreador e bot chegam de qualquer lugar do mundo. Supor a lista de      │
 * │ países era supor o que não dá para supor.                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * O fallback continua: código desconhecido (ou algo que o Cloudflare invente)
 * volta cru, que é melhor que um nome inventado.
 */
export const PAISES_CONHECIDOS: Record<string, string> = {
  AD: 'Andorra',
  AE: 'Emirados Árabes Unidos',
  AF: 'Afeganistão',
  AG: 'Antígua e Barbuda',
  AI: 'Anguila',
  AL: 'Albânia',
  AM: 'Armênia',
  AO: 'Angola',
  AQ: 'Antártida',
  AR: 'Argentina',
  AS: 'Samoa Americana',
  AT: 'Áustria',
  AU: 'Austrália',
  AW: 'Aruba',
  AX: 'Ilhas Åland',
  AZ: 'Azerbaijão',
  BA: 'Bósnia e Herzegovina',
  BB: 'Barbados',
  BD: 'Bangladesh',
  BE: 'Bélgica',
  BF: 'Burquina Faso',
  BG: 'Bulgária',
  BH: 'Bahrein',
  BI: 'Burundi',
  BJ: 'Benin',
  BL: 'São Bartolomeu',
  BM: 'Bermudas',
  BN: 'Brunei',
  BO: 'Bolívia',
  BQ: 'Países Baixos Caribenhos',
  BR: 'Brasil',
  BS: 'Bahamas',
  BT: 'Butão',
  BV: 'Ilha Bouvet',
  BW: 'Botsuana',
  BY: 'Bielorrússia',
  BZ: 'Belize',
  CA: 'Canadá',
  CC: 'Ilhas Cocos',
  CD: 'República Democrática do Congo',
  CF: 'República Centro-Africana',
  CG: 'Congo',
  CH: 'Suíça',
  CI: 'Costa do Marfim',
  CK: 'Ilhas Cook',
  CL: 'Chile',
  CM: 'Camarões',
  CN: 'China',
  CO: 'Colômbia',
  CR: 'Costa Rica',
  CU: 'Cuba',
  CV: 'Cabo Verde',
  CW: 'Curaçao',
  CX: 'Ilha Christmas',
  CY: 'Chipre',
  CZ: 'Tchéquia',
  DE: 'Alemanha',
  DJ: 'Djibuti',
  DK: 'Dinamarca',
  DM: 'Dominica',
  DO: 'República Dominicana',
  DZ: 'Argélia',
  EC: 'Equador',
  EE: 'Estônia',
  EG: 'Egito',
  EH: 'Saara Ocidental',
  ER: 'Eritreia',
  ES: 'Espanha',
  ET: 'Etiópia',
  FI: 'Finlândia',
  FJ: 'Fiji',
  FK: 'Ilhas Malvinas',
  FM: 'Micronésia',
  FO: 'Ilhas Faroe',
  FR: 'França',
  GA: 'Gabão',
  GB: 'Reino Unido',
  GD: 'Granada',
  GE: 'Geórgia',
  GF: 'Guiana Francesa',
  GG: 'Guernsey',
  GH: 'Gana',
  GI: 'Gibraltar',
  GL: 'Groenlândia',
  GM: 'Gâmbia',
  GN: 'Guiné',
  GP: 'Guadalupe',
  GQ: 'Guiné Equatorial',
  GR: 'Grécia',
  GS: 'Geórgia do Sul e Ilhas Sandwich do Sul',
  GT: 'Guatemala',
  GU: 'Guam',
  GW: 'Guiné-Bissau',
  GY: 'Guiana',
  HK: 'Hong Kong',
  HM: 'Ilha Heard e Ilhas McDonald',
  HN: 'Honduras',
  HR: 'Croácia',
  HT: 'Haiti',
  HU: 'Hungria',
  ID: 'Indonésia',
  IE: 'Irlanda',
  IL: 'Israel',
  IM: 'Ilha de Man',
  IN: 'Índia',
  IO: 'Território Britânico do Oceano Índico',
  IQ: 'Iraque',
  IR: 'Irã',
  IS: 'Islândia',
  IT: 'Itália',
  JE: 'Jersey',
  JM: 'Jamaica',
  JO: 'Jordânia',
  JP: 'Japão',
  KE: 'Quênia',
  KG: 'Quirguistão',
  KH: 'Camboja',
  KI: 'Kiribati',
  KM: 'Comores',
  KN: 'São Cristóvão e Névis',
  KP: 'Coreia do Norte',
  KR: 'Coreia do Sul',
  KW: 'Kuwait',
  KY: 'Ilhas Cayman',
  KZ: 'Cazaquistão',
  LA: 'Laos',
  LB: 'Líbano',
  LC: 'Santa Lúcia',
  LI: 'Liechtenstein',
  LK: 'Sri Lanka',
  LR: 'Libéria',
  LS: 'Lesoto',
  LT: 'Lituânia',
  LU: 'Luxemburgo',
  LV: 'Letônia',
  LY: 'Líbia',
  MA: 'Marrocos',
  MC: 'Mônaco',
  MD: 'Moldávia',
  ME: 'Montenegro',
  MF: 'São Martinho',
  MG: 'Madagascar',
  MH: 'Ilhas Marshall',
  MK: 'Macedônia do Norte',
  ML: 'Mali',
  MM: 'Mianmar',
  MN: 'Mongólia',
  MO: 'Macau',
  MP: 'Ilhas Marianas do Norte',
  MQ: 'Martinica',
  MR: 'Mauritânia',
  MS: 'Montserrat',
  MT: 'Malta',
  MU: 'Maurício',
  MV: 'Maldivas',
  MW: 'Malaui',
  MX: 'México',
  MY: 'Malásia',
  MZ: 'Moçambique',
  NA: 'Namíbia',
  NC: 'Nova Caledônia',
  NE: 'Níger',
  NF: 'Ilha Norfolk',
  NG: 'Nigéria',
  NI: 'Nicarágua',
  NL: 'Países Baixos',
  NO: 'Noruega',
  NP: 'Nepal',
  NR: 'Nauru',
  NU: 'Niue',
  NZ: 'Nova Zelândia',
  OM: 'Omã',
  PA: 'Panamá',
  PE: 'Peru',
  PF: 'Polinésia Francesa',
  PG: 'Papua-Nova Guiné',
  PH: 'Filipinas',
  PK: 'Paquistão',
  PL: 'Polônia',
  PM: 'São Pedro e Miquelão',
  PN: 'Ilhas Pitcairn',
  PR: 'Porto Rico',
  PS: 'Palestina',
  PT: 'Portugal',
  PW: 'Palau',
  PY: 'Paraguai',
  QA: 'Catar',
  RE: 'Reunião',
  RO: 'Romênia',
  RS: 'Sérvia',
  RU: 'Rússia',
  RW: 'Ruanda',
  SA: 'Arábia Saudita',
  SB: 'Ilhas Salomão',
  SC: 'Seicheles',
  SD: 'Sudão',
  SE: 'Suécia',
  SG: 'Singapura',
  SH: 'Santa Helena',
  SI: 'Eslovênia',
  SJ: 'Svalbard e Jan Mayen',
  SK: 'Eslováquia',
  SL: 'Serra Leoa',
  SM: 'San Marino',
  SN: 'Senegal',
  SO: 'Somália',
  SR: 'Suriname',
  SS: 'Sudão do Sul',
  ST: 'São Tomé e Príncipe',
  SV: 'El Salvador',
  SX: 'Sint Maarten',
  SY: 'Síria',
  SZ: 'Essuatíni',
  TC: 'Ilhas Turcas e Caicos',
  TD: 'Chade',
  TF: 'Terras Austrais Francesas',
  TG: 'Togo',
  TH: 'Tailândia',
  TJ: 'Tadjiquistão',
  TK: 'Tokelau',
  TL: 'Timor-Leste',
  TM: 'Turcomenistão',
  TN: 'Tunísia',
  TO: 'Tonga',
  TR: 'Turquia',
  TT: 'Trinidad e Tobago',
  TV: 'Tuvalu',
  TW: 'Taiwan',
  TZ: 'Tanzânia',
  UA: 'Ucrânia',
  UG: 'Uganda',
  UM: 'Ilhas Menores Distantes dos Estados Unidos',
  US: 'Estados Unidos',
  UY: 'Uruguai',
  UZ: 'Uzbequistão',
  VA: 'Vaticano',
  VC: 'São Vicente e Granadinas',
  VE: 'Venezuela',
  VG: 'Ilhas Virgens Britânicas',
  VI: 'Ilhas Virgens Americanas',
  VN: 'Vietnã',
  VU: 'Vanuatu',
  WF: 'Wallis e Futuna',
  WS: 'Samoa',
  YE: 'Iêmen',
  YT: 'Mayotte',
  ZA: 'África do Sul',
  ZM: 'Zâmbia',
  ZW: 'Zimbábue',
};

/** `BR-SP` ou `SP` → `São Paulo`. O que não for estado do Brasil volta cru. */
export function nomeDoEstado(regiao: string): string {
  const uf = ufDaRegiao(regiao);
  return (uf && NOMES_DE_ESTADO.get(uf)) ?? regiao;
}

/** `BR` → `Brasil`. País fora da tabela volta a sigla, nunca um nome errado. */
export function nomeDoPais(iso: string): string {
  return PAISES_CONHECIDOS[iso.trim().toUpperCase()] ?? iso;
}
