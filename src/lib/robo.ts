/**
 * "Isto é um robô?" — pelo User-Agent, e só por ele.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ O ERRO CARO AQUI É O FALSO POSITIVO, NÃO O FALSO NEGATIVO.               │
 * │                                                                          │
 * │ Marcar um robô como gente infla o topo do funil e suja a conversão —     │
 * │ chato, visível, corrigível. Marcar GENTE como robô tira um comprador     │
 * │ real da conta E do que vai para a Meta: a venda dele some do funil, o    │
 * │ otimizador deixa de aprender com quem comprou, e nada aponta a falta.    │
 * │                                                                          │
 * │ Por isso a lista é CURADA e não esperta: cada marca aqui só aparece em   │
 * │ agente de robô. Na dúvida, não marca.                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * **A linha continua sendo gravada.** Isto decide o que CONTA, não o que
 * existe: o robô entra no banco com `is_bot`, fica fora das somas do painel
 * e não vai para a Meta nem para o GA4. Descartar na porta perderia para
 * sempre quem eu classificasse errado — e é justamente o erro que esta
 * função pode cometer.
 */

/**
 * "CUBOT" é marca de celular, vendida no Brasil, e tem "bot" no nome.
 *
 * Sem isto, `bot/` marcaria o aparelho de um comprador — exatamente o falso
 * positivo que custa caro. A limpeza vem ANTES da busca: o nome é removido
 * do texto e o que sobra é comparado normalmente.
 */
const NAO_SAO_ROBO = ['cubot'] as const;

/**
 * Marcas que só aparecem em agente de robô. Minúsculas; a busca é por
 * substring, então não há metacaractere nem âncora aqui.
 *
 * `whatsapp/` leva a barra de propósito: o robô de prévia de link se
 * anuncia como `WhatsApp/2.x`, e o navegador embutido do aplicativo — por
 * onde chega uma fatia do tráfego desta loja — NÃO carrega essa palavra.
 * Sem a barra, marcar "whatsapp" descartaria comprador de verdade.
 *
 * `+http` é convenção: crawler educado põe o endereço da própria
 * documentação no agente (`+http://exemplo.com/bot.html`). Navegador
 * nenhum faz isso, e isso pega o robô cujo nome ainda não existe.
 */
export const MARCAS_DE_ROBO = [
  // Buscadores
  'googlebot', 'adsbot-google', 'mediapartners-google', 'apis-google',
  'feedfetcher-google', 'google-inspectiontool', 'googleother',
  'google favicon', 'storebot-google', 'google-extended',
  'bingbot', 'bingpreview', 'yandexbot', 'duckduckbot', 'baiduspider',
  'applebot', 'petalbot', 'seznambot',

  // Prévia de link em rede social e mensageiro
  'facebookexternalhit', 'facebookcatalog', 'facebot', 'meta-externalagent',
  'twitterbot', 'linkedinbot', 'pinterestbot', 'slackbot', 'slack-imgproxy',
  'telegrambot', 'discordbot', 'redditbot', 'whatsapp/', 'skypeuripreview',
  'embedly',

  // Treino e busca de IA
  'gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'claude-web',
  'anthropic-ai', 'perplexitybot', 'ccbot', 'bytespider', 'amazonbot',
  'diffbot', 'timpibot', 'youbot',

  // SEO e raspagem
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'dataforseo',
  'screaming frog', 'serpstatbot', 'blexbot', 'barkrowler', 'megaindex',
  'seekportbot', 'zoominfobot', 'imagesiftbot',

  // Medição e monitoramento
  'lighthouse', 'pagespeed', 'gtmetrix', 'pingdom', 'uptimerobot',
  'statuscake', 'site24x7', 'newrelicpinger', 'datadog', 'betteruptime',
  'checkly', 'webpagetest', 'vercel-screenshot', 'vercel-favicon',

  // Automação de navegador
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
  'cypress', 'prerender',

  // Biblioteca de HTTP — script, não navegador
  'python-requests', 'python-urllib', 'aiohttp', 'scrapy', 'curl/', 'wget/',
  'libwww-perl', 'go-http-client', 'okhttp', 'java/', 'apache-httpclient',
  'guzzlehttp', 'node-fetch', 'axios/', 'postmanruntime', 'insomnia',
  'httpie', 'restsharp', 'typhoeus', 'faraday',

  // Genéricos — pegam o robô cujo nome ainda não existe
  '+http', 'crawler', 'crawling', 'spider', 'scraper', 'bot/',
] as const;

/**
 * `true` quando o agente é de robô.
 *
 * **Agente AUSENTE não é robô.** É suspeito — script não costuma mandar
 * nenhum —, mas extensão de privacidade também o remove, e marcar por
 * ausência trocaria uma suspeita por uma afirmação. Vale a regra do
 * arquivo: na dúvida, não marca.
 */
export function ehRobo(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;

  let ua = userAgent.toLowerCase();
  for (const marca of NAO_SAO_ROBO) ua = ua.split(marca).join('');

  return MARCAS_DE_ROBO.some((m) => ua.includes(m));
}
