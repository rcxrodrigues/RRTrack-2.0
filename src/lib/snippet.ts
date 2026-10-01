import 'server-only';

import type { Configuracao } from '@/lib/settings';
import { COOKIE_TRCK, PARAMS_TRCK } from '@/lib/trck';

/**
 * O snippet que roda no site do cliente.
 *
 * É servido por `/t.js` com a configuração já embutida — os measurement ids
 * do GA4 e os ids de pixel, lidos do painel. Nada de token aqui: estes ids
 * aparecem no navegador de qualquer visitante de qualquer forma.
 *
 * Três princípios, porque este código roda no site de vendas de alguém:
 *
 * 1. Nunca derrubar a página. Todo bloco está em try/catch e qualquer falha
 *    nossa é silenciosa — um erro de tracking não pode quebrar uma venda.
 * 2. Não sujar o escopo global além de `window.rrtrack`.
 * 3. O MESMO `event_id` vai para o Pixel e para o nosso servidor: é assim que
 *    a Meta entende que os dois são um evento só e não conta a conversão
 *    duas vezes.
 */
export function montarSnippet(base: string, config: Configuracao): string {
  const cfg = {
    base,
    cookie: COOKIE_TRCK,
    params: PARAMS_TRCK,
    // A moeda vai junto porque o valor do carrinho é lido aqui, no
    // navegador: mandar o evento sem ela faria a Meta assumir a do pixel,
    // que pode não ser a da loja.
    moeda: config.settings.currency,
    ga4: config.ga4.map((c) => c.measurementId),
    pixels: config.pixels.map((p) => p.pixelId),
    // `d` = domínio, `p` = nome do parâmetro. Abreviado porque isto vai
    // embutido em todo pageview do site, e o snippet é servido inteiro.
    checkout: config.settings.dominiosCheckout.map((c) => ({
      d: c.dominio,
      p: c.parametro,
    })),
  };

  return `/* RRTrack 2.0 */
(function (w, d) {
  'use strict';
  if (w.rrtrack && w.rrtrack.__carregado) return;

  var CFG = ${JSON.stringify(cfg)};
  var api = {};

  /* Nada aqui pode derrubar a página do cliente. */
  function seguro(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { /* silêncio */ }
    };
  }

  function param(nome) {
    try {
      return new URLSearchParams(w.location.search).get(nome);
    } catch (e) { return null; }
  }

  function lerCookie(nome) {
    var alvo = nome + '=';
    var partes = (d.cookie || '').split(';');
    for (var i = 0; i < partes.length; i++) {
      var p = partes[i].trim();
      if (p.indexOf(alvo) === 0) return decodeURIComponent(p.slice(alvo.length));
    }
    return null;
  }

  /* O identificador: primeiro a URL (quem chegou por link de checkout ou de
     WhatsApp traz o vínculo ali), depois o cookie. */
  function idAtual() {
    for (var i = 0; i < CFG.params.length; i++) {
      var v = param(CFG.params[i]);
      if (v && /^[0-9a-fA-F-]{32,36}$/.test(v)) return v.replace(/-/g, '').toLowerCase();
    }
    return lerCookie(CFG.cookie);
  }

  var trckUserId = idAtual();

  /* Rastreador, previa de link ou script. Quem responde e o /api/identify;
     comeca FALSO para que uma falha de rede nunca cale gente de verdade. */
  var ehRobo = false;

  function utms() {
    var out = {};
    ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) {
      var v = param('utm_' + k);
      if (v) out['utm_' + k] = v;
    });
    return out;
  }

  function enviar(caminho, dados) {
    return fetch(CFG.base + caminho, {
      method: 'POST',
      /* O cookie _trck precisa viajar: é primeira parte, mas a chamada é
         cross-origin (site → subdomínio do painel). */
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dados),
      keepalive: true
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  /* ---------------------------------------------------------------------
     Identificação
  --------------------------------------------------------------------- */
  function identificar(extra) {
    var corpo = {
      trck_user_id: trckUserId || undefined,
      url: w.location.href,
      referrer: d.referrer || undefined,
      fbclid: param('fbclid') || undefined,
      /* O clique do Google. Só existe AGORA: chega uma vez na URL e nem a
         Shopify, nem o checkout, nem o gateway o conhecem depois.

         Dois porque o ClickConversion do Google Ads aceita dois para web —
         o wbraid é o que chega quando o consentimento limita o gclid.
         Guardar só o gclid perderia justamente o clique restringido pela
         privacidade, e perderia calado. O gbraid fica de fora: é de
         campanha de APP, e esta loja não tem aplicativo. */
      gclid: param('gclid') || undefined,
      wbraid: param('wbraid') || undefined
    };
    var u = utms();
    for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) corpo[k] = u[k];
    if (extra) for (var k2 in extra) if (Object.prototype.hasOwnProperty.call(extra, k2)) corpo[k2] = extra[k2];

    /* O mesmo dado vai para o Pixel, não só para o servidor. Antes da ida à
       rede: o Advanced Matching vale para os eventos que saírem daqui em
       diante, e esperar a resposta atrasaria isso à toa. */
    matchNoPixel(extra);

    return enviar('/api/identify', corpo).then(function (r) {
      /* Quem decide e o SERVIDOR: so ele ve o User-Agent inteiro, e a regra
         mora num lugar so. O padrao e false — identify fora do ar NAO pode
         calar o rastreamento de gente. */
      if (r && r.robo === true) ehRobo = true;
      if (r && r.trck_user_id) {
        trckUserId = r.trck_user_id;
        marcarLinks();
      }
      /* O external_id hasheado vem PRONTO daqui, e é o mesmo que a
         Conversions API manda. Acumula sobre o que o site já tiver
         contado — ver a nota do matchNoPixel. */
      matchNoPixel(r);
      return r;
    });
  }

  /* ---------------------------------------------------------------------
     O vínculo viaja na URL — é a ponte para o checkout, que é outro site
  --------------------------------------------------------------------- */
  /* O WhatsApp fica no código: é universal e o mecanismo é outro — lá o id
     vai no TEXTO da mensagem. Os domínios de checkout vêm do painel, porque
     cada oferta usa o checkout que quiser e trocar não pode pedir deploy. */
  var WHATSAPP = /(^|\\.)(wa\\.me|whatsapp\\.com)$/i;

  /* Compara por HOST, não por pedaço de texto no href.
     Um "indexOf" cru casaria com https://golpe.com/?volta=checkout.loja.com,
     e aí o identificador do visitante iria embora para o site errado. */
  function paramDoCheckout(url) {
    var host = url.hostname.toLowerCase();
    for (var i = 0; i < CFG.checkout.length; i++) {
      var alvo = String(CFG.checkout[i].d).toLowerCase();
      if (host === alvo || host.slice(-(alvo.length + 1)) === '.' + alvo) {
        return CFG.checkout[i].p;
      }
    }
    return null;
  }

  /* O URLSearchParams escapa colchete: metadata[trck_user_id] vira
     metadata%5Btrck_user_id%5D. A Yampi documenta a forma LITERAL, e é ela
     que devolvemos — o link fica idêntico ao que o checkout publica, em vez
     de depender de o servidor deles decodificar antes de montar o array.

     A troca é só da CHAVE escapada seguida de "=", nunca do href inteiro:
     desescapar tudo mexeria no valor de outro parâmetro que por acaso
     trouxesse um colchete. */
  function comChaveLiteral(url, parametro) {
    var href = url.toString();
    var escapada = encodeURIComponent(parametro);
    if (escapada === parametro) return href;
    return href.split(escapada + '=').join(parametro + '=');
  }

  function marcarLinks() {
    if (!trckUserId) return;
    var links = d.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      try {
        var href = a.getAttribute('href') || '';
        var destino = new URL(href, w.location.href);
        var parametro = paramDoCheckout(destino);
        if (!WHATSAPP.test(destino.hostname) && !parametro) continue;

        /* Link de WhatsApp leva o id no TEXTO da mensagem: o wa.me ignora
           parâmetros que não conhece, e o texto é o que chega para quem
           atende. */
        if (WHATSAPP.test(destino.hostname)) {
          var texto = destino.searchParams.get('text') || '';
          if (texto.indexOf(trckUserId) === -1) {
            destino.searchParams.set('text', texto + (texto ? ' ' : '') + '[#' + trckUserId + ']');
            a.setAttribute('href', destino.toString());
          }
          continue;
        }

        /* Já marcado: sai. A conferência é pelo NOME configurado, não por
           uma string fixa — o link da Yampi não tem "trck_user_id=" solto. */
        if (destino.searchParams.has(parametro)) continue;

        destino.searchParams.set(parametro, trckUserId);
        a.setAttribute('href', comChaveLiteral(destino, parametro));
      } catch (e) { /* link malformado: deixa como está */ }
    }
  }

  /* ---------------------------------------------------------------------
     Destinos no navegador: gtag e Pixel
  --------------------------------------------------------------------- */
  function carregarGa4() {
    if (!CFG.ga4.length) return;
    w.dataLayer = w.dataLayer || [];
    function gtag() { w.dataLayer.push(arguments); }
    w.gtag = w.gtag || gtag;
    gtag('js', new Date());

    var s = d.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CFG.ga4[0]);
    d.head.appendChild(s);

    /* Todas as propriedades configuradas recebem os eventos da página. */
    CFG.ga4.forEach(function (id) { gtag('config', id); });
  }

  function carregarPixel() {
    if (!CFG.pixels.length) return;
    if (!w.fbq) {
      var n = w.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!w._fbq) w._fbq = n;
      n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      var t = d.createElement('script');
      t.async = true;
      t.src = 'https://connect.facebook.net/en_US/fbevents.js';
      d.head.appendChild(t);
    }
    CFG.pixels.forEach(function (id) { w.fbq('init', id); });
    /* O PageView NÃO sai daqui. Um fbq('track','PageView') solto vai só
       pelo navegador e sem eventID — sem deduplicação, e sem nada quando um
       bloqueador mata o pixel. Ele passa pelo api.track, na partida. */
  }

  /* ---------------------------------------------------------------------
     ADVANCED MATCHING — o que o navegador sabe da pessoa

     O fbq('init', id) nascia sem o segundo argumento, então o que o site
     contasse pelo rrtrack.identify({ email }) ia para o SERVIDOR e não para
     o Pixel. Metade do sinal se perdia numa porta que já estava aberta.

     Reinicializar com os dados é o caminho documentado de acrescentar
     matching DEPOIS do init — e é preciso, porque na partida ainda não se
     sabe quem é a pessoa: o identify vem de um formulário, de uma área
     logada, de um popup de newsletter.

     O e-mail, o telefone e o nome vão em CLARO: quem normaliza e hasheia
     esses é o fbevents.js. Hashear antes entregaria a ele um hash para
     hashear de novo.

     O external_id vai HASHEADO, e a diferença tem razão. Ele é o nosso
     trck_user_id, o mesmo que a Conversions API manda — e a doc de Advanced
     Matching da Meta diz que o Pixel aceita tanto o valor cru quanto o
     SHA-256 já normalizado. Mandando o MESMO hash dos dois lados eles
     casam, que é o que ela pede quando o id vai por mais de um canal. O
     hash vem PRONTO na resposta do /api/identify: calcular aqui seria
     hashear em dois lugares, e o dia em que divergissem a Meta veria duas
     pessoas sem avisar ninguém.

     A ACUMULAÇÃO não é detalhe. O identify chega em dois momentos — o site
     passando o e-mail, e a resposta trazendo o external_id — e cada um
     conhece só a sua parte. Reinicializando com o pedaço da vez, o segundo
     apagaria o primeiro e sobraria sempre metade.
  --------------------------------------------------------------------- */
  var CAMPOS_MATCH = {
    email: 'em',
    phone: 'ph',
    first_name: 'fn',
    last_name: 'ln',
    external_id: 'external_id'
  };

  /* O que já foi dito ao Pixel, acumulado. */
  var AM = {};

  function matchNoPixel(dados) {
    if (!w.fbq || !CFG.pixels.length || !dados) return;

    var novo = false;
    for (var chave in CAMPOS_MATCH) {
      if (!Object.prototype.hasOwnProperty.call(CAMPOS_MATCH, chave)) continue;
      var valor = dados[chave];
      if (typeof valor !== 'string' || !valor) continue;
      var alvo = CAMPOS_MATCH[chave];
      if (AM[alvo] === valor) continue;
      AM[alvo] = valor;
      novo = true;
    }

    /* Sem nada novo não se reinicializa: um init a mais por pageview só
       gastaria trabalho do fbevents.js sem acrescentar sinal. */
    if (!novo) return;
    CFG.pixels.forEach(function (id) { w.fbq('init', id, AM); });
  }

  /* ---------------------------------------------------------------------
     API pública
  --------------------------------------------------------------------- */
  function novoEventId() {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    return 'e' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* O funil de comércio eletrônico do GA4 tem nomes próprios, e são outros
     que os da Meta. Evento fora desta lista vai com o nome que veio — é o
     caso do rrtrack.track('Lead'), que não tem par no GA4. */
  var NOME_GA4 = {
    PageView: 'page_view',
    ViewContent: 'view_item',
    AddToCart: 'add_to_cart',
    InitiateCheckout: 'begin_checkout',
    Purchase: 'purchase'
  };

  /* ---------------------------------------------------------------------
     E O NOME SOZINHO NÃO BASTA — o FORMATO também é outro.

     Trocar AddToCart por add_to_cart e mandar o corpo da Meta
     (content_ids, content_type) deixa o evento com o nome certo e os
     relatorios de comercio eletronico do GA4 ainda VAZIOS: eles se
     alimentam de items[], e content_ids o GA4 simplesmente descarta.

     Ou seja, metade do conserto e conserto nenhum, e falha do mesmo jeito
     silencioso: o evento aparece na lista, e a tela de Monetizacao fica em
     branco. O lado do servidor ja fazia certo (ver items em compras.ts);
     era o navegador que estava fora do padrao.
  --------------------------------------------------------------------- */
  function corpoGa4(custom) {
    var d = {};
    for (var k in custom) {
      if (!Object.prototype.hasOwnProperty.call(custom, k)) continue;
      /* content_ids e content_type sao vocabulario da Meta; o GA4 os
         ignora, e deixa-los so engorda o payload. */
      if (k === 'content_ids' || k === 'content_type') continue;
      d[k] = custom[k];
    }

    var ids = custom && custom.content_ids;
    if (ids && ids.length) {
      var itens = [];
      for (var i = 0; i < ids.length; i++) {
        var item = { item_id: String(ids[i]) };
        /* O preco unitario so e conhecido quando ha UM item: com varios, o
           value e o total do carrinho, e dividi-lo inventaria numero. */
        if (ids.length === 1 && typeof custom.value === 'number') {
          item.price = custom.value;
        }
        item.quantity = 1;
        itens.push(item);
      }
      d.items = itens;
    }
    return d;
  }

  /* rrtrack.track('Lead', { value: 97, currency: 'BRL' }) */
  api.track = seguro(function (nome, dados, opcoes) {
    /* ---------------------------------------------------------------------
       Robo nao dispara NADA — nem fbq, nem gtag, nem /api/event.

       A trava fica aqui porque este e o ponto unico por onde todo evento
       sai: PageView, ViewContent, AddToCart e o que o site chamar. Posta
       em cada chamador, a proxima a nascer esqueceria de copiar — o modo
       de falha que o prepararCaptura() ja documenta do lado do servidor.

       O servidor recusa de novo, por conta propria: isto aqui e economia
       de requisicao e de evento no Pixel, nao a trava de verdade. Quem
       chamar track() antes do identify responder passa, e o servidor pega.
    --------------------------------------------------------------------- */
    if (ehRobo) return;

    var eventId = novoEventId();
    var custom = dados || {};

    /* Navegador e servidor com o MESMO event_id: é o que deduplica. */
    if (w.fbq && CFG.pixels.length) {
      w.fbq('track', nome, custom, { eventID: eventId });
    }
    /* "ga4: false" existe para um caso só: o PageView. A gtag já manda
       page_view sozinha no config, e um evento a mais chamado "PageView"
       seria um segundo evento no relatório, com outro nome, medindo a mesma
       coisa.

       E o NOME É OUTRO do lado do GA4. Mandar 'AddToCart' para a gtag cria
       um evento CUSTOMIZADO: ele aparece na lista de eventos e não alimenta
       nenhum relatório de comércio eletrônico — que é justamente para onde
       a pessoa vai olhar. O nome da Meta continua indo para o fbq e para o
       events_log; só a gtag recebe o dela. */
    if (w.gtag && CFG.ga4.length && !(opcoes && opcoes.ga4 === false)) {
      /* hasOwnProperty e nao "NOME_GA4[nome] ||": o nome vem de quem chama
         rrtrack.track(), e track('constructor') acharia a funcao herdada do
         prototipo — verdadeira, e mandada como nome do evento. */
      var nomeGa4 = Object.prototype.hasOwnProperty.call(NOME_GA4, nome)
        ? NOME_GA4[nome]
        : nome;
      w.gtag('event', nomeGa4, corpoGa4(custom));
    }

    var corpo = {
      event_name: nome,
      event_id: eventId,
      trck_user_id: trckUserId || undefined,
      url: w.location.href,
      custom_data: custom
    };
    var u = utms();
    for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) corpo[k] = u[k];

    enviar('/api/event', corpo);
    return eventId;
  });

  /* rrtrack.identify({ email: 'x@y.com' }) — quando o site souber quem é */
  api.identify = seguro(function (dados) { return identificar(dados); });

  /* O identificador, para pendurar em link montado por JS. */
  api.id = seguro(function () { return trckUserId; });

  /* Re-marca links que apareceram depois (popup, checkout embutido). */
  api.marcarLinks = seguro(marcarLinks);

  /* ---------------------------------------------------------------------
     Shopify: carrinho e checkout, sem tocar no tema

     O snippet dispara PageView sozinho e expoe rrtrack.track para o resto.
     Numa loja Shopify o resto da para detectar: os endpoints sao fixos
     (/cart/add, /cart.js, /checkout) e valem para qualquer tema.

     Por que aqui e nao num bloco colado no theme.liquid: tema e o lugar
     onde mexer da errado, e um ajuste nesta deteccao viraria outra rodada
     de editar Liquid. Aqui ele chega sozinho no proximo carregamento.

     TRES CAMINHOS PARA A MESMA ACAO, e por isso a trava de repeticao:
     tema moderno manda fetch para /cart/add.js, tema antigo faz submit do
     formulario, e alguns fazem os dois. Sem a trava a mesma adicao viraria
     dois ou tres AddToCart, e o meio do funil ficaria maior que o topo.
  --------------------------------------------------------------------- */
  var fetchOriginal = w.fetch;
  var carrinho = null;          /* ultimo total conhecido, em reais */
  var ultimoDisparo = {};

  function umaVezSo(nome) {
    var agora = new Date().getTime();
    if (ultimoDisparo[nome] && agora - ultimoDisparo[nome] < 1200) return false;
    ultimoDisparo[nome] = agora;
    return true;
  }

  /* O CAMINHO da URL, nao o texto dela.
     Um indexOf no href casaria com https://golpe.com/?x=/cart/add e
     dispararia evento a partir de um link de terceiro. */
  function caminhoDe(url) {
    try { return new URL(String(url), w.location.origin).pathname; }
    catch (e) { return ''; }
  }

  /* Sem regex de proposito: dentro do template literal que gera este
     arquivo, a barra escapada virava barra simples no JavaScript emitido e
     a regex inteira aparecia como comentario. Texto nao tem essa
     armadilha. */
  function terminaEm(texto, fim) {
    return texto.length >= fim.length && texto.slice(-fim.length) === fim;
  }

  function ehAdicionar(url) {
    var p = caminhoDe(url);
    return terminaEm(p, '/cart/add') || terminaEm(p, '/cart/add.js');
  }

  /* Shopify manda preco em CENTAVOS. Dividir aqui e nao no servidor porque
     e aqui que se sabe que a origem e Shopify. */
  function resumo(o) {
    if (!o) return null;
    var itens = (o.items && o.items.length) ? o.items : [o];
    var total = 0;
    var ids = [];
    for (var i = 0; i < itens.length; i++) {
      var it = itens[i] || {};
      if (typeof it.price === 'number') total += it.price * (it.quantity || 1);
      if (it.product_id) ids.push(String(it.product_id));
    }
    if (typeof o.total_price === 'number') total = o.total_price;
    return { value: total / 100, content_ids: ids };
  }

  /* Pagina de produto da Shopify: /products/<handle>, e tambem dentro de
     /collections/<colecao>/products/<handle>. Testado no CAMINHO, nunca no
     href: um indexOf no href casaria com
     https://golpe.com/?volta=/products/x e dispararia a partir do link de
     terceiro. Sem regex, pela armadilha da barra escapada no template
     literal que gera este arquivo. */
  function ehProduto(caminho) {
    var i = caminho.indexOf('/products/');
    return i >= 0 && caminho.length > i + '/products/'.length;
  }

  /* O produto que o tema da Shopify expoe.
     Nem todo tema expoe, e o ViewContent sai mesmo sem ele: um evento sem
     content_ids ainda ensina a Meta QUEM olhou, e um evento a menos nao
     ensina nada. O preco vem em CENTAVOS, como no resto da Shopify.

     A VARIANTE E A QUE A PAGINA MOSTRA, nao a primeira da lista. Numa
     camiseta de P a GG por 89,90 / 109,90 / 129,90, pegar variants[0]
     mandaria SEMPRE o preco mais barato: a otimizacao por valor da Meta
     aprenderia errado e a coluna de valor do Events Manager nao bateria com
     a pagina. A variante selecionada vem de ?variant= na URL, e o tema
     tambem publica selectedVariantId. */
  function varianteDaPagina(p) {
    var vs = p.variants;
    if (!vs || !vs.length) return null;

    var alvo = param('variant') || p.selectedVariantId;
    if (alvo) {
      for (var i = 0; i < vs.length; i++) {
        if (vs[i] && String(vs[i].id) === String(alvo)) return vs[i];
      }
    }
    /* Sem ?variant= a Shopify mostra a primeira disponivel, entao ela e a
       resposta certa — nao um palpite. */
    return vs[0];
  }

  function produtoDaPagina() {
    var a = w.ShopifyAnalytics;
    var p = a && a.meta && a.meta.product;
    if (!p) return null;

    var d = {};
    if (p.id) { d.content_ids = [String(p.id)]; }
    var v = varianteDaPagina(p);
    if (v && typeof v.price === 'number') { d.value = v.price / 100; }
    return d;
  }

  function dispararProduto() {
    if (!ehProduto(caminhoDe(w.location.href))) return;
    if (!umaVezSo('ViewContent')) return;

    var d = { currency: CFG.moeda || 'BRL' };
    var p = seguro(produtoDaPagina)();
    if (p) {
      if (p.content_ids) { d.content_ids = p.content_ids; d.content_type = 'product'; }
      /* typeof, e nao "if (p.value)": zero e um preco. Brinde e amostra
         gratis valem R$ 0,00, e o teste falsy jogava o campo fora em vez de
         mandar 0 — a mesma armadilha do zero que o painel evita nos
         cartoes de custo. */
      if (typeof p.value === 'number') { d.value = p.value; }
    }
    api.track('ViewContent', d);
  }

  function dispararCarrinho(dados) {
    if (!umaVezSo('AddToCart')) return;
    var d2 = { currency: CFG.moeda || 'BRL' };
    if (dados) {
      if (dados.value) d2.value = dados.value;
      if (dados.content_ids && dados.content_ids.length) {
        d2.content_ids = dados.content_ids;
        d2.content_type = 'product';
      }
    }
    api.track('AddToCart', d2);
    /* O total mudou: o InitiateCheckout seguinte precisa do numero novo. */
    lerCarrinho();
  }

  function lerCarrinho() {
    if (!fetchOriginal) return;
    fetchOriginal(w.location.origin + '/cart.js', {
      headers: { accept: 'application/json' },
      credentials: 'same-origin'
    }).then(function (r) { return r.json(); })
      .then(function (c) { carrinho = resumo(c); })
      .catch(function () { /* nao e Shopify, ou carrinho vazio */ });
  }

  /* --- AddToCart pelo fetch do tema ------------------------------------ */
  if (fetchOriginal) {
    w.fetch = function (entrada, opcoes) {
      var url = (entrada && entrada.url) ? entrada.url : entrada;
      var resposta = fetchOriginal.apply(this, arguments);
      if (!ehAdicionar(url)) return resposta;

      /* A resposta e clonada: consumir o corpo original deixaria o tema
         sem o que ler, e o carrinho dele pararia de atualizar. */
      return resposta.then(function (r) {
        try {
          r.clone().json().then(seguro(function (o) { dispararCarrinho(resumo(o)); }))
            .catch(function () { dispararCarrinho(null); });
        } catch (e) { dispararCarrinho(null); }
        return r;
      });
    };
  }

  /* --- AddToCart pelo XHR, que tema antigo ainda usa -------------------- */
  if (w.XMLHttpRequest && w.XMLHttpRequest.prototype) {
    var abrirOriginal = w.XMLHttpRequest.prototype.open;
    w.XMLHttpRequest.prototype.open = function (metodo, url) {
      try { this.__rrAdd = ehAdicionar(url); } catch (e) { /* silencio */ }
      return abrirOriginal.apply(this, arguments);
    };
    var enviarOriginal = w.XMLHttpRequest.prototype.send;
    w.XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      if (xhr.__rrAdd) {
        xhr.addEventListener('load', seguro(function () {
          var o = null;
          try { o = JSON.parse(xhr.responseText); } catch (e) { /* nao e json */ }
          dispararCarrinho(resumo(o));
        }));
      }
      return enviarOriginal.apply(this, arguments);
    };
  }

  /* --- AddToCart e InitiateCheckout por formulario e clique ------------- */
  var ALVOS_CHECKOUT = [
    '[name="checkout"]',
    'a[href$="/checkout"]',
    'a[href*="/checkout?"]',
    '.cart__checkout',
    '#checkout'
  ].join(',');

  function dispararCheckout() {
    if (!umaVezSo('InitiateCheckout')) return;
    var d2 = { currency: CFG.moeda || 'BRL' };
    /* O total vem do carrinho ja lido: pedir /cart.js agora seria uma ida
       ao servidor competindo com a navegacao que acabou de comecar, e a
       resposta chegaria depois de a pagina ter ido embora. */
    if (carrinho) {
      if (carrinho.value) d2.value = carrinho.value;
      if (carrinho.content_ids && carrinho.content_ids.length) {
        d2.content_ids = carrinho.content_ids;
        d2.content_type = 'product';
      }
    }
    api.track('InitiateCheckout', d2);
  }

  d.addEventListener('click', seguro(function (e) {
    var alvo = e.target && e.target.closest && e.target.closest(ALVOS_CHECKOUT);
    if (alvo) dispararCheckout();
  }), true);

  d.addEventListener('submit', seguro(function (e) {
    var f = e.target;
    if (!f || !f.action) return;
    if (ehAdicionar(f.action)) { dispararCarrinho(null); return; }
    var botao = d.activeElement;
    if (botao && botao.name === 'checkout') dispararCheckout();
  }), true);

  api.__carregado = true;
  w.rrtrack = api;

  /* ---------------------------------------------------------------------
     Partida
  --------------------------------------------------------------------- */
  seguro(carregarPixel)();
  seguro(carregarGa4)();

  /* ---------------------------------------------------------------------
     O PageView sai DEPOIS da identificação, e isso não é detalhe de ordem.

     Numa visita nova o _trck ainda não existe: quem o cria é a resposta
     do /api/identify. Disparar antes gravaria o evento sem trck_user_id
     — e como a maioria do tráfego de uma loja é visita nova, a maioria dos
     PageView nasceria órfã, fora do funil e sem nada para a Meta casar.

     O enviar() já engole a falha e resolve com null, então a promessa
     sempre chega ao fim: um /api/identify fora do ar atrasa o PageView, não
     o cancela.
  --------------------------------------------------------------------- */
  function dispararPageView() {
    api.track('PageView', {}, { ga4: false });
    /* ViewContent logo atras, e pela MESMA razao de esperar o identify:
       numa visita nova o _trck ainda nao existe, e o evento nasceria orfao.
       Ele sai so em pagina de produto — ehProduto() decide. */
    dispararProduto();
  }

  var identificacao = seguro(identificar)();
  if (identificacao && identificacao.then) {
    identificacao.then(seguro(dispararPageView), seguro(dispararPageView));
  } else {
    seguro(dispararPageView)();
  }

  /* Segunda identificação: o _fbp só existe depois que o Pixel roda, e sem
     ele a Conversions API recebe um evento sem quem. */
  w.setTimeout(seguro(function () { identificar(); }), 2500);

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', seguro(marcarLinks));
  } else {
    seguro(marcarLinks)();
  }
})(window, document);
`;
}
