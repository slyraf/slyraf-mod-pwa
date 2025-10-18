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
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.error('[SW] Erreur lors du cache des assets:', err);
      });
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
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME && cacheName !== CALENDAR_CACHE)
          .map(cacheName => {
            console.log('[SW] Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
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
      handleCalendarRequest(request)
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
        }).catch(err => {
          console.error('[SW] Erreur fetch asset:', err);
          throw err;
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

// Fonction dédiée pour gérer le calendrier
async function handleCalendarRequest(request) {
  const cache = await caches.open(CALENDAR_CACHE);
  const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  
  try {
    // Vérifier d'abord le cache
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      const cachedDate = cachedResponse.headers.get('x-cached-date');
      if (cachedDate) {
        const cacheAge = Date.now() - parseInt(cachedDate);
        
        // Si le cache a moins de 5 minutes, l'utiliser
        if (cacheAge < CACHE_DURATION_MS) {
          console.log('[SW] Utilisation du cache calendrier (âge: ' + Math.round(cacheAge/1000) + 's)');
          
          // Déclencher une mise à jour en arrière-plan
          fetchAndCacheCalendar(request, cache).catch(err => 
            console.warn('[SW] Mise à jour arrière-plan échouée:', err)
          );
          
          return cachedResponse;
        }
      }
    }
    
    // Sinon, essayer le réseau
    console.log('[SW] Récupération calendrier depuis le réseau...');
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      await cacheCalendarResponse(request, networkResponse.clone(), cache);
      return networkResponse;
    }
    
    // Si le réseau échoue mais qu'on a un cache, l'utiliser
    if (cachedResponse) {
      console.warn('[SW] Réseau échoué, utilisation cache ancien');
      return cachedResponse;
    }
    
    throw new Error('Pas de réponse réseau ni cache disponible');
    
  } catch (err) {
    console.error('[SW] Erreur calendrier:', err);
    
    // Dernière chance : vérifier le cache même expiré
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      console.warn('[SW] Utilisation cache expiré en dernier recours');
      return cachedResponse;
    }
    
    // Retourner un calendrier vide valide
    return new Response('BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Slyraf//MOD Dashboard//FR\nEND:VCALENDAR', { 
      status: 200,
      headers: { 
        'Content-Type': 'text/calendar; charset=utf-8'
      }
    });
  }
}

// Fonction pour mettre en cache le calendrier
async function cacheCalendarResponse(request, response, cache) {
  const data = await response.text();
  
  const cachedResponse = new Response(data, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'x-cached-date': Date.now().toString()
    }
  });
  
  await cache.put(request, cachedResponse);
  console.log('[SW] Calendrier mis en cache');
}

// Fonction pour fetch et cache en arrière-plan
async function fetchAndCacheCalendar(request, cache) {
  const response = await fetch(request);
  if (response.ok) {
    await cacheCalendarResponse(request, response, cache);
  }
}

// Gestion des notifications push
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
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// Synchronisation en arrière-plan
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
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const cache = await caches.open(CALENDAR_CACHE);
    const request = new Request(CALENDAR_URL);
    await cacheCalendarResponse(request, response, cache);
    
    console.log('[SW] Calendrier synchronisé avec succès');
  } catch (error) {
    console.error('[SW] Erreur sync calendrier:', error);
  }
}