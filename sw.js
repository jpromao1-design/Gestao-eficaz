const CACHE_NAME = 'gestao-eficaz-v1';

const urlsToCache = [

  './',
  './index.html',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png'

];

self.addEventListener('install', event => {

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then(cache => {

        return cache.addAll(urlsToCache);

      })

  );

});

self.addEventListener('activate', event => {

  event.waitUntil(

    caches.keys().then(keys => {

      return Promise.all(

        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))

      );

    })

  );

});

self.addEventListener('fetch', event => {

  event.respondWith(

    caches.match(event.request)
      .then(response => {

        return response || fetch(event.request);

      })

  );

});
