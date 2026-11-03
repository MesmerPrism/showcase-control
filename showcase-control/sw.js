'use strict';
// Finite same-origin static shell only. No automatic skipWaiting during commands.
const CACHE='viscereality-showcase-shell-v1-bd2fa806dba6a2bb';
const SHELL=['./','index.html','styles.css','app.js','ui-model.js','forms.js','protocol.js','validation.js','controller.js','join.js','transport-neutral.js','discovery.js','visual-schema.json','default-visual.json','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'];
const URLS=new Set(SHELL.map(path=>new URL(path,self.location.href).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(path=>new Request(new URL(path,self.location.href),{cache:'reload'}))))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('viscereality-showcase-shell-')&&key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('message',event=>{
 if(event.data?.type!=='CHECK_SHOWCASE_SHELL'||!event.ports?.[0])return;
 event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(SHELL.map(path=>cache.match(new URL(path,self.location.href).href)))).then(entries=>event.ports[0].postMessage({ready:entries.every(Boolean)})).catch(()=>event.ports[0].postMessage({ready:false})));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.search||!URLS.has(url.href)||request.headers.has('Authorization'))return;
 event.respondWith(caches.open(CACHE).then(cache=>cache.match(request).then(cached=>cached||fetch(request,{cache:'no-cache'}))));
});
