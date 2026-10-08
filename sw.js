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
   Sem ligação, mostra uma mensagem simples em vez do erro do browser. */
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!doctype html><html lang="pt"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>SigaFarmácia</title><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f7fb;color:#033363;text-align:center;padding:24px">' +
      '<div><h1 style="font-size:20px;margin:0 0 8px">Sem ligação à internet</h1><p style="margin:0 0 18px;color:#0880AA">Verifica o Wi-Fi ou os dados móveis e tenta de novo.</p>' +
      '<button onclick="location.reload()" style="font-size:16px;padding:10px 22px;border:0;border-radius:10px;background:#033363;color:#fff">Tentar de novo</button></div></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    ))
  );
});

/* Badge do ícone da app (Dock do macOS / barra de tarefas do Windows /
   ícone Android): a página envia a contagem de não lidas por postMessage
   sempre que muda — aplicar o badge também a partir do contexto do SW
   torna-o mais fiável em PWAs instaladas. */
self.addEventListener('message', (event) => {
  const dados = event.data || {};
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if ('focus' in j) return j.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
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
