const CACHE='tms-carretas-v1-assets';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.includes('config.js'))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE).then(c=>c.put(event.request,response.clone()));return response}).catch(()=>caches.match(event.request)));
});
