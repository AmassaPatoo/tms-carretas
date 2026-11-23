/* Plataforma KE — funcionamento offline das telas.
   Os dados vêm sempre do Supabase (precisa de internet); aqui guardamos só
   os arquivos do app para abrir rápido e mesmo com sinal fraco.
   Ao publicar uma versão nova, aumente o número da VERSAO. */
const VERSAO = 'plataforma-v1';
const ARQUIVOS = [
  './', './index.html', './config.js', './manifest.webmanifest',
  './core/plataforma.js', './core/inicio.js', './core/inicio.css', './vendor/supabase.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './modulos/carreta/index.html', './modulos/carreta/app.js', './modulos/carreta/styles.css',
  './modulos/carreta/cte.css', './modulos/carreta/motorista.css',
  './modulos/orcamentos/index.html'
];
self.addEventListener('install', e => e.waitUntil(
  caches.open(VERSAO).then(c => Promise.all(ARQUIVOS.map(a => c.add(a).catch(() => null)))).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
/* Rede primeiro (sempre a versão mais nova); sem internet, usa a cópia guardada. */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(VERSAO).then(cache => cache.put(e.request, c)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
