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
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  const host = new URL(event.request.url).hostname;
  const ehServidorDaFarmacia = /(^|\.)sigafarmacia\.(pt|com)$/.test(host);
  const naRedeLocal = host === 'localhost' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  event.respondWith(
    fetch(event.request).then((r) => {
      if (ehServidorDaFarmacia && [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530].indexOf(r.status) >= 0) return SIGA_SERVIDOR_EM_BAIXO();
      return r;
    }).catch(() => (naRedeLocal ? SIGA_SERVIDOR_EM_BAIXO() : sigaPagina('Sem ligação à internet', 'Verifica o Wi-Fi ou os dados móveis e tenta de novo.')))
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

/* Clique na notificação (2026-10-09): volta SEMPRE à janela da app que já existe, em vez de abrir outra — uma
   janela nova começa sem sessão. Dá preferência à janela da app instalada / já visível, e só abre uma nova se
   não houver nenhuma. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const daApp = janelas.filter((j) => j.url && j.url.startsWith(self.registration.scope));
    const candidatas = daApp.length ? daApp : janelas;
    candidatas.sort((a, b) => (Number(b.focused) - Number(a.focused)) || (Number(b.visibilityState === 'visible') - Number(a.visibilityState === 'visible')));
    for (const j of candidatas) {
      if ('focus' in j) {
        try { return await j.focus(); } catch (e) { /* tenta a seguinte */ }
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(self.registration.scope);
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
