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
      fbclid: param('fbclid') || undefined
    };
    var u = utms();
    for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) corpo[k] = u[k];
    if (extra) for (var k2 in extra) if (Object.prototype.hasOwnProperty.call(extra, k2)) corpo[k2] = extra[k2];

    return enviar('/api/identify', corpo).then(function (r) {
      if (r && r.trck_user_id) {
        trckUserId = r.trck_user_id;
        marcarLinks();
      }
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
    w.fbq('track', 'PageView');
  }

  /* ---------------------------------------------------------------------
     API pública
  --------------------------------------------------------------------- */
  function novoEventId() {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    return 'e' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* rrtrack.track('Lead', { value: 97, currency: 'BRL' }) */
  api.track = seguro(function (nome, dados) {
    var eventId = novoEventId();
    var custom = dados || {};

    /* Navegador e servidor com o MESMO event_id: é o que deduplica. */
    if (w.fbq && CFG.pixels.length) {
      w.fbq('track', nome, custom, { eventID: eventId });
    }
    if (w.gtag && CFG.ga4.length) {
      w.gtag('event', nome, custom);
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

  api.__carregado = true;
  w.rrtrack = api;

  /* ---------------------------------------------------------------------
     Partida
  --------------------------------------------------------------------- */
  seguro(carregarPixel)();
  seguro(carregarGa4)();
  seguro(identificar)();

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
