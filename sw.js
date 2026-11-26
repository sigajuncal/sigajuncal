/* SigaFarmácia — Service Worker
   Colocar este ficheiro na RAIZ do repositório, ao lado do index.html,
   do manifest.json e dos ícones (icon-192.png / icon-512.png).

   O que faz:
   1) Permite mostrar notificações via registration.showNotification()
      (obrigatório para PWA instalada no Android) — usado pela própria app.
   2) Recebe eventos "push" de Web Push (quando/se for ligado um servidor de
      envio — ver nota no fim) e mostra a notificação + badge, mesmo com a
      app FECHADA e sem sessão iniciada.
   3) Trata o clique na notificação: foca a janela da app se já estiver
      aberta, ou abre uma nova.
*/

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* Abertura da app (2026-10-08) — necessário para o Chrome e o Samsung Internet
   oferecerem "Instalar aplicação" (ícone sem o símbolo do browser).
   Só trata a ABERTURA de páginas e vai SEMPRE à rede: não guarda cópias,
   por isso cada abertura traz sempre a versão mais recente do index.
   2026-10-17 (Hugo: "quando o servidor está em baixo, a app pode avisar… para ligar o PC do Gabinete 1"):
   - a Cloudflare responde mas o PC da farmácia não (502/503/504/52x/530) → aviso «servidor em baixo»;
   - na rede local (endereço do PC), sem resposta nenhuma → também é o servidor em baixo;
   - sem resposta nenhuma pela internet → «sem ligação à internet», como antes.
   As duas páginas tentam de novo sozinhas a cada 10 s e abrem a app assim que o servidor responder. */
function sigaPagina(titulo, texto) {
  return new Response(
    '<!doctype html><html lang="pt"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>SigaFarmácia</title><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f7fb;color:#033363;text-align:center;padding:24px;box-sizing:border-box">' +
    '<div style="max-width:440px"><h1 style="font-size:20px;margin:0 0 10px">' + titulo + '</h1><p style="margin:0 0 18px;color:#0880AA;line-height:1.45">' + texto + '</p>' +
    '<button onclick="location.reload()" style="font-size:16px;padding:10px 22px;border:0;border-radius:10px;background:#033363;color:#fff">Tentar de novo</button>' +
    '<p style="margin:16px 0 0;font-size:13px;color:#5b8aa6">A app volta a tentar sozinha de 10 em 10 segundos.</p></div>' +
    '<script>setInterval(function(){fetch("/api/siga/estado",{cache:"no-store"}).then(function(r){if(r.ok)location.reload();}).catch(function(){});},10000);<\/script>' +
    '</body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}
const SIGA_SERVIDOR_EM_BAIXO = () => sigaPagina('O servidor da farmácia não está a responder',
  'Verifica se o <b>PC do Gabinete 1</b> está ligado e com internet. Se estiver, reinicia-o. Assim que voltar, a app abre sozinha.');
/* MODO CONSULTA (2026-11-10, Hugo: «o servidor esteve desligado por uma quebra de luz — há possibilidade de ter os dados
   só para consulta, por exemplo para avisar as pessoas para não virem às consultas?»)
   Cada vez que a app abre bem, fica guardada uma cópia dela neste aparelho (só a página da app — os dados ficam
   guardados pela própria app). Se o servidor não responder, em vez da página de aviso abre-se essa cópia em
   «modo consulta» (window.SIGA_MODO_CONSULTA): a app mostra os dados guardados no aparelho, só para ler, e volta
   sozinha ao normal quando o servidor responder. O ecrã da TV (?ecra=…) continua com a página de aviso.
   Só quando é MESMO o servidor da farmácia que está em baixo (a Cloudflare responde, o PC não) — nunca por falta de
   internet no aparelho. A app abre como a última pessoa com sessão no aparelho (com as permissões dela). */
const SIGA_CACHE_APP = 'siga-app-copia-v1';
const SIGA_CHAVE_APP = '/__siga_app_copia__';
let sigaDescarga = null; // descarga por trás da versão nova da app (uma de cada vez)
async function sigaVersaoDaCopia() {
  try {
    const r = await (await caches.open(SIGA_CACHE_APP)).match(SIGA_CHAVE_APP);
    if (!r) return null;
    const leitor = r.body.getReader(); const dec = new TextDecoder(); let txt = '';
    while (txt.length < 16384) { const { done, value } = await leitor.read(); if (done) break; txt += dec.decode(value, { stream: true }); if (txt.includes('</head>') || /name="siga-versao"[^>]*>/.test(txt)) break; }
    try { leitor.cancel(); } catch (e) { /* ignora */ }
    const m = /<meta name="siga-versao" content="([^"]*)"/.exec(txt);
    return m ? m[1] : null;
  } catch (e) { return null; }
}
function sigaGuardarCopia(resposta) {
  return caches.open(SIGA_CACHE_APP).then((c) => c.put(SIGA_CHAVE_APP, resposta)).catch(() => {});
}
function sigaAbrirConsulta(motivo, alternativa) {
  return caches.open(SIGA_CACHE_APP)
    .then((c) => c.match(SIGA_CHAVE_APP))
    .then((r) => (r ? r.text() : null))
    .then((html) => {
      if (!html) return alternativa();
      const marca = '<script>window.SIGA_MODO_CONSULTA={motivo:' + JSON.stringify(motivo) + '};<\/script>';
      const i = html.search(/<head[^>]*>/i);
      const pos = i >= 0 ? html.indexOf('>', i) + 1 : 0;
      return new Response(html.slice(0, pos) + marca + html.slice(pos), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    })
    .catch(() => alternativa());
}
// 2026-11-26 16:05 (Hugo: Safari «Response served by service worker has redirections»): o Safari recusa abrir uma página
// cuja resposta, vinda do service worker, passou por um redirecionamento. Qualquer resposta redirecionada é agora
// entregue como uma resposta nova (mesmo conteúdo, estado e cabeçalhos), sem a marca de redirecionamento.
function sigaSemRedir(r) {
  try { if (r && r.redirected) return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers }); } catch (e) { /* ignora */ }
  return r;
}
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  const host = url.hostname;
  const ehServidorDaFarmacia = /(^|\.)sigafarmacia\.(pt|com)$/.test(host);
  const naRedeLocal = host === 'localhost' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const daApp = (ehServidorDaFarmacia || naRedeLocal) && url.origin === self.location.origin;
  const ecraTv = url.searchParams.has('ecra'); // TV/monitor do backoffice: nunca em consulta (mostraria a equipa desatualizada)
  const podeConsulta = daApp && !ecraTv;
  const emBaixo = () => (podeConsulta ? sigaAbrirConsulta('servidor', SIGA_SERVIDOR_EM_BAIXO) : SIGA_SERVIDOR_EM_BAIXO());
  const semInternet = () => sigaPagina('Sem ligação à internet', 'Verifica o Wi-Fi ou os dados móveis e tenta de novo.');
  // Para a app, pergunta sempre ao servidor (no-cache): uma cópia da cache HTTP do browser podia esconder que o servidor
  // está em baixo. Com o servidor ligado custa uma revalidação rápida.
  let pedido = event.request;
  if (daApp) { try { pedido = new Request(event.request, { cache: 'no-cache' }); } catch (e) { pedido = event.request; } }
  /* 2026-11-26 (Hugo: «verifica a mais eficiente que não sacrifique nada»): cada abertura descarregava a app inteira
     (~2,6 MB comprimidos) mesmo sem versão nova — o browser não guardava a sua própria cópia. Agora pergunta-se ao
     servidor COM a data da cópia que já está neste aparelho (a mesma do modo consulta): sem versão nova, o servidor
     responde «não mudou» (304, sem conteúdo) e abre-se a cópia; com versão nova, vem a nova e fica guardada. Continua a
     ir SEMPRE ao servidor (servidor em baixo e sem internet detetam-se como antes) e abre sempre a versão mais recente. */
  const ehPaginaDaApp = podeConsulta && (url.pathname === '/' || /\/index\.html$/.test(url.pathname));
  if (ehPaginaDaApp) {
    event.respondWith((async () => {
      let copia = null;
      try { copia = await (await caches.open(SIGA_CACHE_APP)).match(SIGA_CHAVE_APP); } catch (e) { copia = null; }
      const desde = copia && copia.headers.get('Last-Modified');
      let pedidoCond = pedido;
      if (desde) {
        try { pedidoCond = new Request(event.request.url, { method: 'GET', headers: { 'If-Modified-Since': desde }, cache: 'no-store', credentials: 'same-origin' }); }
        catch (e) { pedidoCond = pedido; }
      }
      let r;
      /* 2026-11-26 21:25: com a ligação da farmácia lenta, até a pergunta «mudou?» chegou a levar 3 s. Com cópia neste
         aparelho, se o servidor não responder em 1,2 s abre-se logo a cópia; a pergunta continua por trás e, se houver
         versão nova, fica guardada para a próxima vez (a app avisa/atualiza-se sozinha). Sem cópia, espera-se como dantes. */
      const pergunta = fetch(pedidoCond);
      if (copia && !url.searchParams.get('atualizar')) {
        const LENTO = {};
        const primeiro = await Promise.race([pergunta.catch(() => null), new Promise((res) => setTimeout(() => res(LENTO), 1200))]);
        if (primeiro === LENTO) {
          event.waitUntil(pergunta.then((rr) => {
            if (rr && rr.ok && rr.status !== 304 && /text\/html/i.test(rr.headers.get('Content-Type') || '') && !sigaDescarga) { sigaDescarga = sigaGuardarCopia(rr).finally(() => { sigaDescarga = null; }); return sigaDescarga; }
            try { rr && rr.body && rr.body.cancel(); } catch (e) { /* ignora */ }
            return null;
          }).catch(() => {}));
          const h = new Headers(copia.headers); h.delete('Content-Encoding'); h.delete('Content-Length'); h.set('Cache-Control', 'no-store'); h.set('X-Siga-Copia', 'lento');
          return new Response(copia.body, { status: 200, statusText: 'OK', headers: h });
        }
      }
      try { r = await pergunta; }
      catch (e) { if (naRedeLocal) return emBaixo(); return semInternet(); }
      if (ehServidorDaFarmacia && [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530].indexOf(r.status) >= 0) return emBaixo();
      if (r.status === 304) {
        if (copia) {
          const h = new Headers(copia.headers); h.delete('Content-Encoding'); h.delete('Content-Length'); h.set('Cache-Control', 'no-store'); h.set('X-Siga-Copia', '1'); // o conteúdo guardado já vem descomprimido
          return new Response(copia.body, { status: 200, statusText: 'OK', headers: h });
        }
        try { r = await fetch(pedido); } catch (e) { if (naRedeLocal) return emBaixo(); return semInternet(); }
      }
      /* 2026-11-26 21:05 (Hugo: «a demorar imenso a abrir… quero isto imediato»): com versão nova no servidor, esperar
         pela app inteira (2,6 MB) podia levar muitos segundos com a ligação da farmácia lenta. Agora, se este aparelho já
         tem uma cópia, abre-a LOGO (o servidor já respondeu — está ligado) e a versão nova descarrega por trás e fica
         guardada; a app deteta sozinha que há versão nova e atualiza-se num momento calmo (ou na próxima abertura). */
      // Recarga pedida pela própria app para uma versão concreta (?atualizar=…) por uma app antiga, que não pergunta antes
      // se a cópia está pronta: aí espera-se pela versão nova (como dantes), para não voltar a abrir a antiga.
      const querVersao = url.searchParams.get('atualizar');
      if (copia && querVersao && r.ok) {
        const servirCache = async () => { const nova = await (await caches.open(SIGA_CACHE_APP)).match(SIGA_CHAVE_APP); const h = new Headers(nova.headers); h.delete('Content-Encoding'); h.delete('Content-Length'); h.set('Cache-Control', 'no-store'); return new Response(nova.body, { status: 200, statusText: 'OK', headers: h }); };
        if (sigaDescarga) { try { r.body && r.body.cancel(); } catch (e) { /* ignora */ } await sigaDescarga; return servirCache(); }
        if ((await sigaVersaoDaCopia()) !== querVersao) { event.waitUntil(sigaGuardarCopia(r.clone())); return sigaSemRedir(r); }
      }
      if (copia && r.ok && /text\/html/i.test(r.headers.get('Content-Type') || '')) {
        if (!sigaDescarga) { sigaDescarga = sigaGuardarCopia(r).finally(() => { sigaDescarga = null; }); event.waitUntil(sigaDescarga); }
        else { try { r.body && r.body.cancel(); } catch (e) { /* ignora */ } } // já há uma descarga da versão nova a decorrer
        const h = new Headers(copia.headers); h.delete('Content-Encoding'); h.delete('Content-Length'); h.set('Cache-Control', 'no-store'); h.set('X-Siga-Copia', 'anterior');
        return new Response(copia.body, { status: 200, statusText: 'OK', headers: h });
      }
      if (r.ok && /text\/html/i.test(r.headers.get('Content-Type') || '')) event.waitUntil(sigaGuardarCopia(r.clone()));
      return sigaSemRedir(r);
    })());
    return;
  }
  event.respondWith(
    fetch(pedido).then((r) => {
      if (ehServidorDaFarmacia && [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530].indexOf(r.status) >= 0) return emBaixo();
      // A app abriu bem: guarda (ou renova) a cópia para o modo consulta.
      if (podeConsulta && r.ok && /text\/html/i.test(r.headers.get('Content-Type') || '')) event.waitUntil(sigaGuardarCopia(r.clone()));
      return sigaSemRedir(r);
    }).catch(() => {
      if (naRedeLocal) return emBaixo();
      // Sem resposta nenhuma pela internet: o problema é deste aparelho (cabo desligado, modo de avião…), não do servidor
      // — nunca abre o modo consulta (assim não basta desligar a rede para ver os dados sem PIN).
      return semInternet();
    })
  );
});

/* Badge do ícone da app (Dock do macOS / barra de tarefas do Windows /
   ícone Android): a página envia a contagem de não lidas por postMessage
   sempre que muda — aplicar o badge também a partir do contexto do SW
   torna-o mais fiável em PWAs instaladas. */
self.addEventListener('message', (event) => {
  const dados = event.data || {};
  /* A app pergunta se a cópia guardada já é a versão nova antes de se recarregar sozinha (assim a recarga é imediata,
     nunca fica à espera da descarga). Se a cópia ainda é antiga e nada está a descarregar, começa a descarga. */
  if (dados.tipo === 'copia-versao') {
    const porta = event.ports && event.ports[0];
    event.waitUntil((async () => {
      let versao = await sigaVersaoDaCopia();
      if (dados.quero && versao !== dados.quero && !sigaDescarga) {
        sigaDescarga = fetch(new Request(self.registration.scope, { cache: 'no-store', credentials: 'same-origin' }))
          .then((r) => (r.ok && /text\/html/i.test(r.headers.get('Content-Type') || '') ? sigaGuardarCopia(r) : null))
          .catch(() => {}).finally(() => { sigaDescarga = null; });
      }
      if (porta) porta.postMessage({ versao, aDescarregar: !!sigaDescarga });
      if (sigaDescarga) await sigaDescarga;
    })());
    return;
  }
  if (dados.tipo !== 'badge') return;
  if (!('setAppBadge' in self.navigator)) return;
  try {
    if (typeof dados.contagem === 'number' && dados.contagem > 0) self.navigator.setAppBadge(dados.contagem).catch(() => {});
    else self.navigator.clearAppBadge().catch(() => {});
  } catch (e) { /* Badging API indisponível — ignora */ }
});

/* Web Push — payload esperado (JSON):
   { "titulo": "...", "corpo": "...", "tipo": "chat" | "entrega" | "geral", "badge": 3 } */
self.addEventListener('push', (event) => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; } catch (e) { dados = { corpo: event.data ? event.data.text() : '' }; }
  const titulo = dados.titulo || 'SigaFarmácia';
  const opcoes = {
    body: dados.corpo || '',
    icon: 'icon-512.png',
    badge: 'icon-192.png',
    tag: 'sigajuncal-' + (dados.tipo || 'geral'),
    renotify: true,
    vibrate: [200, 100, 200],
    data: { tipo: dados.tipo || 'geral' },
  };
  const tarefas = [self.registration.showNotification(titulo, opcoes)];
  // Badge no ícone da app (Badging API dentro do SW — Android/Chrome/Edge)
  if ('setAppBadge' in self.navigator && typeof dados.badge === 'number') {
    tarefas.push(self.navigator.setAppBadge(dados.badge).catch(() => {}));
  }
  event.waitUntil(Promise.all(tarefas));
});

/* Clique na notificação (2026-10-09): volta SEMPRE à janela da app que já existe, em vez de abrir outra — uma
   janela nova começa sem sessão. Dá preferência à janela da app instalada / já visível, e só abre uma nova se
   não houver nenhuma.
   2026-11-13 (Hugo: «da notificação não consigo tomar ação»): a notificação pode trazer botões (ex.: lembrete →
   «Concluir» / «Amanhã») e dados sobre o que abrir. O SW passa à janela da app o botão tocado e os dados
   ({ tipo: 'notifClique', acao, dados }); a app faz o resto (concluir, adiar, abrir a janela certa).
   Se não houver janela aberta, abre a app com ?notif=… para ela tratar ao arrancar. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const dados = event.notification.data || {};
  const acao = event.action || '';
  const msg = { tipo: 'notifClique', acao, dados };
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const daApp = janelas.filter((j) => j.url && j.url.startsWith(self.registration.scope));
    const candidatas = daApp.length ? daApp : janelas;
    candidatas.sort((a, b) => (Number(b.focused) - Number(a.focused)) || (Number(b.visibilityState === 'visible') - Number(a.visibilityState === 'visible')));
    for (const j of candidatas) {
      try { j.postMessage(msg); } catch (e) { /* ignora */ }
      if ('focus' in j) {
        try { return await j.focus(); } catch (e) { /* tenta a seguinte */ }
      }
    }
    if (self.clients.openWindow) {
      let url = self.registration.scope;
      if (dados && dados.tipo) {
        try { url += (url.indexOf('?') >= 0 ? '&' : '?') + 'notif=' + encodeURIComponent(JSON.stringify(msg)); } catch (e) { /* ignora */ }
      }
      return self.clients.openWindow(url);
    }
  })());
});

/* NOTA IMPORTANTE — envio de push com a app fechada:
   Este SW já está pronto a RECEBER Web Push. Para as notificações chegarem
   com a app totalmente fechada é ainda preciso, do lado do servidor:
   1) Gerar um par de chaves VAPID;
   2) Na app, subscrever com pushManager.subscribe({ userVisibleOnly: true,
      applicationServerKey: <chave pública VAPID> }) e guardar a subscrição
      numa tabela do Supabase;
   3) Uma Supabase Edge Function (ou trigger) que, ao inserir uma mensagem
      de chat / entrega, envie o push às subscrições guardadas — filtrando
      por perfil (Estafeta: só entregas; Prestador de Serviço: nunca).
   Sem esse passo, as notificações funcionam com a app aberta ou em segundo
   plano (via Realtime), mas não com o browser/app completamente fechados. */
