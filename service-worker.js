// Service Worker pour PWA Slyraf MOD Dashboard
const CACHE_NAME = 'slyraf-mod-v2.0.0';
const CALENDAR_CACHE = 'slyraf-calendar-v1';

// Fichiers essentiels à mettre en cache
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Installation du Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installation...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cache ouvert');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activation et nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== CALENDAR_CACHE) {
            console.log('[SW] Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Stratégie de cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') {
    return;
  }

  // Requêtes vers Google Calendar iCal
  if (url.hostname === 'calendar.google.com' && url.pathname.includes('/ical/')) {
    event.respondWith(
      caches.open(CALENDAR_CACHE).then((cache) => {
        return fetch(request).then((response) => {
          // Cloner la réponse avant de la mettre en cache
          cache.put(request, response.clone());
          return response;
        }).catch(() => {
          // En cas d'échec, utiliser le cache (max 10 min)
          return cache.match(request).then((cached) => {
            if (cached) {
              const cachedDate = new Date(cached.headers.get('date'));
              const now = new Date();
              const diffMinutes = (now - cachedDate) / 1000 / 60;
              
              if (diffMinutes < 10) {
                console.log('[SW] Utilisation cache calendrier');
                return cached;
              }
            }
            return new Response('[]', { 
              headers: { 'Content-Type': 'text/calendar' }
            });
          });
        });
      })
    );
    return;
  }

  // Requêtes vers Twitch (pas de cache)
  if (url.hostname.includes('twitch.tv')) {
    event.respondWith(fetch(request));
    return;
  }

  // Stratégie Cache First pour les assets statiques
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        
        return fetch(request).then((response) => {
          // Ne mettre en cache que les réponses OK
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Pour tout le reste : Network First
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request);
    })
  );
});

// Gestion des notifications push (futur)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  
  const options = {
    body: data.body || 'Nouvelle notification',
    icon: '/icon-192.png',
    badge: '/icon-96.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Slyraf MOD', options)
  );
});

// Gestion des clics sur les notifications
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const url = event.notification.data.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si une fenêtre est déjà ouverte, la focus
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Sinon ouvrir une nouvelle fenêtre
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Synchronisation en arrière-plan (futur)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-calendar') {
    event.waitUntil(syncCalendar());
  }
});

async function syncCalendar() {
  try {
    const CALENDAR_ID = '18ca2c7c54ab73c4274cf709da7891af0603beef111b9b21f542e84414bb1c13@group.calendar.google.com';
    const CALENDAR_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`;
    
    const response = await fetch(CALENDAR_URL);
    const data = await response.text();
    
    const cache = await caches.open(CALENDAR_CACHE);
    await cache.put(CALENDAR_URL, new Response(data, {
      headers: {
        'Content-Type': 'text/calendar',
        'date': new Date().toUTCString()
      }
    }));
    
    console.log('[SW] Calendrier synchronisé');
  } catch (error) {
    console.error('[SW] Erreur sync calendrier:', error);
  }
}