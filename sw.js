/* SigaJuncal — Service Worker
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

/* Web Push — payload esperado (JSON):
   { "titulo": "...", "corpo": "...", "tipo": "chat" | "entrega" | "geral", "badge": 3 } */
self.addEventListener('push', (event) => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; } catch (e) { dados = { corpo: event.data ? event.data.text() : '' }; }
  const titulo = dados.titulo || 'SigaJuncal';
  const opcoes = {
    body: dados.corpo || '',
    icon: 'icon-512.png',
    badge: 'icon-192.png',
    tag: 'sigajuncal-' + (dados.tipo || 'geral'),
    renotify: true,
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
