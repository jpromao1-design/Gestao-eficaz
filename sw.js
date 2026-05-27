const CACHE_NAME='gestao-eficaz-v10';
const ASSETS=['./', './index.html','./manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{if(e.request.url.includes('supabase.co')){e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));return;}e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));});
